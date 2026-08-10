"""Compose evidence acquisition with fail-closed grounded generation."""

from __future__ import annotations

from typing import TYPE_CHECKING

from backend.domain import (
    EndToEndPipelineResult,
    GroundedAnswer,
    GroundedMedicalPipelineResult,
)
from backend.generation import InvalidGroundedAnswerError
from backend.generation.grounded import GENERATION_ABSTENTION_MESSAGE
from backend.services.pipeline import (
    RESTRICTED_SCOPE_MESSAGE,
    SafetyAssessment,
    SafetyTriageService,
)

if TYPE_CHECKING:
    from backend.generation import EvidenceGroundedAnswerGenerator
    from backend.services.end_to_end import EndToEndMedicalPipeline


class GroundedMedicalQAPipeline:
    """Run the research evidence pipeline, then answer only from its bundle."""

    def __init__(
        self,
        *,
        evidence_pipeline: EndToEndMedicalPipeline,
        answer_generator: EvidenceGroundedAnswerGenerator,
        safety_triage: SafetyTriageService | None = None,
    ):
        self.evidence_pipeline = evidence_pipeline
        self.answer_generator = answer_generator
        self.safety_triage = safety_triage or SafetyTriageService()

    def run(self, question: str) -> GroundedMedicalPipelineResult:
        safety = self.safety_triage.assess(question)
        if safety.disposition != "supported":
            return self._safety_abstention(question, safety)
        evidence_result = self.evidence_pipeline.run(question)
        if evidence_result.evidence is None:
            answer = self._abstain(
                question=evidence_result.question,
                reason=evidence_result.abstention_reason
                or "The evidence pipeline returned no complete bundle.",
            )
        else:
            try:
                answer = self.answer_generator.generate(evidence_result.evidence)
            except (InvalidGroundedAnswerError, TypeError, ValueError) as exc:
                answer = self.answer_generator.abstain(
                    evidence_result.evidence,
                    f"Generation output failed grounding validation: {exc}",
                )
        return GroundedMedicalPipelineResult(
            evidence_result=evidence_result,
            answer=answer,
            safety_assessment=safety,
        )

    def _safety_abstention(
        self,
        question: str,
        safety: SafetyAssessment,
    ) -> GroundedMedicalPipelineResult:
        normalized_question = question.strip()
        if not normalized_question:
            raise ValueError("question must not be empty")
        reason = safety.reason or "The question is outside the supported procedure scope."
        response = safety.warning or RESTRICTED_SCOPE_MESSAGE
        evidence_result = EndToEndPipelineResult(
            question=normalized_question,
            status="abstained",
            selected_video_id=None,
            predicted_start_seconds=None,
            predicted_end_seconds=None,
            joint_score=None,
            evidence=None,
            attempts=(),
            abstention_reason=reason,
        )
        answer = GroundedAnswer(
            question=normalized_question,
            status="abstained",
            response=response,
            claims=(),
            citations=(),
            evidence_bundle_id=None,
            video_id=None,
            source_uri=None,
            clip_start_seconds=None,
            clip_end_seconds=None,
            clip_artifact_path=None,
            generation_model="safety-triage-v1",
            abstention_reason=reason,
        )
        return GroundedMedicalPipelineResult(
            evidence_result=evidence_result,
            answer=answer,
            safety_assessment=safety,
        )

    def _abstain(self, *, question: str, reason: str) -> GroundedAnswer:
        return GroundedAnswer(
            question=question,
            status="abstained",
            response=GENERATION_ABSTENTION_MESSAGE,
            claims=(),
            citations=(),
            evidence_bundle_id=None,
            video_id=None,
            source_uri=None,
            clip_start_seconds=None,
            clip_end_seconds=None,
            clip_artifact_path=None,
            generation_model=self.answer_generator.model.model_name,
            abstention_reason=reason,
        )
