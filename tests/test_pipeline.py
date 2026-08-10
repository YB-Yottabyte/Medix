"""Tests for evidence gating and deterministic scope triage."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.adapters.response_generation import ResponseGenerator
from backend.services.pipeline import RetrievalGate, SafetyTriageService


class RecordingRetriever:
    def __init__(self, results: list[dict[str, Any]]):
        self.results = results
        self.context_calls = 0

    def search(self, _query: str) -> list[dict[str, Any]]:
        return self.results

    def format_results_for_context(self, _results: list[dict[str, Any]]) -> str:
        self.context_calls += 1
        return "Approved transcript evidence"


class RecordingAI:
    def __init__(self):
        self.calls = 0

    def generate_response(self, _query: str, _context: str) -> str:
        self.calls += 1
        return "Grounded answer"


def test_safety_triage_distinguishes_supported_restricted_and_emergency() -> None:
    triage = SafetyTriageService()

    assert triage.assess("How do I dress a minor wound?").disposition == "supported"
    assert triage.assess("What dosage should I take?").disposition == "restricted"
    assert triage.assess("The person is not breathing.").disposition == "emergency"


def test_seed_refusal_dataset_matches_deterministic_triage() -> None:
    cases_path = (
        Path(__file__).resolve().parents[1] / "evaluation" / "datasets" / "refusal_cases.json"
    )
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    triage = SafetyTriageService()

    for case in cases:
        assert triage.assess(case["query"]).disposition == case["expected_disposition"]


def test_retrieval_gate_exposes_timestamped_evidence() -> None:
    decision = RetrievalGate(0.5).assess(
        [
            {
                "sample_id": "42",
                "question": "How to dress a wound?",
                "video_id": "video-1",
                "answer_start": 12,
                "answer_end": 40,
                "similarity_score": 0.8,
            }
        ]
    )

    assert decision.answerable is True
    assert decision.evidence[0]["sample_id"] == "42"
    assert decision.evidence[0]["start_time"] == 12


def test_generator_does_not_call_llm_below_confidence_threshold() -> None:
    retriever = RecordingRetriever([{"question": "Weak match", "similarity_score": 0.3}])
    ai = RecordingAI()
    generator = ResponseGenerator(
        {"safety": {"answer_confidence_threshold": 0.5}},
        retriever,
        ai,
    )

    response = generator.generate("How should I do this?")

    assert response["status"] == "abstained"
    assert response["answerable"] is False
    assert ai.calls == 0
    assert retriever.context_calls == 0


def test_generator_calls_llm_when_evidence_passes_threshold() -> None:
    retriever = RecordingRetriever(
        [
            {
                "question": "Strong match",
                "video_id": "video-1",
                "similarity_score": 0.8,
            }
        ]
    )
    ai = RecordingAI()
    generator = ResponseGenerator(
        {"safety": {"answer_confidence_threshold": 0.5}},
        retriever,
        ai,
    )

    response = generator.generate("How should I do this?")

    assert response["status"] == "answered"
    assert response["evidence"][0]["video_id"] == "video-1"
    assert ai.calls == 1
    assert retriever.context_calls == 1
