"""Interface for question-conditioned answer-span prediction."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from backend.domain import LocalizationRequest, TemporalSegment


class TemporalLocalizer(Protocol):
    """Predict an answer segment from a question and an untrimmed video."""

    model_name: str

    def localize(self, request: LocalizationRequest) -> TemporalSegment: ...
