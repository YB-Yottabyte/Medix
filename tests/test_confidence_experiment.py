"""Tests for the KAN-versus-MLP confidence experiment."""

from __future__ import annotations

import numpy as np
import pytest
import torch

from evaluation.calibration_metrics import (
    area_under_risk_coverage,
    choose_threshold,
    coverage_at_max_risk,
    expected_calibration_error,
    risk_at_coverage,
)
from evaluation.confidence_features import (
    ConfidenceExample,
    RetrievalFeatureExtractor,
    assert_disjoint_groups,
)
from evaluation.confidence_models import make_models, trainable_parameters
from evaluation.run_confidence_experiment import _aggregate_runs, run_experiment


def test_feature_extractor_labels_correct_top_video() -> None:
    example = RetrievalFeatureExtractor().transform(
        {
            "sample_id": "q-1",
            "question": "How do I dress a wound?",
            "expected_video_id": "correct",
            "retrieved": [
                {
                    "video_id": "correct",
                    "question": "How to dress a wound",
                    "similarity_score": 0.8,
                    "semantic_score": 0.75,
                },
                {
                    "video_id": "other",
                    "question": "How to use a sling",
                    "similarity_score": 0.5,
                },
            ],
        }
    )

    assert example.label == 1
    assert example.group_id == "correct"
    assert example.features[0] == pytest.approx(0.8)
    assert example.features[1] == pytest.approx(0.3)
    assert len(example.features) == len(RetrievalFeatureExtractor.feature_names)


def test_feature_extractor_handles_no_retrieval_result() -> None:
    example = RetrievalFeatureExtractor().transform(
        {
            "sample_id": "q-2",
            "question": "Unknown procedure",
            "expected_video_id": "missing",
            "retrieved": [],
        }
    )

    assert example.label == 0
    assert example.features == (0.0,) * len(RetrievalFeatureExtractor.feature_names)


def test_evidence_profile_distinguishes_conflict_from_missing_signals() -> None:
    extractor = RetrievalFeatureExtractor(profile="evidence_agreement")
    example = extractor.transform(
        {
            "sample_id": "q-3",
            "question": "How do I dress a wound?",
            "expected_video_id": "correct",
            "retrieved": [
                {
                    "video_id": "correct",
                    "question": "How to dress a wound",
                    "similarity_score": 0.8,
                    "semantic_score": 0.8,
                    "lexical_score": 0.7,
                }
            ],
            "evidence_signals": {
                "cross_encoder_score": 0.9,
                "visual_procedure_score": 0.1,
            },
        }
    )
    values = dict(zip(extractor.selected_feature_names, example.features, strict=True))

    assert values["cross_encoder_available"] == 1.0
    assert values["visual_available"] == 1.0
    assert values["transcript_available"] == 0.0
    assert values["evidence_conflict"] == pytest.approx(0.8)
    assert values["text_visual_agreement"] == pytest.approx(0.35)


def test_video_groups_must_not_leak_across_splits() -> None:
    example = ConfidenceExample("1", "same-video", (0.0,), 0)

    with pytest.raises(ValueError, match="Video leakage"):
        assert_disjoint_groups({"train": [example], "validation": [example], "test": []})


def test_mlp_and_kan_are_approximately_parameter_matched() -> None:
    models = make_models(input_size=8)
    mlp_parameters = trainable_parameters(models["mlp"])
    kan_parameters = trainable_parameters(models["kan"])

    assert abs(mlp_parameters - kan_parameters) / kan_parameters < 0.05
    assert trainable_parameters(models["logistic"]) < mlp_parameters


def test_all_confidence_models_train_through_a_forward_pass() -> None:
    features = torch.randn(6, 8)
    labels = torch.tensor([0.0, 1.0, 0.0, 1.0, 1.0, 0.0])

    for model in make_models(input_size=8).values():
        loss = torch.nn.functional.binary_cross_entropy_with_logits(model(features), labels)
        loss.backward()
        assert torch.isfinite(loss)


def test_kan_basis_forms_partition_of_unity_inside_grid() -> None:
    layer = make_models(input_size=8)["kan"].hidden
    inputs = torch.tensor([[-2.0] * 8, [0.0] * 8, [2.0] * 8])

    basis_sums = layer._b_spline_basis(inputs).sum(dim=-1)

    assert torch.allclose(basis_sums, torch.ones_like(basis_sums), atol=1e-5)


def test_calibration_and_selective_metrics_have_expected_direction() -> None:
    labels = np.asarray([1.0, 1.0, 0.0, 0.0])
    good = np.asarray([0.9, 0.8, 0.2, 0.1])
    poor = np.asarray([0.1, 0.2, 0.8, 0.9])

    assert expected_calibration_error(labels, good) < expected_calibration_error(labels, poor)
    assert area_under_risk_coverage(labels, good) < area_under_risk_coverage(labels, poor)
    assert risk_at_coverage(labels, good, 0.5) == 0.0
    assert coverage_at_max_risk(labels, good, 0.0) == 0.5
    assert choose_threshold(labels, good, target_precision=1.0) == pytest.approx(0.8)


def test_experiment_runs_all_models_without_cross_split_leakage() -> None:
    def split_examples(prefix: str, count: int) -> list[ConfidenceExample]:
        return [
            ConfidenceExample(
                sample_id=f"{prefix}-{index}",
                group_id=f"{prefix}-video-{index}",
                features=tuple([float(index % 2), float((index + 1) % 2)] + [index / count] * 6),
                label=index % 2,
            )
            for index in range(count)
        ]

    result = run_experiment(
        {
            "train": split_examples("train", 16),
            "validation": split_examples("validation", 8),
            "test": split_examples("test", 8),
        },
        seeds=[7],
        target_precision=0.5,
        epochs=3,
        patience=2,
        learning_rate=0.01,
        bootstrap_samples=20,
    )

    assert {run["model"] for run in result["runs"]} == {
        "top_score",
        "logistic",
        "mlp",
        "kan",
    }
    assert set(result["aggregate_test"]) == {"top_score", "logistic", "mlp", "kan"}
    assert result["production_fixed_threshold_test"]["threshold"] == 0.35
    assert set(result["kan_vs_mlp_paired_bootstrap"]["metrics"]) == {
        "brier_score",
        "auroc",
        "average_precision",
        "aurc",
    }


def test_aggregate_skips_undefined_selective_risk() -> None:
    aggregate = _aggregate_runs(
        [
            {"model": "kan", "test": {"brier_score": 0.2, "selective_risk": None}},
            {"model": "kan", "test": {"brier_score": 0.4, "selective_risk": 0.1}},
        ]
    )

    assert aggregate["kan"]["brier_score"]["mean"] == pytest.approx(0.3)
    assert aggregate["kan"]["selective_risk"]["mean"] == pytest.approx(0.1)
    assert aggregate["kan"]["selective_risk"]["defined_runs"] == 1
