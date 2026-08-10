"""Interface for selecting untrimmed videos before temporal localization."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from backend.domain import VideoCandidate


class VideoRetriever(Protocol):
    """Rank videos for a medical-procedure question."""

    model_name: str

    def retrieve(self, question: str, *, limit: int = 5) -> tuple[VideoCandidate, ...]: ...
