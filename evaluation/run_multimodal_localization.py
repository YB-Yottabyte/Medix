"""Evaluate CLIP visual reranking of transcript temporal windows."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from sentence_transformers import SentenceTransformer

from backend.adapters.visual_similarity import ClipFrameScorer
from backend.domain import LocalizationRequest
from backend.temporal_localization import (
    MultimodalWindowLocalizer,
    TranscriptWindowLocalizer,
)
from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from backend.video_processing import FFmpegFrameExtractor, LocalVideoRepository
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
TEXT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
TEXT_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
VISUAL_MODEL = "openai/clip-vit-base-patch32"
VISUAL_REVISION = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"


def evaluate_multimodal_localizer(
    samples: tuple[MedVidQASample, ...],
    localizer: MultimodalWindowLocalizer,
) -> list[dict[str, Any]]:
    predictions = []
    for sample in samples:
        request = LocalizationRequest(
            question=sample.question,
            video_id=sample.video_id,
            duration_seconds=sample.video_duration_seconds,
        )
        try:
            result = localizer.localize_with_details(request)
            segment = result.segment
            prediction = {
                "predicted_video_id": segment.video_id,
                "predicted_start": segment.start_seconds,
                "predicted_end": segment.end_seconds,
                "localization_score": segment.localization_score,
                "transcript_available": True,
                "visual_available": result.used_visual_evidence,
                "transcript_score": result.transcript_score,
                "visual_score": result.visual_score,
                "fusion_score": result.fusion_score,
            }
        except TranscriptUnavailableError:
            prediction = {
                "predicted_video_id": None,
                "predicted_start": None,
                "predicted_end": None,
                "localization_score": None,
                "transcript_available": False,
                "visual_available": False,
                "transcript_score": None,
                "visual_score": None,
                "fusion_score": None,
            }
        predictions.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "model_name": localizer.model_name,
                **prediction,
            }
        )
    return predictions


def multimodal_report(records: list[dict[str, Any]]) -> dict[str, Any]:
    transcript_covered = [record for record in records if record["transcript_available"]]
    visual_covered = [record for record in records if record["visual_available"]]
    count = len(records)
    return {
        "all_samples": summarize_localization_predictions(records),
        "transcript_available_samples": summarize_localization_predictions(transcript_covered),
        "visual_available_samples": summarize_localization_predictions(visual_covered),
        "transcript_coverage": len(transcript_covered) / count if count else 0.0,
        "visual_coverage": len(visual_covered) / count if count else 0.0,
        "visual_available_questions": len(visual_covered),
        "visual_available_videos": len({record["expected_video_id"] for record in visual_covered}),
    }


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument(
        "--video-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "video_cache",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "multimodal_localization",
    )
    parser.add_argument("--text-model", default=TEXT_MODEL)
    parser.add_argument("--text-revision", default=TEXT_REVISION)
    parser.add_argument("--visual-model", default=VISUAL_MODEL)
    parser.add_argument("--visual-revision", default=VISUAL_REVISION)
    parser.add_argument(
        "--transcript-weights",
        nargs="+",
        type=float,
        default=(0.0, 0.25, 0.5, 0.75),
    )
    parser.add_argument("--window-seconds", type=float, default=90)
    parser.add_argument("--stride-seconds", type=float, default=45)
    parser.add_argument("--frames-per-window", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if any(not 0 <= weight < 1 for weight in args.transcript_weights):
        raise ValueError("transcript weights must be at least zero and below one")

    dataset = OfficialMedVidQADataset.load(args.dataset_dir)
    repository = CachedTranscriptRepository(args.transcript_cache)
    text_encoder = SentenceTransformer(args.text_model, revision=args.text_revision)
    transcript_localizer = TranscriptWindowLocalizer(
        repository=repository,
        encoder=text_encoder,
        window_seconds=args.window_seconds,
        stride_seconds=args.stride_seconds,
        embedding_model_name=f"{args.text_model}@{args.text_revision}",
    )
    video_repository = LocalVideoRepository(args.video_cache)
    frame_extractor = FFmpegFrameExtractor(video_repository)
    frame_scorer = ClipFrameScorer(
        args.visual_model,
        revision=args.visual_revision,
    )

    validation_candidates = []
    validation_runs = []
    for weight in args.transcript_weights:
        localizer = MultimodalWindowLocalizer(
            transcript_localizer=transcript_localizer,
            frame_extractor=frame_extractor,
            frame_scorer=frame_scorer,
            transcript_weight=weight,
            frames_per_window=args.frames_per_window,
        )
        records = evaluate_multimodal_localizer(dataset.validation, localizer)
        report = multimodal_report(records)
        validation_runs.append((localizer, records, report))
        validation_candidates.append(
            {
                "transcript_weight": weight,
                "model_name": localizer.model_name,
                **report,
            }
        )

    selected, selected_validation, selected_validation_report = max(
        validation_runs,
        key=lambda run: (
            run[2]["all_samples"]["mean_iou"],
            run[2]["all_samples"]["r_at_1_iou_0.5"],
        ),
    )
    test_records = evaluate_multimodal_localizer(dataset.test, selected)
    visual_sample_ids = {
        record["sample_id"] for record in test_records if record["visual_available"]
    }
    visual_samples = tuple(
        sample for sample in dataset.test if sample.sample_id in visual_sample_ids
    )
    transcript_matched = summarize_localization_predictions(
        evaluate_localizer(visual_samples, transcript_localizer)
    )
    random_matched = {
        localizer.model_name: summarize_localization_predictions(
            evaluate_localizer(visual_samples, localizer)
        )
        for localizer in (
            RandomModeLocalizer(
                validation_mode_duration(dataset.validation),
                seed=args.seed,
            ),
            RandomGuessLocalizer(seed=args.seed),
        )
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    _write_jsonl(args.output_dir / "validation.jsonl", selected_validation)
    _write_jsonl(args.output_dir / "test.jsonl", test_records)
    summary = {
        "selection_protocol": "fusion weight selected by full validation mean IoU",
        "model": selected.model_name,
        "selected_transcript_weight": selected.transcript_weight,
        "selected_visual_weight": 1.0 - selected.transcript_weight,
        "window_seconds": args.window_seconds,
        "stride_seconds": args.stride_seconds,
        "frames_per_window": args.frames_per_window,
        "validation_candidates": validation_candidates,
        "validation": selected_validation_report,
        "test": multimodal_report(test_records),
        "visual_covered_test_transcript_baseline": transcript_matched,
        "visual_covered_test_random_baselines": random_matched,
        "random_seed": args.seed,
        "text_model": f"{args.text_model}@{args.text_revision}",
        "visual_model": f"{args.visual_model}@{args.visual_revision}",
    }
    (args.output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("Multimodal localization summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
