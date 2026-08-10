"""Evidence, retrieval-gating, and conservative scope policies."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Literal

ABSTENTION_MESSAGE = (
    "I could not find sufficiently relevant evidence in the approved procedure corpus "
    "to answer this safely. Please consult a qualified healthcare professional."
)
RESTRICTED_SCOPE_MESSAGE = (
    "Medix cannot diagnose conditions, prescribe treatment, or select medication dosages. "
    "Please ask a qualified healthcare professional."
)
EMERGENCY_WARNING = (
    "This may be an emergency. Contact your local emergency services now and follow "
    "instructions from a qualified dispatcher or healthcare professional."
)

SafetyDisposition = Literal["supported", "emergency", "restricted"]


@dataclass(frozen=True)
class SafetyAssessment:
    """Result of conservative pre-retrieval scope triage."""

    disposition: SafetyDisposition
    reason: str | None = None
    warning: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return asdict(self)


@dataclass(frozen=True)
class RetrievalAssessment:
    """Decision and provenance produced by the retrieval gate."""

    answerable: bool
    confidence: float
    threshold: float
    reason: str | None
    evidence: tuple[dict[str, Any], ...]


class SafetyTriageService:
    """Conservative, deterministic triage that is testable without an LLM."""

    _emergency_patterns = tuple(
        re.compile(pattern)
        for pattern in (
            r"\bnot breathing\b",
            r"\bstopped breathing\b",
            r"\bwon'?t wake(?: up)?\b",
            r"\bunconscious\b",
            r"\bsevere bleeding\b",
            r"\bbleeding (?:will not|won'?t) stop\b",
            r"\bchest pain\b",
            r"\boverdose\b",
            r"\bchoking\b",
        )
    )
    _restricted_patterns = tuple(
        re.compile(pattern)
        for pattern in (
            r"\bdiagnos(?:e|is|ing)\b",
            r"\bprescrib(?:e|ing|ed)\b",
            r"\bwhat (?:medicine|medication|drug) should i take\b",
            r"\bshould i take\b",
            r"\b(?:what|which|how much) dos(?:e|age)\b",
            r"\bchange my dos(?:e|age)\b",
        )
    )

    def assess(self, query: str) -> SafetyAssessment:
        normalized = " ".join(query.lower().split())
        if any(pattern.search(normalized) for pattern in self._emergency_patterns):
            return SafetyAssessment(
                disposition="emergency",
                reason="Potential emergency language detected.",
                warning=EMERGENCY_WARNING,
            )
        if any(pattern.search(normalized) for pattern in self._restricted_patterns):
            return SafetyAssessment(
                disposition="restricted",
                reason="The question requests diagnosis, prescribing, or dosage selection.",
            )
        return SafetyAssessment(disposition="supported")


class RetrievalGate:
    """Require validation-tunable evidence confidence before generation."""

    def __init__(self, threshold: float):
        self.threshold = threshold

    def assess(self, procedures: list[dict[str, Any]]) -> RetrievalAssessment:
        confidence = float(procedures[0].get("similarity_score", 0.0)) if procedures else 0.0
        answerable = bool(procedures) and confidence >= self.threshold
        reason = None
        if not procedures:
            reason = "No procedure passed the retrieval filter."
        elif not answerable:
            reason = (
                f"Top retrieval confidence {confidence:.3f} was below the "
                f"answer threshold {self.threshold:.3f}."
            )
        return RetrievalAssessment(
            answerable=answerable,
            confidence=confidence,
            threshold=self.threshold,
            reason=reason,
            evidence=tuple(
                self._evidence(procedure, rank) for rank, procedure in enumerate(procedures, 1)
            ),
        )

    @staticmethod
    def _evidence(procedure: dict[str, Any], rank: int) -> dict[str, Any]:
        video_id = procedure.get("video_id")
        return {
            "rank": rank,
            "procedure": procedure.get("question"),
            "sample_id": procedure.get("sample_id"),
            "video_id": video_id,
            "video_url": procedure.get("youtube_url")
            or (f"https://www.youtube.com/watch?v={video_id}" if video_id else None),
            "start_time": procedure.get("answer_start"),
            "end_time": procedure.get("answer_end"),
            "retrieval_score": procedure.get("similarity_score"),
        }
