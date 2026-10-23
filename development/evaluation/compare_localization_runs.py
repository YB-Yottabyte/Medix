"""Paired validation-only comparison for timestamp prediction JSONL files."""

from __future__ import annotations

import argparse
import json
import logging
import random
from pathlib import Path
from typing import Any

from development.evaluation.metrics import interval_iou

LOGGER = logging.getLogger(__name__)


def read_predictions(path: Path) -> dict[str, dict[str, Any]]:
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        sample_id = str(row["sample_id"])
        if sample_id in rows:
            raise ValueError(f"Duplicate sample_id {sample_id} in {path}")
        rows[sample_id] = row
    return rows


def _iou(row: dict[str, Any]) -> float:
    if row.get("predicted_video_id") not in (None, row.get("expected_video_id")):
        return 0.0
    return interval_iou(
        float(row["expected_start"]),
        float(row["expected_end"]),
        None if row.get("predicted_start") is None else float(row["predicted_start"]),
        None if row.get("predicted_end") is None else float(row["predicted_end"]),
    )


def _bootstrap_ci(values: list[float], *, seed: int, iterations: int) -> list[float]:
    if not values:
        return [0.0, 0.0]
    rng = random.Random(seed)  # noqa: S311 - deterministic bootstrap sampling, not cryptography
    estimates = sorted(
        sum(values[rng.randrange(len(values))] for _ in values) / len(values)
        for _ in range(iterations)
    )
    return [estimates[int((iterations - 1) * 0.025)], estimates[int((iterations - 1) * 0.975)]]


def compare(
    baseline_path: Path, candidate_path: Path, *, seed: int = 42, iterations: int = 10000
) -> dict[str, Any]:
    baseline = read_predictions(baseline_path)
    candidate = read_predictions(candidate_path)
    if baseline.keys() != candidate.keys():
        raise ValueError("Prediction files must contain the same validation sample IDs")
    ids = sorted(baseline)
    for sample_id in ids:
        left, right = baseline[sample_id], candidate[sample_id]
        for key in ("expected_video_id", "expected_start", "expected_end"):
            if left.get(key) != right.get(key):
                raise ValueError(f"Ground-truth field {key} differs for {sample_id}")
    base_ious = [_iou(baseline[sample_id]) for sample_id in ids]
    candidate_ious = [_iou(candidate[sample_id]) for sample_id in ids]
    delta_iou = [new - old for old, new in zip(base_ious, candidate_ious, strict=True)]
    delta_success = [
        float(new >= 0.5) - float(old >= 0.5)
        for old, new in zip(base_ious, candidate_ious, strict=True)
    ]
    return {
        "protocol": "paired-validation-only-bootstrap",
        "primary_metric": "r_at_1_iou_0.5",
        "secondary_metric": "mean_iou",
        "samples": len(ids),
        "baseline": str(baseline_path),
        "candidate": str(candidate_path),
        "baseline_mean_iou": sum(base_ious) / len(ids) if ids else 0.0,
        "candidate_mean_iou": sum(candidate_ious) / len(ids) if ids else 0.0,
        "mean_iou_delta_candidate_minus_baseline": sum(delta_iou) / len(ids) if ids else 0.0,
        "mean_iou_delta_95pct_bootstrap_ci": _bootstrap_ci(
            delta_iou, seed=seed, iterations=iterations
        ),
        "baseline_r_at_1_iou_0.5": sum(value >= 0.5 for value in base_ious) / len(ids)
        if ids
        else 0.0,
        "candidate_r_at_1_iou_0.5": sum(value >= 0.5 for value in candidate_ious) / len(ids)
        if ids
        else 0.0,
        "r_at_1_iou_0.5_delta_candidate_minus_baseline": sum(delta_success) / len(ids)
        if ids
        else 0.0,
        "r_at_1_iou_0.5_delta_95pct_bootstrap_ci": _bootstrap_ci(
            delta_success, seed=seed + 1, iterations=iterations
        ),
        "candidate_only_successes": sum(
            new >= 0.5 and old < 0.5 for old, new in zip(base_ious, candidate_ious, strict=True)
        ),
        "baseline_only_successes": sum(
            old >= 0.5 and new < 0.5 for old, new in zip(base_ious, candidate_ious, strict=True)
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--iterations", type=int, default=10000)
    args = parser.parse_args()
    result = compare(args.baseline, args.candidate, seed=args.seed, iterations=args.iterations)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    LOGGER.info("Paired localization comparison: %s", json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
