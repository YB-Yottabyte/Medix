"""Summarize completed blinded generation reviews after safe unblinding."""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import binomtest, wilcoxon
from sklearn.metrics import cohen_kappa_score

from evaluation.generation_review import (
    BINARY_RATING_FIELD,
    ORDINAL_RATING_FIELDS,
    GenerationReviewUnblinder,
    UnblindedRating,
)


def summarize_reviews(
    ratings: list[UnblindedRating],
    *,
    bootstrap_samples: int = 5000,
    seed: int = 20260724,
) -> dict[str, Any]:
    if not ratings:
        raise ValueError("ratings must not be empty")
    if bootstrap_samples < 1:
        raise ValueError("bootstrap_samples must be positive")
    conditions = tuple(sorted({rating.condition for rating in ratings}))
    reviewers = tuple(sorted({rating.reviewer_id for rating in ratings}))
    cases = tuple(sorted({rating.case_id for rating in ratings}))
    return {
        "reviewers": list(reviewers),
        "reviewer_count": len(reviewers),
        "cases": len(cases),
        "conditions": {
            condition: _condition_summary(ratings, condition) for condition in conditions
        },
        "reviewer_condition_summaries": {
            reviewer: {
                condition: _condition_summary(
                    [rating for rating in ratings if rating.reviewer_id == reviewer],
                    condition,
                )
                for condition in conditions
            }
            for reviewer in reviewers
        },
        "paired_condition_comparisons": _paired_comparisons(
            ratings,
            conditions=conditions,
            bootstrap_samples=bootstrap_samples,
            seed=seed,
        ),
        "inter_rater_agreement": _agreement_summary(
            ratings,
            conditions=conditions,
            reviewers=reviewers,
        ),
        "analysis_boundary": (
            "Ordinal means and pilot p-values are descriptive. Confirm the primary outcome, "
            "minimum meaningful effect, reviewer qualifications, multiplicity handling, and "
            "sample size with the advisor before the full validation or test analysis."
        ),
    }


def _condition_summary(
    ratings: list[UnblindedRating],
    condition: str,
) -> dict[str, Any]:
    selected = [rating for rating in ratings if rating.condition == condition]
    summary: dict[str, Any] = {
        "ratings": len(selected),
        "reviewers": len({rating.reviewer_id for rating in selected}),
        "cases": len({rating.case_id for rating in selected}),
    }
    for field in ORDINAL_RATING_FIELDS:
        values = np.asarray(
            [getattr(rating, field) for rating in selected],
            dtype=np.float64,
        )
        summary[field] = {
            "mean": float(np.mean(values)),
            "standard_deviation": float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
            "median": float(np.median(values)),
        }
    unsafe = [rating.unsafe_or_unsupported_claim for rating in selected]
    summary[BINARY_RATING_FIELD] = {
        "count": int(sum(unsafe)),
        "rate": sum(unsafe) / len(unsafe) if unsafe else 0.0,
    }
    return summary


def _paired_comparisons(
    ratings: list[UnblindedRating],
    *,
    conditions: tuple[str, ...],
    bootstrap_samples: int,
    seed: int,
) -> dict[str, Any]:
    index = {(rating.reviewer_id, rating.case_id, rating.condition): rating for rating in ratings}
    pairs: dict[str, Any] = {}
    for pair_index, (left, right) in enumerate(itertools.combinations(conditions, 2)):
        paired = [
            (rating, index[(rating.reviewer_id, rating.case_id, right)])
            for rating in ratings
            if rating.condition == left and (rating.reviewer_id, rating.case_id, right) in index
        ]
        pair_name = f"{left}_minus_{right}"
        pairs[pair_name] = {
            "left_condition": left,
            "right_condition": right,
            "paired_ratings": len(paired),
            "ordinal": {
                field: _ordinal_comparison(
                    [getattr(left_rating, field) for left_rating, _right_rating in paired],
                    [getattr(right_rating, field) for _left_rating, right_rating in paired],
                    bootstrap_samples=bootstrap_samples,
                    seed=seed + pair_index * 100 + field_index,
                )
                for field_index, field in enumerate(ORDINAL_RATING_FIELDS)
            },
            BINARY_RATING_FIELD: _binary_comparison(
                [left_rating.unsafe_or_unsupported_claim for left_rating, _right_rating in paired],
                [right_rating.unsafe_or_unsupported_claim for _left_rating, right_rating in paired],
                bootstrap_samples=bootstrap_samples,
                seed=seed + pair_index * 100 + 99,
            ),
        }
    return pairs


def _ordinal_comparison(
    left: list[int],
    right: list[int],
    *,
    bootstrap_samples: int,
    seed: int,
) -> dict[str, float | int | None]:
    differences = np.asarray(left, dtype=np.float64) - np.asarray(right, dtype=np.float64)
    if not len(differences):
        return {
            "paired_n": 0,
            "mean_difference": None,
            "ci95_low": None,
            "ci95_high": None,
            "wilcoxon_statistic": None,
            "wilcoxon_p_value": None,
        }
    statistic = None
    p_value = None
    if len(differences) >= 2 and np.any(differences != 0):
        result = wilcoxon(differences)
        statistic = float(result.statistic)
        p_value = float(result.pvalue)
    low, high = _bootstrap_mean_ci(
        differences,
        samples=bootstrap_samples,
        seed=seed,
    )
    return {
        "paired_n": len(differences),
        "mean_difference": float(np.mean(differences)),
        "ci95_low": low,
        "ci95_high": high,
        "wilcoxon_statistic": statistic,
        "wilcoxon_p_value": p_value,
    }


