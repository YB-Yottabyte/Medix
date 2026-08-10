"""Typed outputs for evidence-constrained medical question answering."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

AnswerStatus = Literal["answered", "abstained"]


@dataclass(frozen=True)
class EvidenceCitation:
    """A transcript cue that supports one or more answer claims."""

    cue_id: str
    start_seconds: float
    end_seconds: float
    text: str

    def __post_init__(self) -> None:
        if not self.cue_id.strip():
            raise ValueError("citation cue_id must not be empty")
        if self.start_seconds < 0 or self.end_seconds <= self.start_seconds:
            raise ValueError("citation requires a valid interval")
        if not self.text.strip():
            raise ValueError("citation text must not be empty")


@dataclass(frozen=True)
class GroundedClaim:
    """An answer statement and the transcript cues asserted to support it."""

    text: str
    citation_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("claim text must not be empty")
        if not self.citation_ids or any(not cue_id.strip() for cue_id in self.citation_ids):
            raise ValueError("every claim requires at least one citation")
        if len(set(self.citation_ids)) != len(self.citation_ids):
            raise ValueError("claim citation IDs must be unique")


@dataclass(frozen=True)
class GroundedAnswer:
    """A response whose answerable claims are traceable to one evidence bundle."""

    question: str
    status: AnswerStatus
    response: str
    claims: tuple[GroundedClaim, ...]
    citations: tuple[EvidenceCitation, ...]
    evidence_bundle_id: str | None
    video_id: str | None
    source_uri: str | None
    clip_start_seconds: float | None
    clip_end_seconds: float | None
    clip_artifact_path: str | None
    generation_model: str
    abstention_reason: str | None

    def __post_init__(self) -> None:
        if not self.question.strip() or not self.generation_model.strip():
            raise ValueError("question and generation_model must not be empty")
        if self.status == "answered":
            self._validate_answered()
        else:
            self._validate_abstained()

    def _validate_answered(self) -> None:
        if not self.response.strip() or not self.claims or not self.citations:
            raise ValueError("answered responses require text, claims, and citations")
        if not all(
            (
                self.evidence_bundle_id,
                self.video_id,
                self.source_uri,
                self.clip_artifact_path,
            )
        ):
            raise ValueError("answered responses require complete evidence provenance")
        if (
            self.clip_start_seconds is None
            or self.clip_end_seconds is None
            or self.clip_start_seconds < 0
            or self.clip_end_seconds <= self.clip_start_seconds
        ):
            raise ValueError("answered responses require a valid clip interval")
        citation_ids = {citation.cue_id for citation in self.citations}
        if len(citation_ids) != len(self.citations):
            raise ValueError("answer citation IDs must be unique")
        if any(
            cue_id not in citation_ids for claim in self.claims for cue_id in claim.citation_ids
        ):
            raise ValueError("claim references a citation absent from the answer")
        if any(
            citation.end_seconds <= self.clip_start_seconds
            or citation.start_seconds >= self.clip_end_seconds
            for citation in self.citations
        ):
            raise ValueError("answer citation falls outside the predicted clip")
        if self.abstention_reason is not None:
            raise ValueError("answered responses cannot contain an abstention reason")

    def _validate_abstained(self) -> None:
        if not self.response.strip() or not self.abstention_reason:
            raise ValueError("abstained responses require a message and reason")
        if self.claims or self.citations:
            raise ValueError("abstained responses cannot contain medical claims")

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
