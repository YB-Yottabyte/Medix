"""Tests for evidence-constrained response generation."""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING

import pytest

from backend.adapters.grounded_generation import (
    GroqStructuredEvidenceAnswerModel,
    OllamaStructuredEvidenceAnswerModel,
)
from backend.domain import (
    ClipEvidence,
    EndToEndPipelineResult,
    EvidenceBundle,
    FrameEvidence,
    TranscriptEvidence,
)
from backend.generation import (
    AnswerClaimDraft,
    EvidenceGenerationRequest,
    EvidenceGroundedAnswerGenerator,
    ExtractiveEvidenceAnswerModel,
    InvalidGroundedAnswerError,
    StructuredAnswerDraft,
)
from backend.generation.structured import (
    decode_structured_answer,
    parse_structured_answer,
    structured_answer_system_prompt,
)
from backend.services import GroundedMedicalQAPipeline
from backend.services.pipeline import EMERGENCY_WARNING, RESTRICTED_SCOPE_MESSAGE
from evaluation.run_grounded_generation import grounded_generation_report

if TYPE_CHECKING:
    from pathlib import Path

_DIGEST = "a" * 64


def make_bundle() -> EvidenceBundle:
    return EvidenceBundle(
        bundle_id="bundle-1",
        question="How should I clean a wound?",
        video_id="video-1",
        source_uri="https://example.test/video-1",
        predicted_start_seconds=10,
        predicted_end_seconds=20,
        localization_model="test-localizer",
        transcript=(
            TranscriptEvidence(10, 13, "First clean the wound with clean water."),
            TranscriptEvidence(13, 16, "Then cover the wound with a clean dressing."),
            TranscriptEvidence(16, 20, "Keep watching the dressing."),
        ),
        frames=(FrameEvidence(15, "frame.jpg", _DIGEST),),
        clip=ClipEvidence(10, 20, 10, "clip.mp4", _DIGEST),
        scores={"joint": 0.8},
        provenance={"contains_gold_timestamps": False},
    )


class StubAnswerModel:
    model_name = "stub-structured-model"

    def __init__(self, draft: StructuredAnswerDraft):
        self.draft = draft

    def generate(self, _request: EvidenceGenerationRequest) -> StructuredAnswerDraft:
        return self.draft


def test_extractive_generator_returns_verbatim_cited_claims() -> None:
    answer = EvidenceGroundedAnswerGenerator(ExtractiveEvidenceAnswerModel(max_claims=2)).generate(
        make_bundle()
    )

    assert answer.status == "answered"
    assert answer.video_id == "video-1"
    assert len(answer.claims) == 2
    citation_text = {citation.cue_id: citation.text for citation in answer.citations}
    assert all(claim.text == citation_text[claim.citation_ids[0]] for claim in answer.claims)
    assert "[1]" in answer.response
    assert answer.response.endswith("[2]")
    assert "T001" not in answer.response


def test_grounded_generator_abstains_when_evidence_does_not_match_question() -> None:
    bundle = make_bundle()
    unrelated = EvidenceBundle(
        **{
            **bundle.as_dict(),
            "transcript": (
                TranscriptEvidence(10, 20, "The presenter introduces the next chapter."),
            ),
            "frames": bundle.frames,
            "clip": bundle.clip,
        }
    )

    answer = EvidenceGroundedAnswerGenerator(ExtractiveEvidenceAnswerModel()).generate(unrelated)

    assert answer.status == "abstained"
    assert answer.claims == ()
    assert answer.abstention_reason is not None


def test_grounded_generator_rejects_unknown_citations() -> None:
    generator = EvidenceGroundedAnswerGenerator(
        StubAnswerModel(
            StructuredAnswerDraft(claims=(AnswerClaimDraft("Unsupported output", ("T999",)),))
        )
    )

    with pytest.raises(InvalidGroundedAnswerError, match="unknown transcript"):
        generator.generate(make_bundle())


def test_grounded_generator_rejects_claim_without_lexical_evidence_support() -> None:
    generator = EvidenceGroundedAnswerGenerator(
        StubAnswerModel(
            StructuredAnswerDraft(
                claims=(AnswerClaimDraft("Take aspirin immediately.", ("T001",)),)
            )
        )
    )

    with pytest.raises(InvalidGroundedAnswerError, match="lacks lexical support"):
        generator.generate(make_bundle())


