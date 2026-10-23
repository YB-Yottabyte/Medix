"""Validation-only transcript/frame reranking; never reads test annotations."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from sentence_transformers import SentenceTransformer

from backend.adapters.visual_similarity import ClipFrameScorer
from backend.domain import LocalizationRequest
from backend.temporal_localization import MultimodalWindowLocalizer, TranscriptWindowLocalizer
from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from backend.video_processing import (
    FFmpegFrameExtractor,
    LocalVideoRepository,
    VideoUnavailableError,
)
from development.evaluation.medvidqa_dataset import load_official_split
from development.evaluation.metrics import summarize_localization_predictions

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEXT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
TEXT_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
CLIP_MODEL = "openai/clip-vit-base-patch32"
CLIP_REVISION = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def evaluate(
    samples: tuple[Any, ...], localizer: MultimodalWindowLocalizer
) -> list[dict[str, Any]]:
    output = []
    for sample in samples:
        req = LocalizationRequest(sample.question, sample.video_id, sample.video_duration_seconds)
        try:
            result = localizer.localize_with_details(req)
            start, end = result.segment.start_seconds, result.segment.end_seconds
            transcript_ok, visual_ok = True, result.used_visual_evidence
            scores = {
                "transcript_score": result.transcript_score,
                "visual_score": result.visual_score,
                "fusion_score": result.fusion_score,
            }
        except TranscriptUnavailableError:
            start = end = None
            transcript_ok = visual_ok = False
            scores = {"transcript_score": None, "visual_score": None, "fusion_score": None}
        except VideoUnavailableError as exc:
            raise AssertionError(
                "MultimodalWindowLocalizer should use its configured transcript fallback"
            ) from exc
        output.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "predicted_video_id": sample.video_id if transcript_ok else None,
                "predicted_start": start,
                "predicted_end": end,
                "transcript_available": transcript_ok,
                "visual_available": visual_ok,
                "model_name": localizer.model_name,
                **scores,
            }
        )
    return output


def evaluate_transcript_only(
    samples: tuple[Any, ...], localizer: TranscriptWindowLocalizer
) -> list[dict[str, Any]]:
    output = []
    for sample in samples:
        request = LocalizationRequest(
            sample.question, sample.video_id, sample.video_duration_seconds
        )
        try:
            segment = localizer.localize(request)
            start: float | None = segment.start_seconds
            end: float | None = segment.end_seconds
            available = True
        except TranscriptUnavailableError:
            start = end = None
            available = False
        output.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "predicted_video_id": sample.video_id if available else None,
                "predicted_start": start,
                "predicted_end": end,
                "transcript_available": available,
                "visual_available": False,
                "model_name": localizer.model_name,
                "transcript_score": None,
                "visual_score": None,
                "fusion_score": None,
            }
        )
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument("--transcript-cache", type=Path, required=True)
    parser.add_argument("--video-cache", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--window-seconds", type=float, default=90)
    parser.add_argument("--stride-seconds", type=float, default=45)
    parser.add_argument("--frames-per-window", type=int, default=3)
    parser.add_argument(
        "--transcript-weights", nargs="+", type=float, default=(0.0, 0.25, 0.5, 0.75)
    )
    args = parser.parse_args()
    if any(weight < 0 or weight > 1 for weight in args.transcript_weights):
        parser.error("transcript weights must be between 0 and 1")

    validation_samples = load_official_split(args.dataset_dir / "val.json")
    transcript_repo = CachedTranscriptRepository(args.transcript_cache)
    text_encoder = SentenceTransformer(TEXT_MODEL, revision=TEXT_REVISION)
    transcript_localizer = TranscriptWindowLocalizer(
        repository=transcript_repo,
        encoder=text_encoder,
        window_seconds=args.window_seconds,
        stride_seconds=args.stride_seconds,
        embedding_model_name=f"{TEXT_MODEL}@{TEXT_REVISION}",
    )
    frame_extractor = FFmpegFrameExtractor(LocalVideoRepository(args.video_cache))
    frame_scorer = ClipFrameScorer(CLIP_MODEL, revision=CLIP_REVISION)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    text_records = evaluate_transcript_only(validation_samples, transcript_localizer)
    text_path = args.output_dir / "validation-transcript-only.jsonl"
    text_path.write_text("".join(json.dumps(row) + "\n" for row in text_records), encoding="utf-8")
    candidates = [
        {
            "candidate": "transcript-only",
            "transcript_weight": 1.0,
            "visual_weight": 0.0,
            "prediction_path": str(text_path),
            "all_samples": summarize_localization_predictions(text_records),
            "transcript_available_samples": summarize_localization_predictions(
                [row for row in text_records if row["transcript_available"]]
            ),
            "visual_available_samples": summarize_localization_predictions([]),
            "transcript_coverage": sum(row["transcript_available"] for row in text_records)
            / len(text_records),
            "visual_coverage": 0.0,
        }
    ]
    for weight in args.transcript_weights:
        localizer = MultimodalWindowLocalizer(
            transcript_localizer=transcript_localizer,
            frame_extractor=frame_extractor,
            frame_scorer=frame_scorer,
            transcript_weight=weight,
            frames_per_window=args.frames_per_window,
        )
        records = evaluate(validation_samples, localizer)
        path = args.output_dir / f"validation-transcript-weight-{weight:g}.jsonl"
        path.write_text("".join(json.dumps(row) + "\n" for row in records), encoding="utf-8")
        covered = [row for row in records if row["transcript_available"]]
        visual = [row for row in records if row["visual_available"]]
        candidates.append(
            {
                "candidate": "transcript-plus-frames",
                "transcript_weight": weight,
                "visual_weight": 1.0 - weight,
                "prediction_path": str(path),
                "all_samples": summarize_localization_predictions(records),
                "transcript_available_samples": summarize_localization_predictions(covered),
                "visual_available_samples": summarize_localization_predictions(visual),
                "transcript_coverage": len(covered) / len(records) if records else 0.0,
                "visual_coverage": len(visual) / len(records) if records else 0.0,
            }
        )
    summary = {
        "protocol": "validation-only-oracle-target-video-transcript-frame-reranking",
        "split": "validation",
        "selection_metric_primary": "r_at_1_iou_0.5",
        "selection_metric_secondary": "mean_iou",
        "test_split_read": False,
        "sample_count": len(validation_samples),
        "window_seconds": args.window_seconds,
        "stride_seconds": args.stride_seconds,
        "frames_per_window": args.frames_per_window,
        "text_model": f"{TEXT_MODEL}@{TEXT_REVISION}",
        "visual_model": f"{CLIP_MODEL}@{CLIP_REVISION}",
        "validation_annotations_sha256": sha256_file(args.dataset_dir / "val.json"),
        "candidates": candidates,
    }
    (args.output_dir / "validation-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    LOGGER.info("Validation frame reranking complete: %s", args.output_dir)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
