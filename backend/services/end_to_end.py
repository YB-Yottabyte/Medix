"""Orchestrate retrieval, localization, and evidence extraction."""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

import numpy as np

from backend.domain import (
    CandidateAttempt,
    EndToEndPipelineResult,
    LocalizationRequest,
)
from backend.evidence import EvidenceExtractionRequest, EvidenceUnavailableError
from backend.transcripts import TranscriptUnavailableError
from backend.video_processing import VideoUnavailableError

if TYPE_CHECKING:
    from backend.evidence import EvidenceExtractor
    from backend.temporal_localization import TemporalLocalizer
    from backend.video_retrieval import VideoCatalog, VideoRetriever


class EndToEndMedicalPipeline:
    """Run each stage without reading benchmark target labels."""

    def __init__(
        self,
        *,
        video_retriever: VideoRetriever,
        video_catalog: VideoCatalog,
        temporal_localizer: TemporalLocalizer,
        evidence_extractor: EvidenceExtractor,
        top_k: int = 5,
        retrieval_weight: float = 0.5,
    ):
        if top_k < 1:
            raise ValueError("top_k must be positive")
        if not 0 <= retrieval_weight <= 1:
            raise ValueError("retrieval_weight must be between zero and one")
        self.video_retriever = video_retriever
        self.video_catalog = video_catalog
        self.temporal_localizer = temporal_localizer
        self.evidence_extractor = evidence_extractor
        self.top_k = top_k
        self.retrieval_weight = retrieval_weight

    def run(self, question: str) -> EndToEndPipelineResult:
        normalized_question = question.strip()
        if not normalized_question:
            raise ValueError("question must not be empty")

        retrieved = self.video_retriever.retrieve(
            normalized_question,
            limit=self.top_k,
        )
        attempts = []
        localizable = []
        for rank, candidate in enumerate(retrieved, 1):
            retrieval_confidence = float(np.clip((candidate.retrieval_score + 1.0) / 2.0, 0.0, 1.0))
            try:
                document = self.video_catalog.get(candidate.video_id)
                segment = self.temporal_localizer.localize(
                    LocalizationRequest(
                        question=normalized_question,
                        video_id=candidate.video_id,
                        duration_seconds=document.duration_seconds,
                    )
                )
                joint_score = (
                    self.retrieval_weight * retrieval_confidence
                    + (1.0 - self.retrieval_weight) * segment.localization_score
                )
                attempt = CandidateAttempt(
                    video_id=candidate.video_id,
                    title=candidate.title,
                    retrieval_rank=rank,
                    retrieval_score=candidate.retrieval_score,
                    retrieval_confidence=retrieval_confidence,
                    localization_score=segment.localization_score,
                    joint_score=joint_score,
                    predicted_start_seconds=segment.start_seconds,
                    predicted_end_seconds=segment.end_seconds,
                    evidence_bundle_id=None,
                    failure_reason=None,
                )
                attempts.append(attempt)
                localizable.append((joint_score, rank, attempt, document))
            except (KeyError, TranscriptUnavailableError, VideoUnavailableError) as exc:
                attempts.append(
                    CandidateAttempt(
                        video_id=candidate.video_id,
                        title=candidate.title,
                        retrieval_rank=rank,
                        retrieval_score=candidate.retrieval_score,
                        retrieval_confidence=retrieval_confidence,
                        localization_score=None,
                        joint_score=None,
                        predicted_start_seconds=None,
                        predicted_end_seconds=None,
                        evidence_bundle_id=None,
                        failure_reason=self._reason(exc),
                    )
                )

        localizable.sort(key=lambda item: (-item[0], item[1]))
        for joint_score, _rank, attempt, document in localizable:
            try:
                evidence = self.evidence_extractor.extract(
                    EvidenceExtractionRequest(
                        question=normalized_question,
                        video_id=attempt.video_id,
                        source_uri=document.source_uri,
                        start_seconds=float(attempt.predicted_start_seconds),
                        end_seconds=float(attempt.predicted_end_seconds),
                        localization_model=self.temporal_localizer.model_name,
                        scores={
                            "retrieval": attempt.retrieval_confidence,
                            "localization": attempt.localization_score,
                            "joint": joint_score,
                        },
                        provenance={
                            "pipeline": "end-to-end-medix-research",
                            "retrieval_rank": attempt.retrieval_rank,
                            "retrieval_weight": self.retrieval_weight,
                        },
                    )
                )
            except EvidenceUnavailableError as exc:
                attempts = [
                    replace(
                        item,
                        failure_reason=self._reason(exc),
                    )
                    if item.video_id == attempt.video_id
                    and item.retrieval_rank == attempt.retrieval_rank
                    else item
                    for item in attempts
                ]
                continue

            attempts = [
                replace(item, evidence_bundle_id=evidence.bundle_id)
                if item.video_id == attempt.video_id
                and item.retrieval_rank == attempt.retrieval_rank
                else item
                for item in attempts
            ]
            return EndToEndPipelineResult(
                question=normalized_question,
                status="answered",
                selected_video_id=attempt.video_id,
                predicted_start_seconds=attempt.predicted_start_seconds,
                predicted_end_seconds=attempt.predicted_end_seconds,
                joint_score=joint_score,
                evidence=evidence,
                attempts=tuple(attempts),
                abstention_reason=None,
            )

        return EndToEndPipelineResult(
            question=normalized_question,
            status="abstained",
            selected_video_id=None,
            predicted_start_seconds=None,
            predicted_end_seconds=None,
            joint_score=None,
            evidence=None,
            attempts=tuple(attempts),
            abstention_reason="No retrieved candidate produced complete local evidence.",
        )

    @staticmethod
    def _reason(error: Exception) -> str:
        return f"{type(error).__name__}: {error}"
