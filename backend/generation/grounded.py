"""Validate structured model output and assemble citation-bearing answers."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from backend.domain.answer import EvidenceCitation, GroundedAnswer, GroundedClaim
from backend.generation.base import (
    EvidenceAnswerModel,
    EvidenceCue,
    EvidenceGenerationRequest,
)

if TYPE_CHECKING:
    from backend.domain.evidence import EvidenceBundle

GENERATION_ABSTENTION_MESSAGE = (
    "The predicted video segment does not contain enough evidence to answer this question."
)
_SUPPORT_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "that",
        "the",
        "then",
        "this",
        "to",
        "with",
        "you",
        "your",
    }
)


class InvalidGroundedAnswerError(ValueError):
    """Raised when model output violates the evidence-grounding contract."""


def build_evidence_generation_request(
    evidence: EvidenceBundle,
) -> EvidenceGenerationRequest:
    """Assign bundle-local cue IDs and expose one shared model input."""
    cues = tuple(
        EvidenceCue(
            cue_id=f"T{index:03d}",
            start_seconds=cue.start_seconds,
            end_seconds=cue.end_seconds,
            text=cue.text,
        )
        for index, cue in enumerate(evidence.transcript, 1)
    )
    return EvidenceGenerationRequest(
        question=evidence.question,
        cues=cues,
        clip_start_seconds=evidence.predicted_start_seconds,
        clip_end_seconds=evidence.predicted_end_seconds,
    )


class EvidenceGroundedAnswerGenerator:
    """Generate an answer and reject claims with missing or invalid citations."""

    def __init__(
        self,
        model: EvidenceAnswerModel,
        *,
        max_claim_characters: int = 500,
        minimum_lexical_support: float = 0.25,
    ):
        if max_claim_characters < 1:
            raise ValueError("max_claim_characters must be positive")
        if not 0 <= minimum_lexical_support <= 1:
            raise ValueError("minimum_lexical_support must be between zero and one")
        self.model = model
        self.max_claim_characters = max_claim_characters
        self.minimum_lexical_support = minimum_lexical_support

    def generate(self, evidence: EvidenceBundle) -> GroundedAnswer:
        request = build_evidence_generation_request(evidence)
        cues = request.cues
        draft = self.model.generate(request)
        if not draft.claims:
            return self.abstain(
                evidence,
                draft.insufficient_evidence_reason
                or "The answer model returned no evidence-supported claims.",
            )

        cue_index = {cue.cue_id: cue for cue in cues}
        claims = []
        used_citation_ids = []
        for draft_claim in draft.claims:
            text = draft_claim.text.strip()
            if not text or len(text) > self.max_claim_characters:
                raise InvalidGroundedAnswerError(
                    "Every generated claim must contain bounded non-empty text."
                )
            citation_ids = tuple(dict.fromkeys(draft_claim.citation_ids))
            if not citation_ids:
                raise InvalidGroundedAnswerError(
                    "Every generated claim must cite transcript evidence."
                )
            unknown = [cue_id for cue_id in citation_ids if cue_id not in cue_index]
            if unknown:
                raise InvalidGroundedAnswerError(
                    f"Generated claim cites unknown transcript cues: {', '.join(unknown)}"
                )
            support = self._lexical_support(
                text,
                " ".join(cue_index[cue_id].text for cue_id in citation_ids),
            )
            if support < self.minimum_lexical_support:
                raise InvalidGroundedAnswerError(
                    f"Generated claim lacks lexical support in its cited cues ({support:.3f})."
                )
            claims.append(GroundedClaim(text=text, citation_ids=citation_ids))
            used_citation_ids.extend(citation_ids)

        ordered_ids = tuple(dict.fromkeys(used_citation_ids))
        response = self._render(tuple(claims), ordered_ids)
        citations = tuple(
            EvidenceCitation(
                cue_id=cue_id,
                start_seconds=cue_index[cue_id].start_seconds,
                end_seconds=cue_index[cue_id].end_seconds,
                text=cue_index[cue_id].text,
            )
            for cue_id in ordered_ids
        )
        return GroundedAnswer(
            question=evidence.question,
            status="answered",
            response=response,
            claims=tuple(claims),
            citations=citations,
            evidence_bundle_id=evidence.bundle_id,
            video_id=evidence.video_id,
            source_uri=evidence.source_uri,
            clip_start_seconds=evidence.predicted_start_seconds,
            clip_end_seconds=evidence.predicted_end_seconds,
            clip_artifact_path=evidence.clip.artifact_path,
            generation_model=self.model.model_name,
            abstention_reason=None,
        )

    def abstain(self, evidence: EvidenceBundle, reason: str) -> GroundedAnswer:
        """Return a provenance-preserving abstention for rejected generation."""
        return GroundedAnswer(
            question=evidence.question,
            status="abstained",
            response=GENERATION_ABSTENTION_MESSAGE,
            claims=(),
            citations=(),
            evidence_bundle_id=evidence.bundle_id,
            video_id=evidence.video_id,
            source_uri=evidence.source_uri,
            clip_start_seconds=evidence.predicted_start_seconds,
            clip_end_seconds=evidence.predicted_end_seconds,
            clip_artifact_path=evidence.clip.artifact_path,
            generation_model=self.model.model_name,
            abstention_reason=reason,
        )

    @staticmethod
    def _render(
        claims: tuple[GroundedClaim, ...],
        ordered_citation_ids: tuple[str, ...],
    ) -> str:
        """Render public citation numbers while retaining cue IDs internally."""
        citation_numbers = {
            cue_id: index for index, cue_id in enumerate(ordered_citation_ids, 1)
        }
        return "\n".join(
            f"{index}. {claim.text} "
            f"[{', '.join(str(citation_numbers[cue_id]) for cue_id in claim.citation_ids)}]"
            for index, claim in enumerate(claims, 1)
        )

    @staticmethod
    def _lexical_support(claim: str, evidence: str) -> float:
        claim_tokens = {
            token
            for token in re.findall(r"[a-z0-9]+", claim.lower())
            if token not in _SUPPORT_STOPWORDS
        }
        evidence_tokens = {
            token
            for token in re.findall(r"[a-z0-9]+", evidence.lower())
            if token not in _SUPPORT_STOPWORDS
        }
        return len(claim_tokens & evidence_tokens) / len(claim_tokens) if claim_tokens else 0.0
