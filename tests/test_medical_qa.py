"""Unit tests for transport-independent QA orchestration."""

from __future__ import annotations

from typing import Any

import pytest

from backend.errors import ValidationError
from backend.services.medical_qa import MedicalQAService
from tests.test_application import make_settings


class StubGenerator:
    def generate(self, query: str) -> dict[str, Any]:
        return {
            "query": query,
            "response": "Apply firm pressure.",
            "retrieved_procedures": [
                {
                    "question": "How to dress a wound?",
                    "video_id": "abc123",
                    "youtube_url": "https://youtube.test/abc123",
                    "answer_start": 12.8,
                    "answer_end": 40.2,
                    "steps": [{"absolute_bounds": [12, 20], "heading": "Apply pressure"}],
                }
            ],
            "num_procedures_found": 1,
        }


class StubRetriever:
    def format_results_for_context(self, _results: list[dict[str, Any]]) -> str:
        return "Transcript context"

    def multi_query_search(
        self, _queries: list[str], _weights: list[float]
    ) -> list[dict[str, Any]]:
        return []


class StubAI:
    def generate_multimodal_response(self, _query: str, _context: str) -> str:
        return "Guidance"


class StubTranscription:
    MODEL = "stub"

    def transcribe(self, _audio: bytes, _filename: str) -> str:
        return "transcribed question"


def make_service() -> MedicalQAService:
    return MedicalQAService(
        settings=make_settings(),
        response_generator=StubGenerator(),
        retriever=StubRetriever(),
        ai_handler=StubAI(),
        image_recognizer=None,
        transcription_service=StubTranscription(),
    )


def test_video_answer_maps_top_procedure_metadata() -> None:
    result = make_service().answer_with_video("How do I dress a wound?")

    assert result["video_id"] == "abc123"
    assert result["answer_start"] == 12
    assert result["video_steps"] == [{"time": 12, "description": "Apply pressure"}]


def test_text_answer_rejects_blank_query() -> None:
    with pytest.raises(ValidationError, match="No query"):
        make_service().answer_text("  ")


def test_text_answer_refuses_dosage_selection_before_generation() -> None:
    result = make_service().answer_text("What dosage should I give this person?")

    assert result["status"] == "abstained"
    assert result["safety"]["disposition"] == "restricted"
    assert result["retrieved_procedures"] == []


def test_text_answer_flags_immediate_emergency_language() -> None:
    result = make_service().answer_text("The person is unconscious and will not wake up.")

    assert result["safety"]["disposition"] == "emergency"
    assert result["emergency_warning"]


def test_image_size_limit_is_enforced_before_model_access() -> None:
    with pytest.raises(ValidationError, match="too large"):
        make_service().analyze_frame(b"x" * 1025)
