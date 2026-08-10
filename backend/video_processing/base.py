"""Contracts for timestamped frame extraction from local videos."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pathlib import Path


class VideoUnavailableError(LookupError):
    """Raised when a video or requested frame cannot be read locally."""


@dataclass(frozen=True)
class FrameSample:
    video_id: str
    timestamp_seconds: float
    jpeg_bytes: bytes

    def __post_init__(self) -> None:
        if not self.video_id.strip():
            raise ValueError("video_id must not be empty")
        if self.timestamp_seconds < 0:
            raise ValueError("frame timestamp must not be negative")
        if not self.jpeg_bytes:
            raise ValueError("frame bytes must not be empty")


class FrameExtractor(Protocol):
    def extract(
        self,
        video_id: str,
        timestamps_seconds: tuple[float, ...],
    ) -> tuple[FrameSample, ...]: ...


@dataclass(frozen=True)
class ClipArtifact:
    path: Path
    duration_seconds: float

    def __post_init__(self) -> None:
        if not self.path.is_file():
            raise ValueError("clip artifact path must be a file")
        if self.duration_seconds <= 0:
            raise ValueError("clip duration must be positive")


class ClipExtractor(Protocol):
    def extract(
        self,
        video_id: str,
        start_seconds: float,
        end_seconds: float,
        output_path: Path,
    ) -> ClipArtifact: ...
