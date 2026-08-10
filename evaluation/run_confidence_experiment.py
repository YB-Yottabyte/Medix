"""Train and compare logistic, MLP, and KAN retrieval-confidence models."""

from __future__ import annotations

import argparse
import copy
import json
import logging
import random
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

from evaluation.calibration_metrics import (
    area_under_risk_coverage,
    choose_threshold,
    summarize_confidence,
)
from evaluation.confidence_features import (
    ConfidenceExample,
    RetrievalFeatureExtractor,
    assert_disjoint_groups,
)
from evaluation.confidence_models import make_models, trainable_parameters

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Standardizer:
    mean: tuple[float, ...]
    scale: tuple[float, ...]

    @classmethod
    def fit(cls, features: np.ndarray) -> Standardizer:
        mean = features.mean(axis=0)
        scale = features.std(axis=0)
        scale[scale < 1e-8] = 1.0
        return cls(tuple(mean.tolist()), tuple(scale.tolist()))

    def transform(self, features: np.ndarray) -> np.ndarray:
        standardized = (features - np.asarray(self.mean)) / np.asarray(self.scale)
        return np.clip(standardized, -5.0, 5.0).astype(np.float32)


def load_examples(path: Path, extractor: RetrievalFeatureExtractor) -> list[ConfidenceExample]:
    records = [
        json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]
    return [extractor.transform(record) for record in records]


def examples_to_arrays(examples: list[ConfidenceExample]) -> tuple[np.ndarray, np.ndarray]:
    if not examples:
        raise ValueError("A confidence experiment split cannot be empty")
    return (
        np.asarray([example.features for example in examples], dtype=np.float32),
        np.asarray([example.label for example in examples], dtype=np.float32),
    )


def fit_model(
    model: nn.Module,
    train_features: np.ndarray,
    train_labels: np.ndarray,
    validation_features: np.ndarray,
    validation_labels: np.ndarray,
    *,
    seed: int,
    epochs: int,
    patience: int,
    learning_rate: float,
) -> nn.Module:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    train_x = torch.from_numpy(train_features)
    train_y = torch.from_numpy(train_labels)
    validation_x = torch.from_numpy(validation_features)
    validation_y = torch.from_numpy(validation_labels)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    loss_function = nn.BCEWithLogitsLoss()

    best_loss = float("inf")
    best_state = copy.deepcopy(model.state_dict())
    stale_epochs = 0
    for _ in range(epochs):
        model.train()
        optimizer.zero_grad()
        loss = loss_function(model(train_x), train_y)
        loss.backward()
        optimizer.step()

        model.eval()
        with torch.no_grad():
            validation_loss = float(loss_function(model(validation_x), validation_y))
        if validation_loss < best_loss - 1e-6:
            best_loss = validation_loss
            best_state = copy.deepcopy(model.state_dict())
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break

    model.load_state_dict(best_state)
    return model.eval()


def predict(model: nn.Module, features: np.ndarray) -> np.ndarray:
    with torch.no_grad():
        return torch.sigmoid(model(torch.from_numpy(features))).numpy()


def run_experiment(
    splits: dict[str, list[ConfidenceExample]],
    *,
    seeds: list[int],
    target_precision: float,
    epochs: int,
    patience: int,
    learning_rate: float,
    bootstrap_samples: int = 2000,
    feature_names: tuple[str, ...] | None = None,
    experiment_name: str = "retrieval-confidence-kan-vs-mlp",
) -> dict[str, Any]:
    assert_disjoint_groups(splits)
    raw_arrays = {name: examples_to_arrays(examples) for name, examples in splits.items()}
    standardizer = Standardizer.fit(raw_arrays["train"][0])
    features = {
        name: standardizer.transform(split_features)
        for name, (split_features, _) in raw_arrays.items()
    }
    labels = {name: split_labels for name, (_, split_labels) in raw_arrays.items()}

    validation_top_scores = np.clip(raw_arrays["validation"][0][:, 0], 0.0, 1.0)
    test_top_scores = np.clip(raw_arrays["test"][0][:, 0], 0.0, 1.0)
    top_score_threshold = choose_threshold(
        labels["validation"],
        validation_top_scores,
        target_precision,
    )
    runs: list[dict[str, Any]] = [
        {
            "model": "top_score",
            "seed": None,
            "parameters": 0,
            "validation": summarize_confidence(
                labels["validation"],
                validation_top_scores,
                top_score_threshold,
            ),
            "test": summarize_confidence(
                labels["test"],
                test_top_scores,
                top_score_threshold,
            ),
            "test_probabilities": test_top_scores.tolist(),
        }
    ]
    for seed in seeds:
        torch.manual_seed(seed)
        models = make_models(features["train"].shape[1])
        for model_name, model in models.items():
            fitted = fit_model(
                model,
                features["train"],
                labels["train"],
                features["validation"],
                labels["validation"],
                seed=seed,
                epochs=epochs,
                patience=patience,
                learning_rate=learning_rate,
            )
            validation_probabilities = predict(fitted, features["validation"])
            threshold = choose_threshold(
                labels["validation"],
                validation_probabilities,
                target_precision,
            )
            test_probabilities = predict(fitted, features["test"])
            runs.append(
                {
                    "model": model_name,
                    "seed": seed,
                    "parameters": trainable_parameters(fitted),
                    "validation": summarize_confidence(
                        labels["validation"],
                        validation_probabilities,
                        threshold,
                    ),
                    "test": summarize_confidence(
                        labels["test"],
                        test_probabilities,
                        threshold,
                    ),
                    "test_probabilities": test_probabilities.tolist(),
                }
            )

    return {
        "experiment": experiment_name,
        "feature_names": list(
            feature_names
            or tuple(f"feature_{index}" for index in range(features["train"].shape[1]))
        ),
        "split_sizes": {name: len(examples) for name, examples in splits.items()},
        "target_validation_precision": target_precision,
        "seeds": seeds,
        "standardizer": asdict(standardizer),
        "production_fixed_threshold_test": summarize_confidence(
            labels["test"],
            test_top_scores,
            0.35,
        ),
        "runs": runs,
        "aggregate_test": _aggregate_runs(runs),
        "kan_vs_mlp_paired_bootstrap": _paired_bootstrap_comparison(
            labels["test"],
            runs,
            samples=bootstrap_samples,
        ),
    }