def test_grounded_generator_ignores_filler_words_when_checking_support() -> None:
    generator = EvidenceGroundedAnswerGenerator(
        StubAnswerModel(
            StructuredAnswerDraft(
                claims=(
                    AnswerClaimDraft(
                        "The clinician should prescribe antibiotics for the injury.",
                        ("T001",),
                    ),
                )
            )
        )
    )

    with pytest.raises(InvalidGroundedAnswerError, match="lacks lexical support"):
        generator.generate(make_bundle())


def test_grounded_pipeline_fails_closed_for_invalid_model_output() -> None:
    evidence_result = EndToEndPipelineResult(
        question=make_bundle().question,
        status="answered",
        selected_video_id="video-1",
        predicted_start_seconds=10,
        predicted_end_seconds=20,
        joint_score=0.8,
        evidence=make_bundle(),
        attempts=(),
        abstention_reason=None,
    )
    evidence_pipeline = SimpleNamespace(run=lambda _question: evidence_result)
    generator = EvidenceGroundedAnswerGenerator(
        StubAnswerModel(
            StructuredAnswerDraft(claims=(AnswerClaimDraft("Unsupported output", ("T999",)),))
        )
    )

    result = GroundedMedicalQAPipeline(
        evidence_pipeline=evidence_pipeline,
        answer_generator=generator,
    ).run(make_bundle().question)

    assert result.answer.status == "abstained"
    assert "grounding validation" in (result.answer.abstention_reason or "")
    assert result.answer.evidence_bundle_id == "bundle-1"
    assert result.answer.video_id == "video-1"
    assert result.answer.clip_artifact_path == "clip.mp4"


@pytest.mark.parametrize(
    ("question", "disposition", "response"),
    (
        ("The person is not breathing.", "emergency", EMERGENCY_WARNING),
        ("What dosage should I take?", "restricted", RESTRICTED_SCOPE_MESSAGE),
    ),
)
def test_grounded_pipeline_applies_safety_triage_before_retrieval(
    question: str,
    disposition: str,
    response: str,
) -> None:
    calls = []
    evidence_pipeline = SimpleNamespace(run=lambda value: calls.append(value))
    generator = EvidenceGroundedAnswerGenerator(ExtractiveEvidenceAnswerModel())

    result = GroundedMedicalQAPipeline(
        evidence_pipeline=evidence_pipeline,
        answer_generator=generator,
    ).run(question)

    assert calls == []
    assert result.answer.status == "abstained"
    assert result.answer.response == response
    assert result.answer.evidence_bundle_id is None
    assert result.safety_assessment.disposition == disposition


def test_evidence_bundle_manifest_round_trip(tmp_path: Path) -> None:
    from backend.evidence import EvidenceArtifactStore

    store = EvidenceArtifactStore(tmp_path)
    bundle = make_bundle()
    store.write_manifest(bundle.bundle_id, bundle.as_dict())

    assert store.read_bundle(bundle.bundle_id) == bundle


