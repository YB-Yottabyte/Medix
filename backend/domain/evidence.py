"""Immutable provenance records for evidence-grounded answers."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class TranscriptEvidence:
    start_seconds: float
    end_seconds: float
    text: str

    def __post_init__(self) -> None:
        if self.start_seconds < 0 or self.end_seconds <= self.start_seconds:
            raise ValueError("transcript evidence requires a valid interval")
        if not self.text.strip():
            raise ValueError("transcript evidence text must not be empty")


@dataclass(frozen=True)
class FrameEvidence:
    timestamp_seconds: float
    artifact_path: str
    sha256: str

    def __post_init__(self) -> None:
        if self.timestamp_seconds < 0:
            raise ValueError("frame timestamp must not be negative")
        _validate_artifact(self.artifact_path, self.sha256)


@dataclass(frozen=True)
class ClipEvidence:
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    artifact_path: str
    sha256: str

    def __post_init__(self) -> None:
        if self.start_seconds < 0 or self.end_seconds <= self.start_seconds:
            raise ValueError("clip evidence requires a valid source interval")
        if self.duration_seconds <= 0:
            raise ValueError("clip duration must be positive")
        _validate_artifact(self.artifact_path, self.sha256)


@dataclass(frozen=True)
class EvidenceBundle:
    """All evidence a response generator may inspect for one prediction."""

    bundle_id: str
    question: str
    video_id: str
    source_uri: str
    predicted_start_seconds: float
    predicted_end_seconds: float
    localization_model: str
    transcript: tuple[TranscriptEvidence, ...]
    frames: tuple[FrameEvidence, ...]
    clip: ClipEvidence
    scores: dict[str, float | None]
    provenance: dict[str, str | int | float | bool | None]

    def __post_init__(self) -> None:
        if not self.bundle_id.strip():
            raise ValueError("bundle_id must not be empty")
        if not self.question.strip() or not self.video_id.strip():
            raise ValueError("question and video_id must not be empty")
        if not self.source_uri.strip() or not self.localization_model.strip():
            raise ValueError("source_uri and localization_model must not be empty")
        if (
            self.predicted_start_seconds < 0
            or self.predicted_end_seconds <= self.predicted_start_seconds
        ):
            raise ValueError("evidence bundle requires a valid predicted interval")
        if not self.transcript:
            raise ValueError("evidence bundle requires transcript evidence")
        if not self.frames:
            raise ValueError("evidence bundle requires frame evidence")
        for cue in self.transcript:
            if not _overlaps(
                cue.start_seconds,
                cue.end_seconds,
                self.predicted_start_seconds,
                self.predicted_end_seconds,
            ):
                raise ValueError("transcript cue does not overlap predicted interval")
        for frame in self.frames:
            if not (
                self.predicted_start_seconds
                <= frame.timestamp_seconds
                <= self.predicted_end_seconds
            ):
                raise ValueError("frame timestamp falls outside predicted interval")

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> EvidenceBundle:
        """Restore a validated bundle from a persisted manifest."""
        return cls(
            bundle_id=str(payload["bundle_id"]),
            question=str(payload["question"]),
            video_id=str(payload["video_id"]),
            source_uri=str(payload["source_uri"]),
            predicted_start_seconds=float(payload["predicted_start_seconds"]),
            predicted_end_seconds=float(payload["predicted_end_seconds"]),
            localization_model=str(payload["localization_model"]),
            transcript=tuple(
                TranscriptEvidence(
                    start_seconds=float(cue["start_seconds"]),
                    end_seconds=float(cue["end_seconds"]),
                    text=str(cue["text"]),
                )
                for cue in payload["transcript"]
            ),
            frames=tuple(
                FrameEvidence(
                    timestamp_seconds=float(frame["timestamp_seconds"]),
                    artifact_path=str(frame["artifact_path"]),
                    sha256=str(frame["sha256"]),
                )
                for frame in payload["frames"]
            ),
            clip=ClipEvidence(
                start_seconds=float(payload["clip"]["start_seconds"]),
                end_seconds=float(payload["clip"]["end_seconds"]),
                duration_seconds=float(payload["clip"]["duration_seconds"]),
                artifact_path=str(payload["clip"]["artifact_path"]),
                sha256=str(payload["clip"]["sha256"]),
            ),
            scores=dict(payload["scores"]),
            provenance=dict(payload["provenance"]),
        )


def _overlaps(
    left_start: float,
    left_end: float,
    right_start: float,
    right_end: float,
) -> bool:
    return left_end > right_start and left_start < right_end


def _validate_artifact(path: str, digest: str) -> None:
    if not path.strip():
        raise ValueError("artifact path must not be empty")
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError("artifact sha256 must be a lowercase hexadecimal digest")
