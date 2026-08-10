"""Evaluate a trained CCAL checkpoint on the supported MedVidQA collection."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from backend.temporal_localization import (
    CCALSpanLocalizer,
    TransformersCCALSpanPredictor,
)
from backend.transcripts import CachedTranscriptRepository
from evaluation.medvidqa_dataset import MedVidQASample, OfficialMedVidQADataset
from evaluation.metrics import summarize_localization_predictions
from evaluation.run_temporal_baselines import evaluate_localizer

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _supported_sample_ids(
    manifest: Path,
    split: str,
) -> set[str]:
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    samples = payload.get("samples") if isinstance(payload, dict) else None
    if not isinstance(samples, list):
        raise TypeError("supported collection manifest must contain samples")
    return {
        str(sample["sample_id"])
        for sample in samples
        if isinstance(sample, dict) and sample.get("split") == split
    }


def _select(
    samples: tuple[MedVidQASample, ...],
    sample_ids: set[str],
) -> tuple[MedVidQASample, ...]:
    return tuple(sample for sample in samples if sample.sample_id in sample_ids)


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record) + "\n" for record in records),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=(
            PROJECT_ROOT / "evaluation" / "results" / "supported_collection" / "manifest.json"
        ),
    )
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=PROJECT_ROOT / "data" / "models" / "ccal",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "ccal_localization",
    )
    parser.add_argument("--cycle-weight", type=float, default=0.25)
    args = parser.parse_args()

    dataset = OfficialMedVidQADataset.load(args.dataset_dir)
    predictor = TransformersCCALSpanPredictor.from_checkpoint(
        args.checkpoint,
        cycle_weight=args.cycle_weight,
    )
    localizer = CCALSpanLocalizer(
        repository=CachedTranscriptRepository(args.transcript_cache),
        predictor=predictor,
    )
    validation_samples = _select(
        dataset.validation,
        _supported_sample_ids(args.manifest, "validation"),
    )
    test_samples = _select(
        dataset.test,
        _supported_sample_ids(args.manifest, "test"),
    )
    validation = evaluate_localizer(validation_samples, localizer)
    test = evaluate_localizer(test_samples, localizer)
    _write_jsonl(args.output_dir / "validation.jsonl", validation)
    _write_jsonl(args.output_dir / "test.jsonl", test)
    summary = {
        "model": localizer.model_name,
        "protocol": "known-video-supported-collection",
        "cycle_weight": args.cycle_weight,
        "validation": summarize_localization_predictions(validation),
        "test": summarize_localization_predictions(test),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("CCAL localization summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
