"""Domain objects for video retrieval and temporal localization."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TranscriptCue:
    """One timestamped transcript cue from an untrimmed video."""

    start_seconds: float
    duration_seconds: float
    text: str

    def __post_init__(self) -> None:
        if self.start_seconds < 0:
            raise ValueError("transcript cue start must not be negative")
        if self.duration_seconds <= 0:
            raise ValueError("transcript cue duration must be positive")
        if not self.text.strip():
            raise ValueError("transcript cue text must not be empty")

    @property
    def end_seconds(self) -> float:
        return self.start_seconds + self.duration_seconds


@dataclass(frozen=True)
class VideoDocument:
    """Searchable metadata for one untrimmed video.

    Expert questions and answer boundaries are deliberately excluded so this
    object can be indexed without leaking MedVidQA evaluation labels.
    """

    video_id: str
    title: str
    duration_seconds: float
    source_uri: str
    author_name: str | None = None
    transcript: str | None = None

    def __post_init__(self) -> None:
        if not self.video_id.strip():
            raise ValueError("video_id must not be empty")
        if not self.title.strip():
            raise ValueError("video title must not be empty")
        if self.duration_seconds <= 0:
            raise ValueError("duration_seconds must be positive")
        if not self.source_uri.strip():
            raise ValueError("source_uri must not be empty")

    @property
    def searchable_text(self) -> str:
        """Return non-label evidence that may be embedded for retrieval."""
        parts = [self.title]
        if self.author_name:
            parts.append(self.author_name)
        if self.transcript:
            parts.append(self.transcript)
        return "\n".join(parts)


@dataclass(frozen=True)
class VideoCandidate:
    """A video returned by retrieval, without answer-boundary annotations."""

    video_id: str
    title: str
    retrieval_score: float
    source_uri: str | None = None

    def __post_init__(self) -> None:
        if not self.video_id.strip():
            raise ValueError("video_id must not be empty")
        if not self.title.strip():
            raise ValueError("video title must not be empty")


@dataclass(frozen=True)
class LocalizationRequest:
    """Question and untrimmed video supplied to a temporal localizer."""

    question: str
    video_id: str
    duration_seconds: float

    def __post_init__(self) -> None:
        if not self.question.strip():
            raise ValueError("question must not be empty")
        if not self.video_id.strip():
            raise ValueError("video_id must not be empty")
        if self.duration_seconds <= 0:
            raise ValueError("duration_seconds must be positive")


@dataclass(frozen=True)
class TemporalSegment:
    """A predicted answer interval within one video."""

    video_id: str
    start_seconds: float
    end_seconds: float
    localization_score: float
    model_name: str

    def __post_init__(self) -> None:
        if not self.video_id.strip():
            raise ValueError("video_id must not be empty")
        if self.start_seconds < 0:
            raise ValueError("start_seconds must not be negative")
        if self.end_seconds <= self.start_seconds:
            raise ValueError("end_seconds must be greater than start_seconds")
        if not 0 <= self.localization_score <= 1:
            raise ValueError("localization_score must be between zero and one")
        if not self.model_name.strip():
            raise ValueError("model_name must not be empty")
