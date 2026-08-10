"""Compare retrieval-only and Evidence-Agreement KAN/MLP feature profiles."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from evaluation.confidence_features import RetrievalFeatureExtractor
from evaluation.run_confidence_experiment import load_examples, run_experiment

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def run_ablation(
    paths: dict[str, Path],
    *,
    seeds: list[int],
    target_precision: float,
    epochs: int,
    patience: int,
    learning_rate: float,
    bootstrap_samples: int,
) -> dict[str, Any]:
    profiles: dict[str, Any] = {}
    for profile_name in ("retrieval", "evidence_agreement"):
        extractor = RetrievalFeatureExtractor(profile=profile_name)
        splits = {split_name: load_examples(path, extractor) for split_name, path in paths.items()}
        profiles[profile_name] = run_experiment(
            splits,
            seeds=seeds,
            target_precision=target_precision,
            epochs=epochs,
            patience=patience,
            learning_rate=learning_rate,
            bootstrap_samples=bootstrap_samples,
            feature_names=extractor.selected_feature_names,
            experiment_name=f"{profile_name}-confidence-kan-vs-mlp",
        )
    return {
        "experiment": "medix-evidence-agreement-feature-ablation",
        "profiles": profiles,
        "interpretation_boundary": (
            "The full Evidence-Agreement claim requires populated reranker, transcript, "
            "and visual signals. Missing signals are explicitly masked."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--test", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "evidence_ablation.json",
    )
    parser.add_argument("--seeds", default="7,17,29,41,53")
    parser.add_argument("--target-precision", type=float, default=0.90)
    parser.add_argument("--epochs", type=int, default=500)
    parser.add_argument("--patience", type=int, default=50)
    parser.add_argument("--learning-rate", type=float, default=0.01)
    parser.add_argument("--bootstrap-samples", type=int, default=2000)
    args = parser.parse_args()

    result = run_ablation(
        {
            "train": args.train,
            "validation": args.validation,
            "test": args.test,
        },
        seeds=[int(seed) for seed in args.seeds.split(",")],
        target_precision=args.target_precision,
        epochs=args.epochs,
        patience=args.patience,
        learning_rate=args.learning_rate,
        bootstrap_samples=args.bootstrap_samples,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Wrote Evidence-Agreement ablation to %s", args.output)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
