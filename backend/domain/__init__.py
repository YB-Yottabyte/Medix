"""Typed domain objects shared by Medix pipeline stages."""

from backend.domain.answer import EvidenceCitation, GroundedAnswer, GroundedClaim
from backend.domain.evidence import (
    ClipEvidence,
    EvidenceBundle,
    FrameEvidence,
    TranscriptEvidence,
)
from backend.domain.pipeline import (
    CandidateAttempt,
    EndToEndPipelineResult,
    GroundedMedicalPipelineResult,
)
from backend.domain.video import (
    LocalizationRequest,
    TemporalSegment,
    TranscriptCue,
    VideoCandidate,
    VideoDocument,
)

__all__ = [
    "CandidateAttempt",
    "ClipEvidence",
    "EndToEndPipelineResult",
    "EvidenceBundle",
    "EvidenceCitation",
    "FrameEvidence",
    "GroundedAnswer",
    "GroundedClaim",
    "GroundedMedicalPipelineResult",
    "LocalizationRequest",
    "TemporalSegment",
    "TranscriptCue",
    "TranscriptEvidence",
    "VideoCandidate",
    "VideoDocument",
]