def _aggregate_runs(runs: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, float]]]:
    aggregate: dict[str, dict[str, dict[str, float]]] = {}
    for model_name in sorted({str(run["model"]) for run in runs}):
        model_runs = [run for run in runs if run["model"] == model_name]
        numeric_metrics = {
            key
            for run in model_runs
            for key, value in run["test"].items()
            if isinstance(value, int | float) and value is not None
        }
        aggregate[model_name] = {}
        for metric in sorted(numeric_metrics):
            values = [
                float(run["test"][metric])
                for run in model_runs
                if isinstance(run["test"].get(metric), int | float)
            ]
            if values:
                aggregate[model_name][metric] = {
                    "mean": float(np.mean(values)),
                    "std": float(np.std(values)),
                    "defined_runs": len(values),
                }
    return aggregate


def _paired_bootstrap_comparison(
    labels: np.ndarray,
    runs: list[dict[str, Any]],
    *,
    samples: int,
    seed: int = 20260724,
) -> dict[str, Any]:
    """Bootstrap test examples after averaging predictions across training seeds."""

    if samples < 1:
        raise ValueError("bootstrap samples must be positive")
    ensembles = {}
    for model_name in ("mlp", "kan"):
        predictions = [
            np.asarray(run["test_probabilities"], dtype=np.float64)
            for run in runs
            if run["model"] == model_name
        ]
        if not predictions:
            raise ValueError(f"Missing {model_name} predictions for paired comparison")
        ensembles[model_name] = np.mean(predictions, axis=0)

    def metric_values(
        sample_labels: np.ndarray,
        probabilities: np.ndarray,
    ) -> dict[str, float]:
        from sklearn.metrics import average_precision_score, roc_auc_score

        return {
            "brier_score": float(np.mean((probabilities - sample_labels) ** 2)),
            "auroc": float(roc_auc_score(sample_labels, probabilities)),
            "average_precision": float(average_precision_score(sample_labels, probabilities)),
            "aurc": area_under_risk_coverage(sample_labels, probabilities),
        }

    point_mlp = metric_values(labels, ensembles["mlp"])
    point_kan = metric_values(labels, ensembles["kan"])
    rng = np.random.default_rng(seed)
    differences = {metric: [] for metric in point_kan}
    for _ in range(samples):
        indices = rng.integers(0, len(labels), len(labels))
        sampled_labels = labels[indices]
        if len(np.unique(sampled_labels)) < 2:
            continue
        sampled_mlp = metric_values(sampled_labels, ensembles["mlp"][indices])
        sampled_kan = metric_values(sampled_labels, ensembles["kan"][indices])
        for metric, metric_differences in differences.items():
            metric_differences.append(sampled_kan[metric] - sampled_mlp[metric])

    lower_is_better = {"brier_score", "aurc"}
    return {
        "method": "paired nonparametric bootstrap over test examples after seed ensembling",
        "samples": samples,
        "difference": "KAN minus MLP",
        "metrics": {
            metric: {
                "mlp": point_mlp[metric],
                "kan": point_kan[metric],
                "difference": point_kan[metric] - point_mlp[metric],
                "confidence_interval_95": [
                    float(np.percentile(values, 2.5)),
                    float(np.percentile(values, 97.5)),
                ],
                "bootstrap_probability_kan_better": float(
                    np.mean(np.asarray(values) < 0)
                    if metric in lower_is_better
                    else np.mean(np.asarray(values) > 0)
                ),
            }
            for metric, values in differences.items()
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--test", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "confidence_comparison.json",
    )
    parser.add_argument("--seeds", default="7,17,29,41,53")
    parser.add_argument("--target-precision", type=float, default=0.90)
    parser.add_argument("--epochs", type=int, default=500)
    parser.add_argument("--patience", type=int, default=50)
    parser.add_argument("--learning-rate", type=float, default=0.01)
    parser.add_argument("--bootstrap-samples", type=int, default=2000)
    parser.add_argument(
        "--feature-profile",
        choices=sorted(RetrievalFeatureExtractor.profiles),
        default="retrieval",
    )
    args = parser.parse_args()
    if not 0 < args.target_precision <= 1:
        parser.error("--target-precision must be in (0, 1]")

    extractor = RetrievalFeatureExtractor(profile=args.feature_profile)
    splits = {
        "train": load_examples(args.train, extractor),
        "validation": load_examples(args.validation, extractor),
        "test": load_examples(args.test, extractor),
    }
    result = run_experiment(
        splits,
        seeds=[int(seed) for seed in args.seeds.split(",")],
        target_precision=args.target_precision,
        epochs=args.epochs,
        patience=args.patience,
        learning_rate=args.learning_rate,
        bootstrap_samples=args.bootstrap_samples,
        feature_names=extractor.selected_feature_names,
        experiment_name=f"{args.feature_profile}-confidence-kan-vs-mlp",
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Wrote confidence comparison to %s", args.output)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
