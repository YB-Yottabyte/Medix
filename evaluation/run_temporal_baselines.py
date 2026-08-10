"""Run paper-compatible temporal-localization baselines on MedVidQA."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from backend.domain import LocalizationRequest
from evaluation.medvidqa_dataset import MedVidQASample, OfficialMedVidQADataset
from evaluation.metrics import summarize_localization_predictions
from evaluation.temporal_baselines import (
    RandomGuessLocalizer,
    RandomModeLocalizer,
    validation_mode_duration,
)

if TYPE_CHECKING:
    from backend.temporal_localization import TemporalLocalizer

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def evaluate_localizer(
    samples: tuple[MedVidQASample, ...],
    localizer: TemporalLocalizer,
) -> list[dict[str, object]]:
    predictions = []
    for sample in samples:
        segment = localizer.localize(
            LocalizationRequest(
                question=sample.question,
                video_id=sample.video_id,
                duration_seconds=sample.video_duration_seconds,
            )
        )
        predictions.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "predicted_video_id": segment.video_id,
                "predicted_start": segment.start_seconds,
                "predicted_end": segment.end_seconds,
                "localization_score": segment.localization_score,
                "model_name": segment.model_name,
            }
        )
    return predictions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=PROJECT_ROOT / "MedVidQA",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "temporal_baselines",
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    dataset = OfficialMedVidQADataset.load(args.dataset_dir)
    mode_duration = validation_mode_duration(dataset.validation)
    localizers = (
        RandomModeLocalizer(mode_duration, seed=args.seed),
        RandomGuessLocalizer(seed=args.seed),
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for localizer in localizers:
        predictions = evaluate_localizer(dataset.test, localizer)
        output_path = args.output_dir / f"{localizer.model_name}.jsonl"
        with output_path.open("w", encoding="utf-8") as output:
            for prediction in predictions:
                output.write(json.dumps(prediction) + "\n")
        LOGGER.info(
            "%s\n%s",
            localizer.model_name,
            json.dumps(summarize_localization_predictions(predictions), indent=2),
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
