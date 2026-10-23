"""Validation-only comparison of transcript localizers and embedding models.

This experiment uses the annotated target video only to isolate temporal
localization quality. It never reads test annotations and never changes the
frozen retrieval snapshot or production model configuration.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any

from sentence_transformers import SentenceTransformer

from backend.temporal_localization import TranscriptWindowLocalizer
from backend.transcripts import CachedTranscriptRepository
from development.evaluation.medvidqa_dataset import OFFICIAL_SPLIT_SIZES, load_official_split
from development.evaluation.run_transcript_localization import (
    evaluate_transcript_localizer,
    localization_report,
)

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]

MINILM_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
MINILM_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
BGE_MODEL = "BAAI/bge-large-en-v1.5"
BGE_REVISION = "b29731d0f3a9fec2d889805efbfb1c84ad9098b2"
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run_comparison(
    *,
    samples: tuple[Any, ...],
    transcript_cache: Path,
    output_dir: Path,
    validation_annotations: Path,
    window_sizes: tuple[float, ...],
    stride_ratio: float,
    model_specs: tuple[dict[str, str], ...],
) -> dict[str, Any]:
    repository = CachedTranscriptRepository(transcript_cache)
    model_results: list[dict[str, Any]] = []
    output_dir.mkdir(parents=True, exist_ok=True)

    for spec in model_specs:
        model_id = spec["model"]
        revision = spec["revision"]
        LOGGER.info("Loading %s@%s", model_id, revision)
        encoder = SentenceTransformer(model_id, revision=revision)
        candidates = []

        for window_seconds in window_sizes:
            stride_seconds = window_seconds * stride_ratio
            localizer = TranscriptWindowLocalizer(
                repository=repository,
                encoder=encoder,
                window_seconds=window_seconds,
                stride_seconds=stride_seconds,
                embedding_model_name=f"{model_id}@{revision}",
                query_prefix=spec.get("query_prefix", ""),
            )
            started = time.monotonic()
            records = evaluate_transcript_localizer(samples, localizer)
            elapsed_seconds = time.monotonic() - started
            report = localization_report(records)
            prediction_name = f"validation-{spec['slug']}-window-{window_seconds:g}s.jsonl"
            prediction_path = output_dir / prediction_name
            with prediction_path.open("w", encoding="utf-8") as output:
                for record in records:
                    output.write(json.dumps(record) + "\n")

            candidates.append(
                {
                    "window_seconds": window_seconds,
                    "stride_seconds": stride_seconds,
                    "model_name": localizer.model_name,
                    "elapsed_seconds": round(elapsed_seconds, 3),
                    "prediction_path": str(prediction_path),
                    **report,
                }
            )
            LOGGER.info(
                "%s window=%ss mean_iou=%.4f r@0.5=%.4f coverage=%.3f",
                spec["slug"],
                window_seconds,
                report["all_samples"]["mean_iou"],
                report["all_samples"]["r_at_1_iou_0.5"],
                report["transcript_coverage"],
            )

        best = max(
            candidates,
            key=lambda result: (
                result["all_samples"]["mean_iou"],
                result["all_samples"]["r_at_1_iou_0.5"],
                -result["window_seconds"],
            ),
        )
        model_results.append(
            {
                "model": model_id,
                "revision": revision,
                "query_prefix": spec.get("query_prefix", ""),
                "best_validation_configuration": best,
                "candidates": candidates,
            }
        )
        del encoder

    summary = {
        "protocol": "validation-only-oracle-target-video-transcript-localization",
        "dataset_split": "val.json",
        "sample_count": len(samples),
        "target_video_count": len({sample.video_id for sample in samples}),
        "window_sizes_seconds": window_sizes,
        "stride_ratio": stride_ratio,
        "transcript_cache": str(transcript_cache),
        "validation_annotations_sha256": sha256_file(validation_annotations),
        "models": model_results,
    }
    (output_dir / "validation-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--window-sizes",
        nargs="+",
        type=float,
        default=(15, 30, 45, 60, 90),
    )
    parser.add_argument("--stride-ratio", type=float, default=0.5)
    args = parser.parse_args()

    if not 0 < args.stride_ratio <= 1:
        raise ValueError("stride-ratio must be greater than zero and at most one")
    if any(size <= 0 for size in args.window_sizes):
        raise ValueError("all window sizes must be positive")

    validation_path = args.dataset_dir / "val.json"
    samples = load_official_split(validation_path)
    if len(samples) != OFFICIAL_SPLIT_SIZES["val"]:
        raise ValueError(
            f"Expected {OFFICIAL_SPLIT_SIZES['val']} validation samples; found {len(samples)}"
        )

    specs = (
        {
            "slug": "minilm-baseline",
            "model": MINILM_MODEL,
            "revision": MINILM_REVISION,
            "query_prefix": "",
        },
        {
            "slug": "bge-large",
            "model": BGE_MODEL,
            "revision": BGE_REVISION,
            "query_prefix": BGE_QUERY_PREFIX,
        },
    )
    summary = run_comparison(
        samples=samples,
        transcript_cache=args.transcript_cache,
        output_dir=args.output_dir,
        validation_annotations=validation_path,
        window_sizes=tuple(args.window_sizes),
        stride_ratio=args.stride_ratio,
        model_specs=specs,
    )
    LOGGER.info("Validation localization comparison: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
