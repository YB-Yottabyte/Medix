"""Provider-independent contracts for structured evidence generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class EvidenceCue:
    cue_id: str
    start_seconds: float
    end_seconds: float
    text: str


@dataclass(frozen=True)
class EvidenceGenerationRequest:
    question: str
    cues: tuple[EvidenceCue, ...]
    clip_start_seconds: float
    clip_end_seconds: float


@dataclass(frozen=True)
class AnswerClaimDraft:
    text: str
    citation_ids: tuple[str, ...]


@dataclass(frozen=True)
class StructuredAnswerDraft:
    claims: tuple[AnswerClaimDraft, ...]
    insufficient_evidence_reason: str | None = None


class EvidenceAnswerModel(Protocol):
    """A model that returns claims rather than unrestricted final prose."""

    @property
    def model_name(self) -> str: ...

    def generate(self, request: EvidenceGenerationRequest) -> StructuredAnswerDraft: ...


class FreeformEvidenceAnswerModel(Protocol):
    """A deliberately unconstrained comparison model for the ablation."""

    @property
    def model_name(self) -> str: ...

    def generate(self, request: EvidenceGenerationRequest) -> str: ...
