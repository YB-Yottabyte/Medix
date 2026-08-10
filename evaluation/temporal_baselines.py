"""Reproducible paper baselines and an evaluation-only annotation oracle."""

from __future__ import annotations

import random
from collections import Counter
from typing import TYPE_CHECKING

from backend.domain import LocalizationRequest, TemporalSegment

if TYPE_CHECKING:
    from collections.abc import Iterable

    from evaluation.medvidqa_dataset import MedVidQASample


class RandomModeLocalizer:
    """Place a validation-mode-length segment at a random valid position."""

    model_name = "random-mode"

    def __init__(self, answer_duration_seconds: float, *, seed: int):
        if answer_duration_seconds <= 0:
            raise ValueError("answer_duration_seconds must be positive")
        self.answer_duration_seconds = answer_duration_seconds
        self._random = random.Random(seed)  # noqa: S311 - deterministic benchmark baseline

    def localize(self, request: LocalizationRequest) -> TemporalSegment:
        duration = min(self.answer_duration_seconds, request.duration_seconds)
        max_start = max(request.duration_seconds - duration, 0.0)
        start = self._random.uniform(0.0, max_start)
        return TemporalSegment(
            video_id=request.video_id,
            start_seconds=start,
            end_seconds=start + duration,
            localization_score=0.0,
            model_name=self.model_name,
        )


class RandomGuessLocalizer:
    """Choose two random positions and use the ordered pair as the segment."""

    model_name = "random-guess"

    def __init__(self, *, seed: int):
        self._random = random.Random(seed)  # noqa: S311 - deterministic benchmark baseline

    def localize(self, request: LocalizationRequest) -> TemporalSegment:
        first = self._random.uniform(0.0, request.duration_seconds)
        second = self._random.uniform(0.0, request.duration_seconds)
        start, end = sorted((first, second))
        if end - start < 0.001:
            end = min(request.duration_seconds, start + 0.001)
            if end <= start:
                start = max(0.0, end - 0.001)
        return TemporalSegment(
            video_id=request.video_id,
            start_seconds=start,
            end_seconds=end,
            localization_score=0.0,
            model_name=self.model_name,
        )


class AnnotatedOracleLocalizer:
    """Evaluation-only plumbing oracle; this is never a learned model."""

    model_name = "annotated-oracle-evaluation-only"

    def __init__(self, samples: Iterable[MedVidQASample]):
        self._segments = {
            (sample.video_id, _normalize_question(sample.question)): sample for sample in samples
        }

    def localize(self, request: LocalizationRequest) -> TemporalSegment:
        key = (request.video_id, _normalize_question(request.question))
        sample = self._segments.get(key)
        if sample is None:
            raise KeyError("No annotation exists for this evaluation request")
        return TemporalSegment(
            video_id=sample.video_id,
            start_seconds=sample.answer_start_seconds,
            end_seconds=sample.answer_end_seconds,
            localization_score=1.0,
            model_name=self.model_name,
        )


def validation_mode_duration(samples: Iterable[MedVidQASample]) -> float:
    """Return the paper's modal validation answer duration."""
    counts = Counter(round(sample.answer_duration_seconds, 6) for sample in samples)
    if not counts:
        raise ValueError("Cannot compute a mode from an empty validation split")
    return float(counts.most_common(1)[0][0])


def _normalize_question(question: str) -> str:
    return " ".join(question.lower().split())
