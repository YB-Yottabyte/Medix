"""Typed outcomes for the end-to-end Medix research pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from backend.domain.answer import GroundedAnswer
    from backend.domain.evidence import EvidenceBundle
    from backend.services.pipeline import SafetyAssessment

PipelineStatus = Literal["answered", "abstained"]


@dataclass(frozen=True)
class CandidateAttempt:
    video_id: str
    title: str
    retrieval_rank: int
    retrieval_score: float
    retrieval_confidence: float
    localization_score: float | None
    joint_score: float | None
    predicted_start_seconds: float | None
    predicted_end_seconds: float | None
    evidence_bundle_id: str | None
    failure_reason: str | None


@dataclass(frozen=True)
class EndToEndPipelineResult:
    question: str
    status: PipelineStatus
    selected_video_id: str | None
    predicted_start_seconds: float | None
    predicted_end_seconds: float | None
    joint_score: float | None
    evidence: EvidenceBundle | None
    attempts: tuple[CandidateAttempt, ...]
    abstention_reason: str | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class GroundedMedicalPipelineResult:
    """Complete research result from retrieval through grounded generation."""

    evidence_result: EndToEndPipelineResult
    answer: GroundedAnswer
    safety_assessment: SafetyAssessment

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
