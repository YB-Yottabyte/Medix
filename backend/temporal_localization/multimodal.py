"""Visual reranking of transcript-derived temporal candidates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import numpy as np

from backend.domain import LocalizationRequest, TemporalSegment
from backend.video_processing import VideoUnavailableError

if TYPE_CHECKING:
    from backend.temporal_localization.transcript import (
        TranscriptWindowCandidate,
        TranscriptWindowLocalizer,
    )
    from backend.video_processing import FrameExtractor, FrameSample


class FrameScorer(Protocol):
    model_name: str

    def score(
        self,
        question: str,
        frames: tuple[FrameSample, ...],
    ) -> tuple[float, ...]: ...


@dataclass(frozen=True)
class MultimodalLocalizationResult:
    segment: TemporalSegment
    used_visual_evidence: bool
    transcript_score: float
    visual_score: float | None
    fusion_score: float


class MultimodalWindowLocalizer:
    """Fuse transcript similarity with sampled-frame similarity."""

    def __init__(
        self,
        *,
        transcript_localizer: TranscriptWindowLocalizer,
        frame_extractor: FrameExtractor,
        frame_scorer: FrameScorer,
        transcript_weight: float,
        frames_per_window: int = 3,
        fallback_to_transcript: bool = True,
    ):
        if not 0 <= transcript_weight <= 1:
            raise ValueError("transcript_weight must be between zero and one")
        if frames_per_window < 1:
            raise ValueError("frames_per_window must be positive")
        self.transcript_localizer = transcript_localizer
        self.frame_extractor = frame_extractor
        self.frame_scorer = frame_scorer
        self.transcript_weight = transcript_weight
        self.frames_per_window = frames_per_window
        self.fallback_to_transcript = fallback_to_transcript
        self.model_name = (
            f"multimodal-window-t{transcript_weight:g}-"
            f"v{1-transcript_weight:g}:{frame_scorer.model_name}"
        )

    def localize(self, request: LocalizationRequest) -> TemporalSegment:
        return self.localize_with_details(request).segment

    def localize_with_details(
        self,
        request: LocalizationRequest,
    ) -> MultimodalLocalizationResult:
        candidates = self.transcript_localizer.rank_candidates(request)
        try:
            timestamps_by_candidate = tuple(
                self._sample_timestamps(candidate.start_seconds, candidate.end_seconds)
                for candidate in candidates
            )
            unique_timestamps = tuple(
                sorted(
                    {
                        timestamp
                        for timestamps in timestamps_by_candidate
                        for timestamp in timestamps
                    }
                )
            )
            frames = self.frame_extractor.extract(request.video_id, unique_timestamps)
            visual_by_timestamp = dict(
                zip(
                    unique_timestamps,
                    self.frame_scorer.score(request.question, frames),
                    strict=True,
                )
            )
        except VideoUnavailableError:
            if not self.fallback_to_transcript:
                raise
            best = candidates[0]
            return self._result(request, best, None, best.transcript_score, False)

        scored = []
        for candidate, timestamps in zip(candidates, timestamps_by_candidate, strict=True):
            visual_score = float(np.mean([visual_by_timestamp[value] for value in timestamps]))
            fusion_score = (
                self.transcript_weight * candidate.transcript_score
                + (1.0 - self.transcript_weight) * visual_score
            )
            scored.append((fusion_score, visual_score, candidate))
        fusion_score, visual_score, best = max(
            scored,
            key=lambda item: (item[0], item[2].transcript_score),
        )
        return self._result(request, best, visual_score, fusion_score, True)

    def _sample_timestamps(self, start: float, end: float) -> tuple[float, ...]:
        boundaries = np.linspace(start, end, self.frames_per_window + 2)
        return tuple(float(value) for value in boundaries[1:-1])

    def _result(
        self,
        request: LocalizationRequest,
        candidate: TranscriptWindowCandidate,
        visual_score: float | None,
        fusion_score: float,
        used_visual: bool,
    ) -> MultimodalLocalizationResult:
        return MultimodalLocalizationResult(
            segment=TemporalSegment(
                video_id=request.video_id,
                start_seconds=candidate.start_seconds,
                end_seconds=candidate.end_seconds,
                localization_score=float(np.clip(fusion_score, 0.0, 1.0)),
                model_name=self.model_name,
            ),
            used_visual_evidence=used_visual,
            transcript_score=candidate.transcript_score,
            visual_score=visual_score,
            fusion_score=fusion_score,
        )
