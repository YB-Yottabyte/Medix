"""Extract and validate evidence bundles from frozen localization predictions."""

from __future__ import annotations

import argparse
import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any

from backend.evidence import (
    EvidenceArtifactStore,
    EvidenceExtractionRequest,
    EvidenceExtractor,
    EvidenceUnavailableError,
)
from backend.transcripts import CachedTranscriptRepository
from backend.video_processing import (
    FFmpegClipExtractor,
    FFmpegFrameExtractor,
    LocalVideoRepository,
)

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def run_extraction(
    records: list[dict[str, Any]],
    extractor: EvidenceExtractor,
    *,
    artifact_store: EvidenceArtifactStore,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    outcomes = []
    duration_errors = []
    failure_reasons: Counter[str] = Counter()
    predicted_records = 0
    for record in records:
        if record.get("predicted_start") is None or record.get("predicted_end") is None:
            failure_reasons["no_localization_prediction"] += 1
            outcomes.append(
                {
                    "sample_id": record["sample_id"],
                    "status": "unavailable",
                    "reason": "no_localization_prediction",
                }
            )
            continue

        predicted_records += 1
        request = EvidenceExtractionRequest(
            question=str(record["question"]),
            video_id=str(record["predicted_video_id"]),
            source_uri=f"https://www.youtube.com/watch?v={record['predicted_video_id']}",
            start_seconds=float(record["predicted_start"]),
            end_seconds=float(record["predicted_end"]),
            localization_model=str(record["model_name"]),
            scores={
                "localization": _optional_float(record.get("localization_score")),
                "transcript": _optional_float(record.get("transcript_score")),
                "visual": _optional_float(record.get("visual_score")),
                "fusion": _optional_float(record.get("fusion_score")),
            },
            provenance={
                "evaluation_protocol": "frozen-multimodal-test-prediction",
                "transcript_available": bool(record.get("transcript_available")),
                "visual_available": bool(record.get("visual_available")),
            },
        )
        try:
            bundle = extractor.extract(request)
        except EvidenceUnavailableError as exc:
            reason = _failure_reason(exc)
            failure_reasons[reason] += 1
            outcomes.append(
                {
                    "sample_id": record["sample_id"],
                    "status": "unavailable",
                    "reason": reason,
                }
            )
            continue

        expected_duration = request.end_seconds - request.start_seconds
        duration_error = abs(bundle.clip.duration_seconds - expected_duration)
        duration_errors.append(duration_error)
        outcomes.append(
            {
                "sample_id": record["sample_id"],
                "status": "extracted",
                "bundle_id": bundle.bundle_id,
                "manifest_path": artifact_store.relative_path(
                    artifact_store.manifest_path(bundle.bundle_id)
                ),
                "video_id": bundle.video_id,
                "predicted_start": bundle.predicted_start_seconds,
                "predicted_end": bundle.predicted_end_seconds,
                "transcript_cues": len(bundle.transcript),
                "frames": len(bundle.frames),
                "clip_duration_seconds": bundle.clip.duration_seconds,
                "clip_duration_error_seconds": duration_error,
            }
        )

    successful = sum(outcome["status"] == "extracted" for outcome in outcomes)
    total = len(records)
    summary = {
        "samples": total,
        "localized_samples": predicted_records,
        "extracted_bundles": successful,
        "full_split_evidence_coverage": successful / total if total else 0.0,
        "localized_sample_extraction_success": (
            successful / predicted_records if predicted_records else 0.0
        ),
        "failure_reasons": dict(sorted(failure_reasons.items())),
        "mean_clip_duration_error_seconds": (
            sum(duration_errors) / len(duration_errors) if duration_errors else None
        ),
        "max_clip_duration_error_seconds": max(duration_errors, default=None),
        "artifact_schema_version": 1,
        "contains_gold_timestamps": False,
    }
    return outcomes, summary


def _failure_reason(error: EvidenceUnavailableError) -> str:
    message = str(error).lower()
    if "transcript" in message:
        return "transcript_unavailable"
    if "video" in message or "frame" in message or "clip" in message:
        return "video_or_media_unavailable"
    return "evidence_unavailable"


def _optional_float(value: Any) -> float | None:
    return float(value) if value is not None else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--predictions",
        type=Path,
        default=(
            PROJECT_ROOT / "evaluation" / "results" / "multimodal_localization" / "test.jsonl"
        ),
    )
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
        "--artifact-root",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "artifacts" / "evidence",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "evidence_extraction",
    )
    parser.add_argument("--frames-per-bundle", type=int, default=3)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    records = _read_jsonl(args.predictions)
    if args.limit is not None:
        if args.limit < 1:
            raise ValueError("limit must be positive")
        records = records[: args.limit]

    video_repository = LocalVideoRepository(args.video_cache)
    store = EvidenceArtifactStore(args.artifact_root)
    extractor = EvidenceExtractor(
        transcript_repository=CachedTranscriptRepository(args.transcript_cache),
        frame_extractor=FFmpegFrameExtractor(video_repository),
        clip_extractor=FFmpegClipExtractor(video_repository),
        store=store,
        frames_per_bundle=args.frames_per_bundle,
    )
    outcomes, summary = run_extraction(records, extractor, artifact_store=store)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / "index.jsonl").open("w", encoding="utf-8") as output:
        for outcome in outcomes:
            output.write(json.dumps(outcome) + "\n")
    (args.output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("Evidence extraction summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
