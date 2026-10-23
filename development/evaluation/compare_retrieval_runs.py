"""Paired comparison of two frozen validation retrieval runs."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)


def read_rows(path: Path) -> dict[str, dict[str, Any]]:
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


def rank(row: dict[str, Any]) -> int | None:
    expected = str(row["expected_video_id"])
    for index, item in enumerate(row.get("retrieved", []), start=1):
        if str(item.get("video_id")) == expected:
            return index
    return None


def _metrics(rows: list[dict[str, Any]], k: int) -> dict[str, float | int]:
    ranks = [rank(row) for row in rows]
    return {
        "samples": len(rows),
        "recall_at_1": sum(value == 1 for value in ranks) / len(rows) if rows else 0.0,
        f"recall_at_{k}": sum(value is not None and value <= k for value in ranks) / len(rows)
        if rows
        else 0.0,
        "mean_reciprocal_rank": sum(1 / value if value is not None else 0.0 for value in ranks)
        / len(rows)
        if rows
        else 0.0,
    }


def compare(baseline_path: Path, candidate_path: Path, *, top_k: int = 5) -> dict[str, Any]:
    baseline, candidate = read_rows(baseline_path), read_rows(candidate_path)
    if baseline.keys() != candidate.keys():
        raise ValueError("Retrieval files must contain the same validation sample IDs")
    ids = sorted(baseline)
    for sample_id in ids:
        if baseline[sample_id].get("expected_video_id") != candidate[sample_id].get(
            "expected_video_id"
        ):
            raise ValueError(f"Expected video differs for sample {sample_id}")
    left = [baseline[sample_id] for sample_id in ids]
    right = [candidate[sample_id] for sample_id in ids]
    base_metrics, candidate_metrics = _metrics(left, top_k), _metrics(right, top_k)
    base_ranks, candidate_ranks = [rank(row) for row in left], [rank(row) for row in right]
    return {
        "protocol": "paired-validation-only-retrieval-comparison",
        "primary_metric": f"recall_at_{top_k}",
        "secondary_metrics": ["recall_at_1", "mean_reciprocal_rank"],
        "top_k": top_k,
        "baseline_path": str(baseline_path),
        "candidate_path": str(candidate_path),
        "baseline": base_metrics,
        "candidate": candidate_metrics,
        "delta_candidate_minus_baseline": {
            key: candidate_metrics[key] - base_metrics[key]
            for key in ("recall_at_1", f"recall_at_{top_k}", "mean_reciprocal_rank")
        },
        "candidate_only_top5_successes": sum(
            (new is not None and new <= top_k) and not (old is not None and old <= top_k)
            for old, new in zip(base_ranks, candidate_ranks, strict=True)
        ),
        "baseline_only_top5_successes": sum(
            (old is not None and old <= top_k) and not (new is not None and new <= top_k)
            for old, new in zip(base_ranks, candidate_ranks, strict=True)
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--top-k", type=int, default=5)
    args = parser.parse_args()
    if args.top_k < 1:
        parser.error("top-k must be positive")
    result = compare(args.baseline, args.candidate, top_k=args.top_k)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    LOGGER.info("Paired retrieval comparison: %s", json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
