"""Small deterministic test doubles for HTTP contract tests."""

from __future__ import annotations

from typing import Any, ClassVar

from backend.domain import (
    EndToEndPipelineResult,
    EvidenceCitation,
    GroundedAnswer,
    GroundedClaim,
    GroundedMedicalPipelineResult,
)
from backend.services.pipeline import SafetyAssessment


class FakeDatabase:
    procedures: ClassVar[list[dict[str, str]]] = [{"question": "How to perform CPR?"}]


class FakeQAService:
    image_recognizer = object()

    def answer_text(self, query: str) -> dict[str, Any]:
        return {
            "query": query.strip(),
            "response": "Test guidance",
            "retrieved_procedures": [],
            "num_procedures_found": 0,
        }

    def answer_with_video(self, query: str) -> dict[str, Any]:
        return {
            "query": query.strip(),
            "response": "Test guidance",
            "video_url": None,
            "video_id": None,
            "answer_start": None,
            "answer_end": None,
            "video_steps": [],
            "retrieved_procedures": [],
        }

    def analyze_image(self, _image_bytes: bytes) -> dict[str, Any]:
        return {"success": True, "recognition": {"top_match": {"question": "Wound care"}}}

    def transcribe(self, _audio_bytes: bytes, _filename: str) -> dict[str, Any]:
        return {"success": True, "text": "How do I dress this wound?", "method": "fake"}

    def analyze_frame(self, _image_bytes: bytes) -> dict[str, Any]:
        return {"success": True, "condition": "wound"}

    def answer_multimodal(self, **_inputs: Any) -> dict[str, Any]:
        return {"success": True, "pipeline": "multimodal-rag"}


class FakeResearchQAService:
    """Deterministic complete-pipeline result for HTTP contract tests."""

    def run(self, question: str) -> GroundedMedicalPipelineResult:
        evidence_result = EndToEndPipelineResult(
            question=question,
            status="answered",
            selected_video_id="video-1",
            predicted_start_seconds=12.0,
            predicted_end_seconds=24.0,
            joint_score=0.82,
            evidence=None,
            attempts=(),
            abstention_reason=None,
        )
        answer = GroundedAnswer(
            question=question,
            status="answered",
            response="1. Apply direct pressure. [1]",
            claims=(
                GroundedClaim(
                    text="Apply direct pressure.",
                    citation_ids=("T001",),
                ),
            ),
            citations=(
                EvidenceCitation(
                    cue_id="T001",
                    start_seconds=13.0,
                    end_seconds=15.0,
                    text="Apply direct pressure to the wound.",
                ),
            ),
            evidence_bundle_id="bundle-1",
            video_id="video-1",
            source_uri="https://example.test/video-1",
            clip_start_seconds=12.0,
            clip_end_seconds=24.0,
            clip_artifact_path="media/clips/video-1/clip.mp4",
            generation_model="fake-grounded-model",
            abstention_reason=None,
        )
        return GroundedMedicalPipelineResult(
            evidence_result=evidence_result,
            answer=answer,
            safety_assessment=SafetyAssessment(disposition="supported"),
        )
