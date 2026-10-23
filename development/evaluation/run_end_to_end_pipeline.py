"""Evaluate retrieval, multimodal localization, and evidence extraction together."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.config import ProjectPaths, ResearchPipelineSettings
from backend.research_pipeline import ResearchPipelineFactory
from development.evaluation.frozen_retrieval import FrozenVideoRetriever
from development.evaluation.metrics import (
    recall_at_k,
    summarize_localization_predictions,
)

if TYPE_CHECKING:
    from backend.evidence import EvidenceArtifactStore
    from backend.services.end_to_end import EndToEndMedicalPipeline

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def evaluate_pipeline(
    samples: tuple[Any, ...],
    pipeline: EndToEndMedicalPipeline,
    *,
    artifact_store: EvidenceArtifactStore,
) -> list[dict[str, Any]]:
    records = []
    for sample in samples:
        started = time.monotonic()
        result = pipeline.run(sample.question)
        retrieved = [
            {
                "video_id": attempt.video_id,
                "rank": attempt.retrieval_rank,
                "retrieval_score": attempt.retrieval_score,
                "localization_score": attempt.localization_score,
                "joint_score": attempt.joint_score,
                "predicted_start": attempt.predicted_start_seconds,
                "predicted_end": attempt.predicted_end_seconds,
                "evidence_bundle_id": attempt.evidence_bundle_id,
                "failure_reason": attempt.failure_reason,
            }
            for attempt in result.attempts
        ]
        manifest_path = (
            artifact_store.relative_path(artifact_store.manifest_path(result.evidence.bundle_id))
            if result.evidence is not None
            else None
        )
        records.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "status": result.status,
                "predicted_video_id": result.selected_video_id,
                "predicted_start": result.predicted_start_seconds,
                "predicted_end": result.predicted_end_seconds,
                "joint_score": result.joint_score,
                "evidence_bundle_id": (
                    result.evidence.bundle_id if result.evidence is not None else None
                ),
                "evidence_manifest_path": manifest_path,
                "abstention_reason": result.abstention_reason,
                "retrieved": retrieved,
                "target_retrieved": bool(recall_at_k(sample.video_id, retrieved, pipeline.top_k)),
                "latency_ms": int((time.monotonic() - started) * 1000),
                "stage_timings_ms": dict(getattr(pipeline, "last_timings_ms", {})),
                "evaluation_protocol": "end-to-end-no-gold-inputs",
            }
        )
    return records


def end_to_end_report(records: list[dict[str, Any]]) -> dict[str, Any]:
    count = len(records)
    answered = [record for record in records if record["status"] == "answered"]
    correct_video = [
        record for record in answered if record["predicted_video_id"] == record["expected_video_id"]
    ]
    failure_reasons: dict[str, int] = {}
    for record in records:
        for attempt in record["retrieved"]:
            reason = attempt.get("failure_reason")
            if reason:
                category = reason.split(":", 1)[0]
                failure_reasons[category] = failure_reasons.get(category, 0) + 1
    latencies = [record["latency_ms"] for record in records]
    import numpy as np

    return {
        "latency_ms_percentiles": {
            str(p): float(np.percentile(latencies, p)) if latencies else 0.0 for p in (50, 95)
        },
        "mean_stage_timings_ms": {
            stage: sum(r.get("stage_timings_ms", {}).get(stage, 0) for r in records) / count
            if count
            else 0.0
            for stage in ("retrieval", "localization", "evidence")
        },
        "samples": count,
        "answered": len(answered),
        "answer_coverage": len(answered) / count if count else 0.0,
        "target_video_recall_at_k": (
            sum(record["target_retrieved"] for record in records) / count if count else 0.0
        ),
        "selected_video_accuracy": len(correct_video) / count if count else 0.0,
        "selected_video_accuracy_when_answered": (
            len(correct_video) / len(answered) if answered else 0.0
        ),
        "end_to_end_localization": summarize_localization_predictions(records),
        "mean_latency_ms": sum(latencies) / count if count else 0.0,
        "max_latency_ms": max(latencies, default=0),
        "candidate_failure_reasons": dict(sorted(failure_reasons.items())),
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
        "--catalog",
        type=Path,
        default=PROJECT_ROOT / "data" / "medvidqa_video_catalog.json",
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
        "--on-demand-video-cache",
        action="store_true",
        help="Acquire missing public media into --video-cache and apply LRU eviction.",
    )
    parser.add_argument(
        "--video-seed-cache",
        action="append",
        type=Path,
        default=[],
        help="Read-only validated media directory; repeat for multiple seed caches.",
    )
    parser.add_argument(
        "--video-source-index",
        type=Path,
        default=(
            PROJECT_ROOT
            / "development/evaluation/results/week1/2026-09-24-full-corpus-v1/source_index.json"
        ),
    )
    parser.add_argument(
        "--video-cache-metadata-dir",
        type=Path,
        help="Persistent acquisition/validation/eviction journal directory.",
    )
    parser.add_argument("--video-cache-max-gb", type=float, default=20.0)
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=PROJECT_ROOT / "development" / "evaluation" / "artifacts" / "end_to_end",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "development" / "evaluation" / "results" / "end_to_end",
    )
    parser.add_argument("--split", choices=("validation", "test"), default="validation")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--retrieval-weight", type=float, default=0.5)
    parser.add_argument(
        "--frozen-retrieval",
        type=Path,
        help="Replay exact candidate IDs and scores from a retrieval JSONL snapshot.",
    )
    parser.add_argument(
        "--sample-id",
        help="Evaluate one exact dataset sample, for a reproducible smoke run.",
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--feature-cache", type=Path)
    parser.add_argument("--visual-candidate-limit", type=int)
    parser.add_argument("--visual-device", choices=("cpu", "cuda", "mps"))
    parser.add_argument("--transcript-weight", type=float, default=0.5)
    parser.add_argument(
        "--localizer",
        choices=("multimodal_window", "transcript_window"),
        default="multimodal_window",
    )
    args = parser.parse_args()
    if not 0 <= args.transcript_weight <= 1:
        parser.error("--transcript-weight must be between zero and one")
    if args.visual_candidate_limit is not None and args.visual_candidate_limit < 1:
        parser.error("--visual-candidate-limit must be positive")
    if args.video_cache_max_gb <= 0:
        raise ValueError("video-cache-max-gb must be positive")
    metadata_dir = args.video_cache_metadata_dir or args.video_cache.with_name(
        f"{args.video_cache.name}-metadata"
    )

    paths = replace(
        ProjectPaths.discover(),
        video_catalog=args.catalog,
        transcript_cache=args.transcript_cache,
        video_cache=args.video_cache,
        video_cache_metadata=metadata_dir,
        video_source_index=args.video_source_index,
        video_seed_caches=tuple(args.video_seed_cache),
        research_artifacts=args.artifact_root,
    )
    components = ResearchPipelineFactory(
        settings=ResearchPipelineSettings(
            enabled=True,
            localizer_strategy=args.localizer,
            transcript_weight=args.transcript_weight,
            top_k=args.top_k,
            retrieval_weight=args.retrieval_weight,
            on_demand_video_cache=args.on_demand_video_cache,
            video_cache_max_bytes=int(args.video_cache_max_gb * 1024**3),
        ),
        paths=paths,
        feature_cache_dir=args.feature_cache,
        visual_candidate_limit=args.visual_candidate_limit,
        visual_device=args.visual_device,
    ).build_components()
    pipeline = components.evidence_pipeline
    artifact_store = components.artifact_store
    retriever = components.retriever
    multimodal_localizer = components.localizer
    catalog = components.catalog

    if args.frozen_retrieval is not None:
        retriever = FrozenVideoRetriever.load(args.frozen_retrieval)
        pipeline.video_retriever = retriever

    from development.evaluation.medvidqa_dataset import load_official_split

    samples = load_official_split(
        args.dataset_dir / ("val.json" if args.split == "validation" else "test.json")
    )
    if args.sample_id is not None:
        samples = tuple(sample for sample in samples if sample.sample_id == args.sample_id)
        if not samples:
            raise ValueError(f"No {args.split} sample has ID {args.sample_id}")
    if args.limit is not None:
        if args.limit < 1:
            raise ValueError("limit must be positive")
        samples = samples[: args.limit]
    records = evaluate_pipeline(samples, pipeline, artifact_store=artifact_store)
    output_dir = args.output_dir / args.split
    _write_jsonl(output_dir / "predictions.jsonl", records)
    summary = {
        "split": args.split,
        "feature_cache": str(args.feature_cache) if args.feature_cache else None,
        "visual_candidate_limit": args.visual_candidate_limit,
        "visual_device": args.visual_device,
        "localizer_strategy": args.localizer,
        "transcript_weight": args.transcript_weight,
        "dataset_sha256": _sha256(
            args.dataset_dir / ("val.json" if args.split == "validation" else "test.json")
        ),
        "catalog_sha256": _sha256(args.catalog),
        "top_k": args.top_k,
        "retrieval_weight": args.retrieval_weight,
        "localization_weight": 1.0 - args.retrieval_weight,
        "retrieval_model": retriever.model_name,
        "localization_model": multimodal_localizer.model_name,
        "catalog_videos": len(catalog),
        "frozen_retrieval": (
            {
                "path": str(args.frozen_retrieval),
                "sha256": _sha256(args.frozen_retrieval),
            }
            if args.frozen_retrieval is not None
            else None
        ),
        **end_to_end_report(records),
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("End-to-end summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
