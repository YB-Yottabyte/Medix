"""Calibration and selective-prediction metrics for confidence experiments."""

from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score


def expected_calibration_error(
    labels: np.ndarray,
    probabilities: np.ndarray,
    bins: int = 10,
) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    error = 0.0
    for index in range(bins):
        lower, upper = edges[index], edges[index + 1]
        mask = (probabilities >= lower) & (
            probabilities <= upper if index == bins - 1 else probabilities < upper
        )
        if np.any(mask):
            error += float(np.mean(mask)) * abs(
                float(np.mean(labels[mask])) - float(np.mean(probabilities[mask]))
            )
    return error


def area_under_risk_coverage(labels: np.ndarray, probabilities: np.ndarray) -> float:
    if not len(labels):
        return 0.0
    order = np.argsort(-probabilities, kind="stable")
    errors = 1.0 - labels[order]
    risk = np.cumsum(errors) / np.arange(1, len(errors) + 1)
    return float(np.mean(risk))


def risk_at_coverage(
    labels: np.ndarray,
    probabilities: np.ndarray,
    coverage: float,
) -> float:
    if not 0 < coverage <= 1:
        raise ValueError("coverage must be in (0, 1]")
    if not len(labels):
        return 0.0
    selected_count = max(1, int(np.ceil(len(labels) * coverage)))
    order = np.argsort(-probabilities, kind="stable")[:selected_count]
    return float(np.mean(1.0 - labels[order]))


def coverage_at_max_risk(
    labels: np.ndarray,
    probabilities: np.ndarray,
    max_risk: float,
) -> float:
    if not 0 <= max_risk <= 1:
        raise ValueError("max_risk must be in [0, 1]")
    if not len(labels):
        return 0.0
    order = np.argsort(-probabilities, kind="stable")
    cumulative_risk = np.cumsum(1.0 - labels[order]) / np.arange(1, len(labels) + 1)
    valid = np.flatnonzero(cumulative_risk <= max_risk)
    return float((valid[-1] + 1) / len(labels)) if len(valid) else 0.0


def choose_threshold(
    labels: np.ndarray,
    probabilities: np.ndarray,
    target_precision: float,
) -> float:
    """Choose the lowest validation threshold satisfying target answer precision."""

    candidates = sorted({float(value) for value in probabilities})
    valid: list[tuple[float, float]] = []
    for threshold in candidates:
        selected = probabilities >= threshold
        if np.any(selected):
            precision = float(np.mean(labels[selected]))
            if precision >= target_precision:
                valid.append((float(np.mean(selected)), threshold))
    if valid:
        return max(valid)[1]
    return 1.0


def summarize_confidence(
    labels: np.ndarray,
    probabilities: np.ndarray,
    threshold: float,
) -> dict[str, float | int | None]:
    selected = probabilities >= threshold
    selected_count = int(np.sum(selected))
    return {
        "samples": int(len(labels)),
        "positive_rate": float(np.mean(labels)) if len(labels) else 0.0,
        "brier_score": float(np.mean((probabilities - labels) ** 2)) if len(labels) else 0.0,
        "expected_calibration_error": expected_calibration_error(labels, probabilities),
        "auroc": _safe_metric(roc_auc_score, labels, probabilities),
        "average_precision": _safe_metric(average_precision_score, labels, probabilities),
        "aurc": area_under_risk_coverage(labels, probabilities),
        "risk_at_10pct_coverage": risk_at_coverage(labels, probabilities, 0.10),
        "risk_at_25pct_coverage": risk_at_coverage(labels, probabilities, 0.25),
        "risk_at_50pct_coverage": risk_at_coverage(labels, probabilities, 0.50),
        "coverage_at_10pct_risk": coverage_at_max_risk(labels, probabilities, 0.10),
        "threshold": threshold,
        "coverage": float(np.mean(selected)) if len(labels) else 0.0,
        "selective_risk": (float(np.mean(1.0 - labels[selected])) if selected_count else None),
        "answered": selected_count,
    }


def _safe_metric(metric: Any, labels: np.ndarray, probabilities: np.ndarray) -> float | None:
    if len(set(labels.tolist())) < 2:
        return None
    return float(metric(labels, probabilities))
