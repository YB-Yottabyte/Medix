"""Fast validation candidate-score replay; does not verify new evidence extraction.

Only existing successfully localized candidates are eligible. Counterfactual
selections may not have been extracted by the original run, so these are scoring
ablations, not replacements for final end-to-end evaluation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from development.evaluation.metrics import interval_iou


def replay(records, weight):
    predictions = []
    for row in records:
        candidates = [
            c
            for c in row["retrieved"]
            if not c.get("failure_reason") and c.get("localization_score") is not None
        ]

        def score(candidate):
            if weight == "rank":
                return -candidate["rank"]
            retrieval = float(np.clip((candidate["retrieval_score"] + 1) / 2, 0, 1))
            return weight * retrieval + (1 - weight) * candidate["localization_score"]

        best = max(candidates, key=lambda c: (score(c), -c["rank"])) if candidates else None
        correct = bool(best and best["video_id"] == row["expected_video_id"])
        iou = (
            interval_iou(
                row["expected_start"],
                row["expected_end"],
                best["predicted_start"],
                best["predicted_end"],
            )
            if correct
            else 0.0
        )
        predictions.append(
            {
                "sample_id": row["sample_id"],
                "video_id": best["video_id"] if best else None,
                "correct_video": correct,
                "iou": iou,
            }
        )
    return predictions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    from development.evaluation.medvidqa_dataset import load_official_split

    samples = load_official_split(Path(__file__).resolve().parents[2] / "MedVidQA/val.json")
    records = [
        json.loads(line) for line in args.predictions.read_text().splitlines() if line.strip()
    ]
    expected = {s.sample_id: s for s in samples}
    if len(records) != len(expected) or {r["sample_id"] for r in records} != set(expected):
        raise ValueError("Expected exactly the official 145 validation records")
    for row in records:
        sample = expected[row["sample_id"]]
        if (row["expected_video_id"], row["expected_start"], row["expected_end"]) != (
            sample.video_id,
            sample.answer_start_seconds,
            sample.answer_end_seconds,
        ):
            raise ValueError("Prediction labels do not match validation")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    summary = {
        "protocol": __doc__,
        "input_sha256": hashlib.sha256(args.predictions.read_bytes()).hexdigest(),
        "experiments": {},
    }
    for weight in ("rank", 0.0, 0.25, 0.5, 0.75, 1.0):
        rows = replay(records, weight)
        summary["experiments"][str(weight)] = {
            "selected_video_accuracy": float(np.mean([r["correct_video"] for r in rows])),
            "mean_iou": float(np.mean([r["iou"] for r in rows])),
            "iou_at_0.5": float(np.mean([r["iou"] >= 0.5 for r in rows])),
        }
        (args.output_dir / f"weight-{weight}.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in rows)
        )
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
