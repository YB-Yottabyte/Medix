"""Tune and evaluate transcript-window localization on official MedVidQA splits."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from sentence_transformers import SentenceTransformer

from backend.domain import LocalizationRequest
from backend.temporal_localization import TranscriptWindowLocalizer
from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from evaluation.medvidqa_dataset import MedVidQASample, OfficialMedVidQADataset
from evaluation.metrics import summarize_localization_predictions
from evaluation.run_temporal_baselines import evaluate_localizer
from evaluation.temporal_baselines import (
    RandomGuessLocalizer,
    RandomModeLocalizer,
    validation_mode_duration,
)

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


def evaluate_transcript_localizer(
    samples: tuple[MedVidQASample, ...],
    localizer: TranscriptWindowLocalizer,
) -> list[dict[str, Any]]:
    """Count unavailable transcripts as missing predictions, not removed samples."""
    predictions = []
    for sample in samples:
        request = LocalizationRequest(
            question=sample.question,
            video_id=sample.video_id,
            duration_seconds=sample.video_duration_seconds,
        )
        try:
            segment = localizer.localize(request)
            predicted_video_id: str | None = segment.video_id
            predicted_start: float | None = segment.start_seconds
            predicted_end: float | None = segment.end_seconds
            localization_score: float | None = segment.localization_score
            transcript_available = True
        except TranscriptUnavailableError:
            predicted_video_id = None
            predicted_start = None
            predicted_end = None
            localization_score = None
            transcript_available = False

        predictions.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "predicted_video_id": predicted_video_id,
                "predicted_start": predicted_start,
                "predicted_end": predicted_end,
                "localization_score": localization_score,
                "model_name": localizer.model_name,
                "transcript_available": transcript_available,
            }
        )
    return predictions


def localization_report(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Return official full-split metrics plus covered-only diagnostics."""
    covered = [record for record in records if record["transcript_available"]]
    return {
        "all_samples": summarize_localization_predictions(records),
        "transcript_available_samples": summarize_localization_predictions(covered),
        "transcript_coverage": len(covered) / len(records) if records else 0.0,
        "available_questions": len(covered),
        "total_questions": len(records),
        "available_videos": len({record["expected_video_id"] for record in covered}),
    }


def select_configuration(
    validation_results: list[tuple[TranscriptWindowLocalizer, list[dict[str, Any]]]],
) -> tuple[TranscriptWindowLocalizer, list[dict[str, Any]], list[dict[str, Any]]]:
    """Select only from validation metrics; test annotations are never consulted."""
    candidates = []
    for localizer, records in validation_results:
        report = localization_report(records)
        candidates.append(
            {
                "model_name": localizer.model_name,
                "window_seconds": localizer.window_seconds,
                "stride_seconds": localizer.stride_seconds,
                **report,
            }
        )
    best_index = max(
        range(len(candidates)),
        key=lambda index: (
            candidates[index]["all_samples"]["mean_iou"],
            candidates[index]["all_samples"]["r_at_1_iou_0.5"],
            -candidates[index]["window_seconds"],
        ),
    )
    best_localizer, best_records = validation_results[best_index]
    return best_localizer, best_records, candidates


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=PROJECT_ROOT / "MedVidQA",
    )
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "transcript_localization",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--window-sizes", nargs="+", type=float, default=(15, 30, 45, 60, 90))
    parser.add_argument("--stride-ratio", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if not 0 < args.stride_ratio <= 1:
        raise ValueError("stride-ratio must be greater than zero and at most one")

    dataset = OfficialMedVidQADataset.load(args.dataset_dir)
    repository = CachedTranscriptRepository(args.transcript_cache)
    encoder = SentenceTransformer(args.model, revision=args.revision)

    validation_results = []
    for window_seconds in args.window_sizes:
        localizer = TranscriptWindowLocalizer(
            repository=repository,
            encoder=encoder,
            window_seconds=window_seconds,
            stride_seconds=window_seconds * args.stride_ratio,
            embedding_model_name=f"{args.model}@{args.revision}",
        )
        validation_results.append(
            (
                localizer,
                evaluate_transcript_localizer(dataset.validation, localizer),
            )
        )

    selected, selected_validation, tuning_candidates = select_configuration(validation_results)
    test_predictions = evaluate_transcript_localizer(dataset.test, selected)
    covered_sample_ids = {
        record["sample_id"] for record in test_predictions if record["transcript_available"]
    }
    covered_test_samples = tuple(
        sample for sample in dataset.test if sample.sample_id in covered_sample_ids
    )
    random_mode = RandomModeLocalizer(
        validation_mode_duration(dataset.validation),
        seed=args.seed,
    )
    random_guess = RandomGuessLocalizer(seed=args.seed)
    covered_random_baselines = {
        localizer.model_name: summarize_localization_predictions(
            evaluate_localizer(covered_test_samples, localizer)
        )
        for localizer in (random_mode, random_guess)
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    _write_jsonl(args.output_dir / "validation.jsonl", selected_validation)
    _write_jsonl(args.output_dir / "test.jsonl", test_predictions)

    summary = {
        "selection_protocol": "window size selected by full validation mean IoU",
        "model": selected.model_name,
        "selected_window_seconds": selected.window_seconds,
        "selected_stride_seconds": selected.stride_seconds,
        "validation_candidates": tuning_candidates,
        "validation": localization_report(selected_validation),
        "test": localization_report(test_predictions),
        "covered_test_random_baselines": covered_random_baselines,
        "random_seed": args.seed,
    }
    (args.output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("Transcript localization summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
