"""Question-conditioned localization over timestamped transcript windows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import numpy as np

from backend.domain import LocalizationRequest, TemporalSegment
from backend.transcripts import TranscriptUnavailableError

if TYPE_CHECKING:
    from backend.domain import TranscriptCue
    from backend.transcripts import TranscriptRepository


class TextEncoder(Protocol):
    def encode(self, sentences: list[str], **kwargs: object) -> np.ndarray: ...


@dataclass(frozen=True)
class TranscriptWindowCandidate:
    start_seconds: float
    end_seconds: float
    text: str
    transcript_score: float


class TranscriptWindowLocalizer:
    """Select the transcript window most similar to the user's question."""

    def __init__(
        self,
        *,
        repository: TranscriptRepository,
        encoder: TextEncoder,
        window_seconds: float,
        stride_seconds: float,
        embedding_model_name: str,
        batch_size: int = 64,
    ):
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        if stride_seconds <= 0:
            raise ValueError("stride_seconds must be positive")
        self.repository = repository
        self.encoder = encoder
        self.window_seconds = window_seconds
        self.stride_seconds = stride_seconds
        self.batch_size = batch_size
        self.model_name = (
            f"transcript-window-{window_seconds:g}s-"
            f"stride-{stride_seconds:g}s:{embedding_model_name}"
        )
        self._window_cache: dict[
            tuple[str, float],
            tuple[tuple[TranscriptWindowCandidate, ...], np.ndarray],
        ] = {}

    def localize(self, request: LocalizationRequest) -> TemporalSegment:
        [best, *_] = self.rank_candidates(request)
        return TemporalSegment(
            video_id=request.video_id,
            start_seconds=best.start_seconds,
            end_seconds=best.end_seconds,
            localization_score=best.transcript_score,
            model_name=self.model_name,
        )

    def rank_candidates(
        self,
        request: LocalizationRequest,
        *,
        limit: int | None = None,
    ) -> tuple[TranscriptWindowCandidate, ...]:
        """Rank transcript windows without exposing gold answer boundaries."""
        if limit is not None and limit < 1:
            raise ValueError("limit must be positive")
        windows, embeddings = self._video_windows(request)
        encoded_question = self.encoder.encode(
            [request.question],
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        question_embedding = self._normalize_rows(np.asarray(encoded_question, dtype=np.float32))[0]
        scores = embeddings @ question_embedding
        ranked_indices = np.argsort(scores)[::-1]
        if limit is not None:
            ranked_indices = ranked_indices[:limit]
        return tuple(
            TranscriptWindowCandidate(
                start_seconds=windows[int(index)].start_seconds,
                end_seconds=windows[int(index)].end_seconds,
                text=windows[int(index)].text,
                transcript_score=float(np.clip((float(scores[int(index)]) + 1.0) / 2.0, 0.0, 1.0)),
            )
            for index in ranked_indices
        )

    def _video_windows(
        self,
        request: LocalizationRequest,
    ) -> tuple[tuple[TranscriptWindowCandidate, ...], np.ndarray]:
        cache_key = (request.video_id, request.duration_seconds)
        cached = self._window_cache.get(cache_key)
        if cached is not None:
            return cached

        cues = self.repository.load(request.video_id)
        windows = self._build_windows(cues, request.duration_seconds)
        if not windows:
            raise TranscriptUnavailableError(
                f"No non-empty transcript windows for {request.video_id}"
            )
        encoded = self.encoder.encode(
            [window.text for window in windows],
            batch_size=self.batch_size,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        cached = (
            windows,
            self._normalize_rows(np.asarray(encoded, dtype=np.float32)),
        )
        self._window_cache[cache_key] = cached
        return cached

    def _build_windows(
        self,
        cues: tuple[TranscriptCue, ...],
        video_duration: float,
    ) -> tuple[TranscriptWindowCandidate, ...]:
        window_duration = min(self.window_seconds, video_duration)
        last_start = max(video_duration - window_duration, 0.0)
        starts = list(np.arange(0.0, last_start + self.stride_seconds, self.stride_seconds))
        if not starts or starts[-1] < last_start:
            starts.append(last_start)
        starts = sorted({min(float(start), last_start) for start in starts})

        windows = []
        for start in starts:
            end = min(start + window_duration, video_duration)
            text = " ".join(
                cue.text for cue in cues if cue.end_seconds > start and cue.start_seconds < end
            ).strip()
            if text:
                windows.append(
                    TranscriptWindowCandidate(
                        start_seconds=start,
                        end_seconds=end,
                        text=text,
                        transcript_score=0.0,
                    )
                )
        return tuple(windows)

    @staticmethod
    def _normalize_rows(values: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(values, axis=1, keepdims=True)
        return values / np.maximum(norms, np.finfo(np.float32).eps)