def test_groq_adapter_parses_structured_claims() -> None:
    message = SimpleNamespace(
        content=(
            '{"claims":[{"text":"Clean the wound.",'
            '"citation_ids":["T001"]}],"insufficient_evidence_reason":null}'
        )
    )
    captured = {}

    def create_completion(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    completions = SimpleNamespace(create=create_completion)
    model = GroqStructuredEvidenceAnswerModel(
        SimpleNamespace(chat=SimpleNamespace(completions=completions)),
        model="test-model",
    )

    draft = model.generate(
        EvidenceGenerationRequest(
            question="How do I clean it?",
            cues=(),
            clip_start_seconds=0,
            clip_end_seconds=10,
        )
    )

    assert draft.claims[0].citation_ids == ("T001",)
    assert model.model_name == "groq-strict-grounding-v2:test-model"
    assert captured["response_format"]["type"] == "json_schema"
    assert captured["response_format"]["json_schema"]["strict"] is True


def test_ollama_adapter_uses_the_shared_strict_contract() -> None:
    captured = {}

    class Response:
        @staticmethod
        def raise_for_status() -> None:
            return None

        @staticmethod
        def json() -> dict:
            return {
                "message": {
                    "content": (
                        '{"claims":[{"text":"Clean the wound.",'
                        '"citation_ids":["T001"]}],'
                        '"insufficient_evidence_reason":null}'
                    )
                }
            }

    class Session:
        @staticmethod
        def post(url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return Response()

    request = EvidenceGenerationRequest(
        question="How do I clean it?",
        cues=(),
        clip_start_seconds=0,
        clip_end_seconds=10,
    )
    model = OllamaStructuredEvidenceAnswerModel(
        base_url="http://localhost:11434/",
        model="qwen-test",
        session=Session(),
    )

    draft = model.generate(request)

    assert draft.claims[0].citation_ids == ("T001",)
    assert model.model_name == "ollama-strict-grounding-v2:qwen-test"
    assert captured["url"] == "http://localhost:11434/api/chat"
    assert (
        captured["json"]["format"]
        == (GroqStructuredEvidenceAnswerModel._response_format()["json_schema"]["schema"])
    )
    assert captured["json"]["messages"][1]["content"].startswith("Question: How do I clean it?")
    assert captured["json"]["think"] is False
    assert captured["json"]["options"]["num_predict"] == 512
    assert captured["json"]["format"]["properties"]["claims"]["maxItems"] == 5


def test_ollama_adapter_repairs_one_invalid_structured_response() -> None:
    captured = []
    contents = iter(
        (
            '{"claims":[],"insufficient_evidence_reason":null,"extra":true}',
            (
                '{"claims":[{"text":"Clean the wound.",'
                '"citation_ids":["T001"]}],'
                '"insufficient_evidence_reason":null}'
            ),
        )
    )

    class Response:
        @staticmethod
        def raise_for_status() -> None:
            return None

        @staticmethod
        def json() -> dict:
            return {"message": {"content": next(contents)}}

    class Session:
        @staticmethod
        def post(_url, **kwargs):
            captured.append(kwargs)
            return Response()

    model = OllamaStructuredEvidenceAnswerModel(
        base_url="http://localhost:11434",
        model="qwen-test",
        session=Session(),
    )
    draft = model.generate(
        EvidenceGenerationRequest(
            question="How do I clean it?",
            cues=(),
            clip_start_seconds=0,
            clip_end_seconds=10,
        )
    )

    assert draft.claims[0].text == "Clean the wound."
    assert len(captured) == 2
    assert "Correct it once" in captured[1]["json"]["messages"][-1]["content"]


def test_shared_structured_parser_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="only claims"):
        parse_structured_answer(
            {
                "claims": [],
                "insufficient_evidence_reason": "No support.",
                "unverified_advice": "Take a medication.",
            }
        )


def test_shared_structured_decoder_accepts_only_an_outer_json_fence() -> None:
    draft = decode_structured_answer(
        """```json
{"claims":[{"text":"Clean the wound.","citation_ids":["T001"]}],
"insufficient_evidence_reason":null}
```"""
    )

    assert draft.claims[0].text == "Clean the wound."

    with pytest.raises(ValueError, match="unsupported code fence"):
        decode_structured_answer("```python\n{}\n```")


def test_shared_structured_prompt_forbids_inferred_relationships() -> None:
    prompt = structured_answer_system_prompt()

    assert "causal or temporal relationship" in prompt
    assert "Preserve the evidence's action order" in prompt
    assert "smallest\n  relevant set of cues" in prompt


def test_grounded_generation_report_states_metric_boundary() -> None:
    report = grounded_generation_report(
        [
            {
                "status": "answered",
                "evidence_bundle_id": "bundle",
                "predicted_video_id": "video",
                "expected_video_id": "video",
                "claims": [{"text": "Clean it.", "citation_ids": ["T001"]}],
                "citations": [{"cue_id": "T001", "text": "Clean it."}],
            },
            {
                "status": "answered",
                "evidence_bundle_id": "other-bundle",
                "predicted_video_id": "other-video",
                "expected_video_id": "other-video",
                "claims": [{"text": "Cover it.", "citation_ids": ["T001"]}],
                "citations": [{"cue_id": "T001", "text": "Cover it."}],
            },
        ]
    )

    assert report["valid_citation_claim_rate"] == 1
    assert report["verbatim_extractive_claim_rate"] == 1
    assert "not clinical correctness" in report["interpretation_boundary"]
