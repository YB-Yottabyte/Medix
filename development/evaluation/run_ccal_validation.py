"""Evaluate a trained transcript span localizer on validation only."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from backend.domain import LocalizationRequest
from backend.temporal_localization import CCALSpanLocalizer, TransformersCCALSpanPredictor
from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from development.evaluation.medvidqa_dataset import load_official_split
from development.evaluation.metrics import summarize_localization_predictions

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checkpoint_file_hashes(checkpoint: Path) -> dict[str, str]:
    return {
        str(path.relative_to(checkpoint)): sha256_file(path)
        for path in sorted(checkpoint.rglob("*"))
        if path.is_file()
    }


def evaluate_validation(
    dataset_dir: Path, transcript_cache: Path, checkpoint: Path
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    validation_samples = load_official_split(dataset_dir / "val.json")
    predictor = TransformersCCALSpanPredictor.from_checkpoint(checkpoint)
    localizer = CCALSpanLocalizer(
        repository=CachedTranscriptRepository(transcript_cache),
        predictor=predictor,
    )
    records = []
    for sample in validation_samples:
        request = LocalizationRequest(
            question=sample.question,
            video_id=sample.video_id,
            duration_seconds=sample.video_duration_seconds,
        )
        try:
            segment = localizer.localize(request)
            predicted_start: float | None = segment.start_seconds
            predicted_end: float | None = segment.end_seconds
            available = True
        except TranscriptUnavailableError:
            predicted_start = predicted_end = None
            available = False
        records.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "predicted_video_id": sample.video_id if available else None,
                "predicted_start": predicted_start,
                "predicted_end": predicted_end,
                "transcript_available": available,
                "model_name": localizer.model_name,
            }
        )

    available_records = [row for row in records if row["transcript_available"]]
    summary = {
        "protocol": "validation-only-oracle-target-video-ccal-span-localization",
        "selection_metric_primary": "r_at_1_iou_0.5",
        "selection_metric_secondary": "mean_iou",
        "split": "validation",
        "sample_count": len(records),
        "transcript_available_count": len(available_records),
        "transcript_coverage": len(available_records) / len(records) if records else 0.0,
        "all_samples": summarize_localization_predictions(records),
        "transcript_available_samples": summarize_localization_predictions(available_records),
        "checkpoint": str(checkpoint),
        "checkpoint_metadata_sha256": sha256_file(checkpoint / "metadata.json"),
        "checkpoint_file_hashes": checkpoint_file_hashes(checkpoint),
        "validation_annotations_sha256": sha256_file(dataset_dir / "val.json"),
        "test_split_read": False,
    }
    return records, summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument("--transcript-cache", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    records, summary = evaluate_validation(args.dataset_dir, args.transcript_cache, args.checkpoint)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "validation.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in records), encoding="utf-8"
    )
    (args.output_dir / "validation-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    LOGGER.info("CCAL validation complete: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
