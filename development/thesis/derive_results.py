"""Derive paired, video-clustered uncertainty from frozen MedVidQA predictions.

This script never trains models or changes saved predictions. Run from the repository
root with ``python3 thesis/derive_results.py``.
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "evaluation" / "results"
OUTPUT = ROOT / "thesis" / "derived_results.json"
SEED = 572
RESAMPLES = 10_000


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def iou(record: dict) -> float:
    if record.get("predicted_video_id") != record["expected_video_id"]:
        return 0.0
    ps, pe = record.get("predicted_start"), record.get("predicted_end")
    if ps is None or pe is None:
        return 0.0
    gs, ge = record["expected_start"], record["expected_end"]
    intersection = max(0.0, min(ge, pe) - max(gs, ps))
    union = max(ge, pe) - min(gs, ps)
    return intersection / union if union > 0 else 0.0


def percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def cluster_ci(rows: list[dict], metrics: dict[str, list[float]]) -> dict:
    """Resample videos, retaining every question of a sampled video."""
    by_video: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        by_video[row["expected_video_id"]].append(index)
    videos = sorted(by_video)
    rng = random.Random(SEED)  # noqa: S311 -- deterministic statistical resampling, not secrets
    draws: dict[str, list[float]] = {name: [] for name in metrics}
    for _ in range(RESAMPLES):
        sampled = rng.choices(videos, k=len(videos))
        positions = [index for video in sampled for index in by_video[video]]
        for name, values in metrics.items():
            draws[name].append(sum(values[index] for index in positions) / len(positions))
    return {
        name: {
            "estimate": sum(values) / len(values),
            "ci_95": [percentile(draws[name], 0.025), percentile(draws[name], 0.975)],
        }
        for name, values in metrics.items()
    }


def main() -> None:
    end_to_end = load_jsonl(RESULTS / "end_to_end" / "test" / "predictions.jsonl")
    transcript = load_jsonl(RESULTS / "transcript_localization" / "test.jsonl")
    multimodal = load_jsonl(RESULTS / "multimodal_localization" / "test.jsonl")
    assert len(end_to_end) == len(transcript) == len(multimodal) == 155
    by_id = {row["sample_id"]: row for row in transcript}
    assert len(by_id) == 155
    assert all(row["sample_id"] in by_id for row in multimodal)

    end_metrics = {
        "top5_recall": [float(row["target_retrieved"]) for row in end_to_end],
        "evidence_coverage": [float(row["status"] == "answered") for row in end_to_end],
        "selected_video_accuracy": [
            float(row["predicted_video_id"] == row["expected_video_id"]) for row in end_to_end
        ],
        "correct_video_iou_at_05": [float(iou(row) >= 0.5) for row in end_to_end],
    }
    visual_rows = [row for row in multimodal if row["visual_available"]]
    visual_iou = [iou(row) for row in visual_rows]
    transcript_iou = [iou(by_id[row["sample_id"]]) for row in visual_rows]
    assert len(visual_rows) == 67
    visual_metrics = {
        "mean_iou_difference_visual_minus_transcript": [
            visual - text for visual, text in zip(visual_iou, transcript_iou, strict=True)
        ],
        "r_at_1_iou_05_difference_visual_minus_transcript": [
            float(visual >= 0.5) - float(text >= 0.5)
            for visual, text in zip(visual_iou, transcript_iou, strict=True)
        ],
    }
    output = {
        "protocol": "paired percentile bootstrap, sampling video IDs with replacement and retaining all their questions",
        "seed": SEED,
        "resamples": RESAMPLES,
        "end_to_end": {
            "questions": len(end_to_end),
            "videos": len({row["expected_video_id"] for row in end_to_end}),
            "metrics": cluster_ci(end_to_end, end_metrics),
            "contingency": {
                "target_in_top5_but_transcript_unavailable": sum(
                    row["target_retrieved"]
                    and any(
                        attempt["video_id"] == row["expected_video_id"]
                        and (attempt.get("failure_reason") or "").startswith(
                            "TranscriptUnavailableError"
                        )
                        for attempt in row["retrieved"]
                    )
                    for row in end_to_end
                ),
                "target_in_top5_and_localizable": sum(
                    row["target_retrieved"]
                    and any(
                        attempt["video_id"] == row["expected_video_id"]
                        and attempt.get("predicted_start") is not None
                        for attempt in row["retrieved"]
                    )
                    for row in end_to_end
                ),
                "abstained_target_in_top5": sum(
                    row["status"] != "answered" and row["target_retrieved"] for row in end_to_end
                ),
                "abstained_target_not_in_top5": sum(
                    row["status"] != "answered" and not row["target_retrieved"]
                    for row in end_to_end
                ),
                "answered_wrong_video": sum(
                    row["status"] == "answered"
                    and row["predicted_video_id"] != row["expected_video_id"]
                    for row in end_to_end
                ),
                "answered_correct_video": sum(
                    row["status"] == "answered"
                    and row["predicted_video_id"] == row["expected_video_id"]
                    for row in end_to_end
                ),
            },
        },
        "known_video_visual_matched": {
            "questions": len(visual_rows),
            "videos": len({row["expected_video_id"] for row in visual_rows}),
            "metrics": cluster_ci(visual_rows, visual_metrics),
        },
    }
    OUTPUT.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
