"""Orchestrate retrieval, localization, and evidence extraction."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import replace
from time import perf_counter
from typing import TYPE_CHECKING

import numpy as np

from backend.domain import (
    CandidateAttempt,
    EndToEndPipelineResult,
    LocalizationRequest,
)
from backend.evidence import EvidenceExtractionRequest, EvidenceUnavailableError
from backend.performance import timed
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
        self._last_timings: ContextVar[dict[str, float] | None] = ContextVar(
            "legacy_offline_timings", default=None
        )

    @property
    def last_timings_ms(self) -> dict[str, float]:
        """Compatibility view for same-context offline benchmarks, not HTTP telemetry."""
        return self._last_timings.get() or {}

    @last_timings_ms.setter
    def last_timings_ms(self, value: dict[str, float]) -> None:
        self._last_timings.set(value)

    @timed("evidence.pipeline")
    def run(self, question: str, *, retrieval_query: str | None = None) -> EndToEndPipelineResult:
        normalized_question = question.strip()
        if not normalized_question:
            raise ValueError("question must not be empty")

        self.last_timings_ms = {"retrieval": 0.0, "localization": 0.0, "evidence": 0.0}
        stage_started = perf_counter()
        retrieved = self.video_retriever.retrieve(
            retrieval_query or normalized_question,
            limit=self.top_k,
        )
        self.last_timings_ms["retrieval"] = (perf_counter() - stage_started) * 1000
        attempts = []
        localizable = []
        for rank, candidate in enumerate(retrieved, 1):
            retrieval_confidence = float(np.clip((candidate.retrieval_score + 1.0) / 2.0, 0.0, 1.0))
            stage_started = perf_counter()
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

            finally:
                self.last_timings_ms["localization"] += (perf_counter() - stage_started) * 1000

        localizable.sort(key=lambda item: (-item[0], item[1]))
        for joint_score, _rank, attempt, document in localizable:
            stage_started = perf_counter()
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

            finally:
                self.last_timings_ms["evidence"] += (perf_counter() - stage_started) * 1000

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

    @timed("evidence.alternative")
    def alternative_evidence(
        self, previous: EndToEndPipelineResult, *, excluded: set[str]
    ) -> EndToEndPipelineResult | None:
        """Reuse already-scored candidates; do not repeat retrieval or localization."""
        candidates = sorted(
            (
                a
                for a in previous.attempts
                if a.video_id not in excluded
                and a.joint_score is not None
                and a.failure_reason is None
            ),
            key=lambda a: (-a.joint_score, a.retrieval_rank),
        )
        for attempt in candidates:
            document = self.video_catalog.get(attempt.video_id)
            try:
                evidence = self.evidence_extractor.extract(
                    EvidenceExtractionRequest(
                        question=previous.question,
                        video_id=attempt.video_id,
                        source_uri=document.source_uri,
                        start_seconds=float(attempt.predicted_start_seconds),
                        end_seconds=float(attempt.predicted_end_seconds),
                        localization_model=self.temporal_localizer.model_name,
                        scores={
                            "retrieval": attempt.retrieval_confidence,
                            "localization": attempt.localization_score,
                            "joint": attempt.joint_score,
                        },
                        provenance={
                            "pipeline": "live-answer-recovery",
                            "retrieval_rank": attempt.retrieval_rank,
                        },
                    )
                )
            except EvidenceUnavailableError:
                continue
            return replace(
                previous,
                selected_video_id=attempt.video_id,
                predicted_start_seconds=attempt.predicted_start_seconds,
                predicted_end_seconds=attempt.predicted_end_seconds,
                joint_score=attempt.joint_score,
                evidence=evidence,
                attempts=tuple(
                    replace(a, evidence_bundle_id=evidence.bundle_id) if a == attempt else a
                    for a in previous.attempts
                ),
            )
        return None

    @staticmethod
    def _reason(error: Exception) -> str:
        return f"{type(error).__name__}: {error}"
