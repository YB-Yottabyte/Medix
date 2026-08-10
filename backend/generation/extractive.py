"""Deterministic, fully extractive baseline for grounded generation."""

from __future__ import annotations

import re

from backend.generation.base import (
    AnswerClaimDraft,
    EvidenceGenerationRequest,
    StructuredAnswerDraft,
)

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "do",
        "for",
        "how",
        "i",
        "in",
        "is",
        "it",
        "of",
        "on",
        "the",
        "to",
        "use",
        "what",
        "with",
    }
)


class ExtractiveEvidenceAnswerModel:
    """Return the most question-relevant transcript cues verbatim."""

    model_name = "extractive-token-overlap-v1"

    def __init__(self, *, max_claims: int = 3):
        if max_claims < 1:
            raise ValueError("max_claims must be positive")
        self.max_claims = max_claims

    def generate(self, request: EvidenceGenerationRequest) -> StructuredAnswerDraft:
        question_tokens = self._tokens(request.question)
        ranked = sorted(
            (
                (self._overlap(question_tokens, self._tokens(cue.text)), index, cue)
                for index, cue in enumerate(request.cues)
            ),
            key=lambda item: (-item[0], item[1]),
        )
        relevant = [item for item in ranked if item[0] > 0][: self.max_claims]
        if not relevant:
            return StructuredAnswerDraft(
                claims=(),
                insufficient_evidence_reason=(
                    "No transcript cue shared meaningful terms with the question."
                ),
            )
        relevant.sort(key=lambda item: item[1])
        return StructuredAnswerDraft(
            claims=tuple(
                AnswerClaimDraft(text=cue.text.strip(), citation_ids=(cue.cue_id,))
                for _score, _index, cue in relevant
            )
        )

    @staticmethod
    def _tokens(text: str) -> frozenset[str]:
        return frozenset(
            token
            for token in _TOKEN_PATTERN.findall(text.lower())
            if token not in _STOPWORDS and len(token) > 1
        )

    @staticmethod
    def _overlap(left: frozenset[str], right: frozenset[str]) -> float:
        return len(left & right) / len(left) if left else 0.0
