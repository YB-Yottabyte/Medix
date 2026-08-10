"""Deterministic retrieval and temporal-localization metrics."""

from __future__ import annotations

from typing import Any


def reciprocal_rank(expected_video_id: str, retrieved: list[dict[str, Any]]) -> float:
    for rank, item in enumerate(retrieved, 1):
        if item.get("video_id") == expected_video_id:
            return 1.0 / rank
    return 0.0


def recall_at_k(
    expected_video_id: str,
    retrieved: list[dict[str, Any]],
    k: int,
) -> float:
    return float(any(item.get("video_id") == expected_video_id for item in retrieved[:k]))


def interval_iou(
    expected_start: float,
    expected_end: float,
    predicted_start: float | None,
    predicted_end: float | None,
) -> float:
    if predicted_start is None or predicted_end is None:
        return 0.0
    intersection = max(
        0.0,
        min(expected_end, predicted_end) - max(expected_start, predicted_start),
    )
    union = max(expected_end, predicted_end) - min(expected_start, predicted_start)
    return intersection / union if union > 0 else 0.0


def summarize_predictions(records: list[dict[str, Any]]) -> dict[str, float | int]:
    if not records:
        return {
            "samples": 0,
            "recall_at_1": 0.0,
            "recall_at_5": 0.0,
            "mean_reciprocal_rank": 0.0,
            "mean_temporal_iou": 0.0,
        }

    reciprocal_ranks = []
    recall_1 = []
    recall_5 = []
    temporal_ious = []
    for record in records:
        retrieved = record.get("retrieved", [])
        expected_video_id = str(record["expected_video_id"])
        reciprocal_ranks.append(reciprocal_rank(expected_video_id, retrieved))
        recall_1.append(recall_at_k(expected_video_id, retrieved, 1))
        recall_5.append(recall_at_k(expected_video_id, retrieved, 5))

        top = retrieved[0] if retrieved else {}
        temporal_ious.append(
            interval_iou(
                float(record["expected_start"]),
                float(record["expected_end"]),
                _optional_float(top.get("answer_start")),
                _optional_float(top.get("answer_end")),
            )
            if str(top.get("video_id", "")) == expected_video_id
            else 0.0
        )

    count = len(records)
    return {
        "samples": count,
        "recall_at_1": sum(recall_1) / count,
        "recall_at_5": sum(recall_5) / count,
        "mean_reciprocal_rank": sum(reciprocal_ranks) / count,
        "mean_temporal_iou": sum(temporal_ious) / count,
    }


def summarize_video_retrieval(
    records: list[dict[str, Any]],
) -> dict[str, float | int]:
    """Summarize video identity retrieval without implying localization."""
    if not records:
        return {
            "samples": 0,
            "recall_at_1": 0.0,
            "recall_at_5": 0.0,
            "mean_reciprocal_rank": 0.0,
        }

    reciprocal_ranks = []
    recall_1 = []
    recall_5 = []
    for record in records:
        retrieved = record.get("retrieved", [])
        expected_video_id = str(record["expected_video_id"])
        reciprocal_ranks.append(reciprocal_rank(expected_video_id, retrieved))
        recall_1.append(recall_at_k(expected_video_id, retrieved, 1))
        recall_5.append(recall_at_k(expected_video_id, retrieved, 5))

    count = len(records)
    return {
        "samples": count,
        "recall_at_1": sum(recall_1) / count,
        "recall_at_5": sum(recall_5) / count,
        "mean_reciprocal_rank": sum(reciprocal_ranks) / count,
    }


def summarize_localization_predictions(
    records: list[dict[str, Any]],
) -> dict[str, float | int]:
    """Report the MVAL metrics used by the original MedVidQA paper."""
    if not records:
        return {
            "samples": 0,
            "r_at_1_iou_0.3": 0.0,
            "r_at_1_iou_0.5": 0.0,
            "r_at_1_iou_0.7": 0.0,
            "mean_iou": 0.0,
        }

    ious = []
    for record in records:
        if str(record.get("predicted_video_id", "")) != str(record["expected_video_id"]):
            ious.append(0.0)
            continue
        ious.append(
            interval_iou(
                float(record["expected_start"]),
                float(record["expected_end"]),
                _optional_float(record.get("predicted_start")),
                _optional_float(record.get("predicted_end")),
            )
        )

    count = len(ious)
    return {
        "samples": count,
        "r_at_1_iou_0.3": sum(iou >= 0.3 for iou in ious) / count,
        "r_at_1_iou_0.5": sum(iou >= 0.5 for iou in ious) / count,
        "r_at_1_iou_0.7": sum(iou >= 0.7 for iou in ious) / count,
        "mean_iou": sum(ious) / count,
    }


def _optional_float(value: Any) -> float | None:
    return float(value) if value is not None else None
