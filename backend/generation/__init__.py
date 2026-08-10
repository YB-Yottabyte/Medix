"""Evidence-constrained response generation."""

from backend.generation.base import (
    AnswerClaimDraft,
    EvidenceAnswerModel,
    EvidenceCue,
    EvidenceGenerationRequest,
    FreeformEvidenceAnswerModel,
    StructuredAnswerDraft,
)
from backend.generation.extractive import ExtractiveEvidenceAnswerModel
from backend.generation.grounded import (
    EvidenceGroundedAnswerGenerator,
    InvalidGroundedAnswerError,
    build_evidence_generation_request,
)

__all__ = [
    "AnswerClaimDraft",
    "EvidenceAnswerModel",
    "EvidenceCue",
    "EvidenceGenerationRequest",
    "EvidenceGroundedAnswerGenerator",
    "ExtractiveEvidenceAnswerModel",
    "FreeformEvidenceAnswerModel",
    "InvalidGroundedAnswerError",
    "StructuredAnswerDraft",
    "build_evidence_generation_request",
]
