"""Assemble predicted transcript, frame, and clip evidence into one bundle."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np

from backend.domain import (
    ClipEvidence,
    EvidenceBundle,
    FrameEvidence,
    TranscriptEvidence,
)
from backend.transcripts import TranscriptUnavailableError
from backend.video_processing import VideoUnavailableError

if TYPE_CHECKING:
    from backend.evidence.store import EvidenceArtifactStore
    from backend.transcripts import TranscriptRepository
    from backend.video_processing import ClipExtractor, FrameExtractor


class EvidenceUnavailableError(LookupError):
    """Raised when a complete grounded evidence bundle cannot be produced."""


@dataclass(frozen=True)
class EvidenceExtractionRequest:
    question: str
    video_id: str
    source_uri: str
    start_seconds: float
    end_seconds: float
    localization_model: str
    scores: dict[str, float | None] = field(default_factory=dict)
    provenance: dict[str, str | int | float | bool | None] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.question.strip() or not self.video_id.strip():
            raise ValueError("question and video_id must not be empty")
        if not self.source_uri.strip() or not self.localization_model.strip():
            raise ValueError("source_uri and localization_model must not be empty")
        if self.start_seconds < 0 or self.end_seconds <= self.start_seconds:
            raise ValueError("evidence extraction requires a valid interval")


class EvidenceExtractor:
    """Create bundles using only a model-predicted temporal interval."""

    def __init__(
        self,
        *,
        transcript_repository: TranscriptRepository,
        frame_extractor: FrameExtractor,
        clip_extractor: ClipExtractor,
        store: EvidenceArtifactStore,
        frames_per_bundle: int = 3,
    ):
        if frames_per_bundle < 1:
            raise ValueError("frames_per_bundle must be positive")
        self.transcript_repository = transcript_repository
        self.frame_extractor = frame_extractor
        self.clip_extractor = clip_extractor
        self.store = store
        self.frames_per_bundle = frames_per_bundle

    def extract(self, request: EvidenceExtractionRequest) -> EvidenceBundle:
        try:
            transcript = self._transcript(request)
            frames = self._frames(request)
            clip = self._clip(request)
        except (TranscriptUnavailableError, VideoUnavailableError) as exc:
            raise EvidenceUnavailableError(str(exc)) from exc

        bundle = EvidenceBundle(
            bundle_id=self._bundle_id(request),
            question=request.question,
            video_id=request.video_id,
            source_uri=request.source_uri,
            predicted_start_seconds=request.start_seconds,
            predicted_end_seconds=request.end_seconds,
            localization_model=request.localization_model,
            transcript=transcript,
            frames=frames,
            clip=clip,
            scores=dict(request.scores),
            provenance={
                **request.provenance,
                "contains_gold_timestamps": False,
                "artifact_schema_version": 1,
            },
        )
        self.store.write_manifest(bundle.bundle_id, bundle.as_dict())
        return bundle

    def _transcript(
        self,
        request: EvidenceExtractionRequest,
    ) -> tuple[TranscriptEvidence, ...]:
        cues = self.transcript_repository.load(request.video_id)
        selected = tuple(
            TranscriptEvidence(
                start_seconds=cue.start_seconds,
                end_seconds=cue.end_seconds,
                text=cue.text,
            )
            for cue in cues
            if cue.end_seconds > request.start_seconds and cue.start_seconds < request.end_seconds
        )
        if not selected:
            raise EvidenceUnavailableError("No transcript overlaps the predicted interval")
        return selected

    def _frames(
        self,
        request: EvidenceExtractionRequest,
    ) -> tuple[FrameEvidence, ...]:
        timestamps = tuple(
            float(value)
            for value in np.linspace(
                request.start_seconds,
                request.end_seconds,
                self.frames_per_bundle + 2,
            )[1:-1]
        )
        samples = self.frame_extractor.extract(request.video_id, timestamps)
        evidence = []
        for sample in samples:
            path = self.store.frame_path(sample.video_id, sample.timestamp_seconds)
            digest = self.store.write_bytes(path, sample.jpeg_bytes)
            evidence.append(
                FrameEvidence(
                    timestamp_seconds=sample.timestamp_seconds,
                    artifact_path=self.store.relative_path(path),
                    sha256=digest,
                )
            )
        return tuple(evidence)

    def _clip(self, request: EvidenceExtractionRequest) -> ClipEvidence:
        path = self.store.clip_path(
            request.video_id,
            request.start_seconds,
            request.end_seconds,
        )
        artifact = self.clip_extractor.extract(
            request.video_id,
            request.start_seconds,
            request.end_seconds,
            path,
        )
        return ClipEvidence(
            start_seconds=request.start_seconds,
            end_seconds=request.end_seconds,
            duration_seconds=artifact.duration_seconds,
            artifact_path=self.store.relative_path(artifact.path),
            sha256=self.store.sha256(artifact.path),
        )

    @staticmethod
    def _bundle_id(request: EvidenceExtractionRequest) -> str:
        identity = "\n".join(
            (
                request.video_id,
                f"{request.start_seconds:.3f}",
                f"{request.end_seconds:.3f}",
                request.question.strip(),
                request.localization_model,
                json.dumps(request.scores, sort_keys=True),
                json.dumps(request.provenance, sort_keys=True),
            )
        )
        return hashlib.sha256(identity.encode()).hexdigest()[:24]
