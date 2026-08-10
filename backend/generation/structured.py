"""Shared strict contract for provider-backed evidence generation."""

from __future__ import annotations

import json
from typing import Any

from backend.generation.base import (
    AnswerClaimDraft,
    EvidenceGenerationRequest,
    StructuredAnswerDraft,
)

MAX_STRUCTURED_CLAIMS = 5
MAX_CITATIONS_PER_CLAIM = 5
MAX_CLAIM_CHARACTERS = 500
MAX_REASON_CHARACTERS = 500
STRUCTURED_CONTRACT_VERSION = "strict-grounding-v2"


def structured_answer_system_prompt() -> str:
    """Return the provider-independent grounding instructions."""
    return """Answer a medical-procedure question using only the supplied transcript cues.
Return raw JSON only, without Markdown or code fences. Treat adjacent cues as possibly
overlapping fragments of one sentence.

Grounding rules:
- Include only details that are explicit in the cited cues; use conservative paraphrases.
- Do not add medical knowledge, recommendations, causes, purposes, effectiveness, expected
  outcomes, anatomical directions, timing, quantities, or safety claims that are not stated.
- Preserve the evidence's action order, negation, uncertainty, conditions, and measurements.
- Do not turn facts that merely occur near each other into a causal or temporal relationship.
- Each claim must be fully supported by its cited cues considered together. Cite the smallest
  relevant set of cues, and never cite a cue merely because it is topically related.
- Keep each claim atomic: do not join separate actions or facts with an inferred "and", "while",
  "so", or "because" relationship. Prefer close paraphrases when cue fragments are incomplete.
- First identify the shortest cue span that directly answers the requested action. Use claims
  only from that answer span. Omit setup, alternate uses, later complications, and nearby
  techniques unless the question explicitly asks for them.
- Answer the question directly and stop when the requested action has been explained.
- Never diagnose, prescribe, or select a medication or dosage.
- If the cues do not explicitly answer the question, return no claims and briefly explain why.
- Prefer one to three claims of at most 35 words each, with one to four citation IDs per claim.
  Keep an insufficient-evidence reason under 240 characters.
- Order procedural claims as they appear in the evidence.

Schema:
{"claims":[{"text":"concise supported statement","citation_ids":["T001"]}],
 "insufficient_evidence_reason":null}"""


def structured_answer_repair_prompt(error: Exception) -> str:
    """Return a bounded correction request for one invalid provider response."""
    return (
        "Your response violated the required JSON grounding contract "
        f"({type(error).__name__}: {error}). Correct it once. Return JSON only, with two "
        "top-level keys: claims and insufficient_evidence_reason. Use no more than three "
        "claims, no more than four citation IDs per claim, no more than 35 words per claim, "
        "and no more than 240 characters for the reason. Do not add any new information."
    )


def structured_answer_json_schema() -> dict[str, Any]:
    """Return the exact schema requested from every structured provider."""
    return {
        "type": "object",
        "properties": {
            "claims": {
                "type": "array",
                "maxItems": MAX_STRUCTURED_CLAIMS,
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": MAX_CLAIM_CHARACTERS,
                        },
                        "citation_ids": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": MAX_CITATIONS_PER_CLAIM,
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["text", "citation_ids"],
                    "additionalProperties": False,
                },
            },
            "insufficient_evidence_reason": {
                "type": ["string", "null"],
                "maxLength": MAX_REASON_CHARACTERS,
            },
        },
        "required": ["claims", "insufficient_evidence_reason"],
        "additionalProperties": False,
    }


def structured_answer_user_prompt(request: EvidenceGenerationRequest) -> str:
    """Render the same question and evidence cues for every provider."""
    cues = "\n".join(
        f"{cue.cue_id} [{cue.start_seconds:.3f}-{cue.end_seconds:.3f}] {cue.text}"
        for cue in request.cues
    )
    return (
        f"Question: {request.question}\n"
        f"Predicted clip: {request.clip_start_seconds:.3f}-"
        f"{request.clip_end_seconds:.3f} seconds\n"
        f"Transcript cues:\n{cues}"
    )


def decode_structured_answer(content: str) -> StructuredAnswerDraft:
    """Decode JSON, tolerating only an otherwise exact outer Markdown code fence."""
    normalized = content.strip()
    if normalized.startswith("```"):
        lines = normalized.splitlines()
        if len(lines) < 3 or lines[0].lower() not in {"```", "```json"}:
            raise ValueError("structured response has an unsupported code fence")
        if lines[-1].strip() != "```":
            raise ValueError("structured response has an unterminated code fence")
        normalized = "\n".join(lines[1:-1]).strip()
    return parse_structured_answer(json.loads(normalized))


def parse_structured_answer(payload: Any) -> StructuredAnswerDraft:
    """Validate provider JSON before domain-level citation validation."""
    if not isinstance(payload, dict):
        raise TypeError("structured response must be a JSON object")
    required_keys = {"claims", "insufficient_evidence_reason"}
    if set(payload) != required_keys:
        raise ValueError(
            "structured response must contain only claims and insufficient_evidence_reason"
        )
    raw_claims = payload["claims"]
    if not isinstance(raw_claims, list):
        raise TypeError("structured response claims must be a list")
    if len(raw_claims) > MAX_STRUCTURED_CLAIMS:
        raise ValueError("structured response contains too many claims")
    claims = []
    for item in raw_claims:
        if not isinstance(item, dict):
            raise TypeError("each structured claim must be an object")
        if set(item) != {"text", "citation_ids"}:
            raise ValueError("each structured claim must contain only text and citation_ids")
        text = item["text"]
        citation_ids = item["citation_ids"]
        if not isinstance(text, str) or not isinstance(citation_ids, list):
            raise TypeError("claim text and citation_ids have invalid types")
        if not 1 <= len(text) <= MAX_CLAIM_CHARACTERS:
            raise ValueError("claim text length is outside the structured contract")
        if not 1 <= len(citation_ids) <= MAX_CITATIONS_PER_CLAIM:
            raise ValueError("claim citation count is outside the structured contract")
        if any(not isinstance(cue_id, str) for cue_id in citation_ids):
            raise ValueError("citation IDs must be strings")
        claims.append(
            AnswerClaimDraft(
                text=text,
                citation_ids=tuple(citation_ids),
            )
        )
    reason = payload["insufficient_evidence_reason"]
    if reason is not None and not isinstance(reason, str):
        raise ValueError("insufficient_evidence_reason must be text or null")
    if isinstance(reason, str) and len(reason) > MAX_REASON_CHARACTERS:
        raise ValueError("insufficient_evidence_reason is too long")
    return StructuredAnswerDraft(
        claims=tuple(claims),
        insufficient_evidence_reason=reason,
    )
