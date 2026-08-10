"""Tests for paired generation comparison and blinded review exports."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import pytest

from backend.domain import (
    ClipEvidence,
    EvidenceBundle,
    FrameEvidence,
    TranscriptEvidence,
)
from backend.evidence import EvidenceArtifactStore
from backend.generation import (
    AnswerClaimDraft,
    EvidenceGroundedAnswerGenerator,
    StructuredAnswerDraft,
)
from evaluation.run_generation_comparison import (
    BlindedReviewManifestBuilder,
    GenerationComparisonExperiment,
    GroundedGenerationCondition,
    build_conditions,
    comparison_report,
)

if TYPE_CHECKING:
    from pathlib import Path

_DIGEST = "b" * 64


def make_bundle() -> EvidenceBundle:
    return EvidenceBundle(
        bundle_id="comparison-bundle",
        question="How do I cover a wound?",
        video_id="video",
        source_uri="https://example.test/video",
        predicted_start_seconds=2,
        predicted_end_seconds=8,
        localization_model="localizer",
        transcript=(TranscriptEvidence(2, 8, "Cover the wound with a clean dressing."),),
        frames=(FrameEvidence(5, "frame.jpg", _DIGEST),),
        clip=ClipEvidence(2, 8, 6, "clip.mp4", _DIGEST),
        scores={"joint": 0.9},
        provenance={"contains_gold_timestamps": False},
    )


@dataclass(frozen=True)
class StubCondition:
    name: str
    model_name: str
    response: str

    def generate(self, evidence: EvidenceBundle) -> dict[str, Any]:
        return {
            "question": evidence.question,
            "status": "answered",
            "response": self.response,
            "claims": [],
            "citations": [],
            "evidence_bundle_id": evidence.bundle_id,
            "video_id": evidence.video_id,
            "generation_model": self.model_name,
            "abstention_reason": None,
        }


class UnsupportedClaimModel:
    model_name = "unsupported-claim-model"

    def generate(self, _request):
        return StructuredAnswerDraft(
            claims=(AnswerClaimDraft("Take aspirin immediately.", ("T001",)),)
        )


def test_comparison_uses_same_bundle_for_every_condition(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    bundle = make_bundle()
    store.write_manifest(bundle.bundle_id, bundle.as_dict())
    conditions = (
        StubCondition("condition-a", "model-a", "Answer A"),
        StubCondition("condition-b", "model-b", "Answer B"),
    )
    outputs = GenerationComparisonExperiment(
        store=store,
        conditions=conditions,
    ).run(
        [
            {
                "sample_id": "sample",
                "expected_video_id": "video",
                "evidence_bundle_id": bundle.bundle_id,
            }
        ]
    )

    assert len(outputs) == 2
    assert {output["evidence_bundle_id"] for output in outputs} == {bundle.bundle_id}
    assert {output["condition"] for output in outputs} == {
        "condition-a",
        "condition-b",
    }


def test_grounding_rejection_is_a_completed_abstention(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    bundle = make_bundle()
    store.write_manifest(bundle.bundle_id, bundle.as_dict())
    condition = GroundedGenerationCondition(
        name="structured",
        generator=EvidenceGroundedAnswerGenerator(UnsupportedClaimModel()),
    )

    output = GenerationComparisonExperiment(
        store=store,
        conditions=(condition,),
    ).run([{"sample_id": "sample", "evidence_bundle_id": bundle.bundle_id}])[0]

    assert output["execution_status"] == "completed"
    assert output["status"] == "abstained"
    assert "grounding validation" in output["abstention_reason"]


def test_comparison_resume_reuses_matching_completed_output(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    bundle = make_bundle()
    store.write_manifest(bundle.bundle_id, bundle.as_dict())
    condition = StubCondition("condition-a", "model-a", "new answer")
    existing = {
        "sample_id": "sample",
        "condition": "condition-a",
        "condition_model": "model-a",
        "execution_status": "completed",
        "status": "answered",
        "response": "cached answer",
        "claims": [],
        "citations": [],
        "generation_ms": 3,
        "evidence_bundle_id": bundle.bundle_id,
    }

    outputs = GenerationComparisonExperiment(
        store=store,
        conditions=(condition,),
    ).run(
        [{"sample_id": "sample", "evidence_bundle_id": bundle.bundle_id}],
        existing_outputs=[existing],
    )

    assert outputs == [existing]


def test_blinded_manifest_separates_condition_identity(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    bundle = make_bundle()
    store.write_manifest(bundle.bundle_id, bundle.as_dict())
    conditions = (
        StubCondition("condition-a", "model-a", "Answer A"),
        StubCondition("condition-b", "model-b", "Answer B"),
    )
    outputs = GenerationComparisonExperiment(
        store=store,
        conditions=conditions,
    ).run(
        [
            {
                "sample_id": "sample",
                "expected_video_id": "video",
                "evidence_bundle_id": bundle.bundle_id,
            }
        ]
    )

    manifest, key = BlindedReviewManifestBuilder(seed=7).build(
        outputs,
        store=store,
        expected_conditions=("condition-a", "condition-b"),
        split="validation",
    )

    responses = manifest["cases"][0]["responses"]
    assert len(responses) == 2
    assert all("condition" not in response for response in responses)
    assert all(
        set(response["ratings"])
        == {
            "evidence_support",
            "answer_relevance",
            "completeness",
            "coherence",
            "unsafe_or_unsupported_claim",
        }
        for response in responses
    )
    assert {mapping["condition"] for mapping in key["condition_key"]} == {
        "condition-a",
        "condition-b",
    }


def test_comparison_report_requires_paired_completed_conditions() -> None:
    outputs = [
        {
            "sample_id": "one",
            "condition": "a",
            "execution_status": "completed",
            "status": "answered",
            "response": "Answer",
            "claims": [],
            "generation_ms": 2,
        },
        {
            "sample_id": "one",
            "condition": "b",
            "execution_status": "completed",
            "status": "answered",
            "response": "Other answer",
            "claims": [],
            "generation_ms": 3,
        },
        {
            "sample_id": "two",
            "condition": "a",
            "execution_status": "completed",
            "status": "answered",
            "response": "Answer",
            "claims": [],
            "generation_ms": 1,
        },
    ]

    report = comparison_report(outputs, expected_conditions=("a", "b"))

    assert report["paired_completed_samples"] == 1
    assert report["conditions"]["a"]["attempted"] == 2
    assert report["conditions"]["b"]["attempted"] == 1


def test_remote_comparison_requires_explicit_api_authorization() -> None:
    with pytest.raises(ValueError, match="--allow-api"):
        build_conditions(
            ("structured-groq",),
            allow_api=False,
            groq_model="test-model",
        )


def test_local_ollama_comparison_condition_needs_no_cloud_authorization() -> None:
    [condition] = build_conditions(
        ("structured-ollama",),
        allow_api=False,
        groq_model="unused",
        ollama_base_url="http://localhost:11434",
        ollama_model="qwen-test",
    )

    assert condition.name == "structured-ollama"
    assert condition.model_name == "ollama-strict-grounding-v2:qwen-test"