def _binary_comparison(
    left: list[bool],
    right: list[bool],
    *,
    bootstrap_samples: int,
    seed: int,
) -> dict[str, float | int | None]:
    left_values = np.asarray(left, dtype=np.float64)
    right_values = np.asarray(right, dtype=np.float64)
    differences = left_values - right_values
    left_only = int(np.sum((left_values == 1) & (right_values == 0)))
    right_only = int(np.sum((left_values == 0) & (right_values == 1)))
    discordant = left_only + right_only
    p_value = float(binomtest(left_only, discordant, 0.5).pvalue) if discordant else None
    low, high = (
        _bootstrap_mean_ci(differences, samples=bootstrap_samples, seed=seed)
        if len(differences)
        else (None, None)
    )
    return {
        "paired_n": len(differences),
        "left_unsafe_right_safe": left_only,
        "left_safe_right_unsafe": right_only,
        "unsafe_rate_difference": (float(np.mean(differences)) if len(differences) else None),
        "ci95_low": low,
        "ci95_high": high,
        "exact_mcnemar_p_value": p_value,
    }


def _bootstrap_mean_ci(
    values: np.ndarray,
    *,
    samples: int,
    seed: int,
) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    indices = rng.integers(0, len(values), size=(samples, len(values)))
    means = np.mean(values[indices], axis=1)
    low, high = np.quantile(means, (0.025, 0.975))
    return float(low), float(high)


def _agreement_summary(
    ratings: list[UnblindedRating],
    *,
    conditions: tuple[str, ...],
    reviewers: tuple[str, ...],
) -> dict[str, Any]:
    if len(reviewers) < 2:
        return {
            "available": False,
            "reason": "At least two completed reviewers are required.",
        }
    index = {(rating.reviewer_id, rating.case_id, rating.condition): rating for rating in ratings}
    agreement: dict[str, Any] = {"available": True, "conditions": {}}
    for condition in conditions:
        fields = {}
        for field in (*ORDINAL_RATING_FIELDS, BINARY_RATING_FIELD):
            pair_values = []
            for left_reviewer, right_reviewer in itertools.combinations(reviewers, 2):
                shared_cases = sorted(
                    {
                        rating.case_id
                        for rating in ratings
                        if rating.condition == condition
                        and (left_reviewer, rating.case_id, condition) in index
                        and (right_reviewer, rating.case_id, condition) in index
                    }
                )
                if len(shared_cases) < 2:
                    continue
                left = [
                    getattr(index[(left_reviewer, case_id, condition)], field)
                    for case_id in shared_cases
                ]
                right = [
                    getattr(index[(right_reviewer, case_id, condition)], field)
                    for case_id in shared_cases
                ]
                score = None
                if len(set(left)) != 1 or len(set(right)) != 1:
                    computed = cohen_kappa_score(
                        left,
                        right,
                        weights=("quadratic" if field in ORDINAL_RATING_FIELDS else None),
                    )
                    if np.isfinite(computed):
                        score = float(computed)
                pair_values.append(
                    {
                        "reviewers": [left_reviewer, right_reviewer],
                        "cases": len(shared_cases),
                        "observed_agreement": sum(
                            left_value == right_value
                            for left_value, right_value in zip(
                                left,
                                right,
                                strict=True,
                            )
                        )
                        / len(shared_cases),
                        "cohen_kappa": score,
                    }
                )
            fields[field] = {
                "reviewer_pairs": pair_values,
                "mean_cohen_kappa": (
                    float(
                        np.mean(
                            [
                                pair["cohen_kappa"]
                                for pair in pair_values
                                if pair["cohen_kappa"] is not None
                            ]
                        )
                    )
                    if any(pair["cohen_kappa"] is not None for pair in pair_values)
                    else None
                ),
            }
        agreement["conditions"][condition] = fields
    return agreement


def _load_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Expected a JSON object: {path}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reviews", type=Path, nargs="+", required=True)
    parser.add_argument("--condition-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--unblinded-output", type=Path)
    parser.add_argument("--bootstrap-samples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20260724)
    args = parser.parse_args()

    ratings = GenerationReviewUnblinder().unblind(
        [_load_object(path) for path in args.reviews],
        _load_object(args.condition_key),
    )
    summary = summarize_reviews(
        ratings,
        bootstrap_samples=args.bootstrap_samples,
        seed=args.seed,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    if args.unblinded_output is not None:
        args.unblinded_output.parent.mkdir(parents=True, exist_ok=True)
        with args.unblinded_output.open("w", encoding="utf-8") as destination:
            for rating in ratings:
                destination.write(json.dumps(rating.as_dict()) + "\n")


if __name__ == "__main__":
    main()
