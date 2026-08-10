"""Interface for loading timestamped transcripts without network access."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from backend.domain import TranscriptCue


class TranscriptUnavailableError(LookupError):
    """Raised when no usable cached transcript exists for a video."""


class TranscriptRepository(Protocol):
    def load(self, video_id: str) -> tuple[TranscriptCue, ...]: ...
