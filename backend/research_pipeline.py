"""Canonical composition root for the Medix research pipeline."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.adapters.grounded_generation import (
    OllamaStructuredEvidenceAnswerModel,
)
from backend.evidence import EvidenceArtifactStore, EvidenceExtractor
from backend.generation import (
    EvidenceGroundedAnswerGenerator,
    ExtractiveEvidenceAnswerModel,
)
from backend.services.end_to_end import EndToEndMedicalPipeline
from backend.services.grounded_qa import GroundedMedicalQAPipeline
from backend.temporal_localization import (
    CCALSpanLocalizer,
    MultimodalWindowLocalizer,
    TemporalLocalizer,
    TranscriptWindowLocalizer,
    TransformersCCALSpanPredictor,
)
from backend.transcripts import CachedTranscriptRepository
from backend.video_processing import (
    FFmpegClipExtractor,
    FFmpegFrameExtractor,
    LocalVideoRepository,
    OnDemandVideoRepository,
)
from backend.video_retrieval import (
    SemanticVideoRetriever,
    VideoCatalog,
    load_video_documents,
)

if TYPE_CHECKING:
    from pathlib import Path

    from backend.config import AppSettings, ProjectPaths, ResearchPipelineSettings

TEXT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
TEXT_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
VISUAL_MODEL = "openai/clip-vit-base-patch32"
VISUAL_REVISION = "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"


@dataclass(frozen=True)
class ResearchPipelineComponents:
    """The shared pipeline plus resources needed by evaluation and HTTP delivery."""

    evidence_pipeline: EndToEndMedicalPipeline
    artifact_store: EvidenceArtifactStore
    retriever: SemanticVideoRetriever
    localizer: TemporalLocalizer
    catalog: VideoCatalog


class ResearchPipelineFactory:
    """Build one pinned object graph for benchmarks and the live v2 endpoint."""

    def __init__(
        self,
        *,
        settings: ResearchPipelineSettings,
        paths: ProjectPaths,
        app_settings: AppSettings | None = None,
        text_encoder: Any | None = None,
        feature_cache_dir: Path | None = None,
        visual_candidate_limit: int | None = None,
        visual_device: str | None = None,
        live_transcript_retrieval: bool = False,
    ):
        self.settings = settings
        self.paths = paths
        self.app_settings = app_settings
        self._text_encoder = text_encoder
        self.feature_cache_dir = feature_cache_dir
        self.visual_candidate_limit = visual_candidate_limit
        self.visual_device = visual_device
        self.live_transcript_retrieval = live_transcript_retrieval

    def build_components(self) -> ResearchPipelineComponents:
        from backend.performance import TimedTextEncoder

        text_encoder = TimedTextEncoder(self._text_encoder or self._load_text_encoder())
        if self.feature_cache_dir is not None:
            from importlib.metadata import version

            from backend.adapters.feature_cache import CachedTextEncoder

            namespace = f"{TEXT_MODEL}@{TEXT_REVISION}:{version('sentence-transformers')}:{version('transformers')}:{getattr(text_encoder, 'max_seq_length', None)}"
            text_encoder = CachedTextEncoder(
                text_encoder, self.feature_cache_dir / "text", namespace
            )
        documents = self._runtime_documents(load_video_documents(self.paths.video_catalog))
        catalog = VideoCatalog(documents)
        retriever = SemanticVideoRetriever.build(
            documents,
            text_encoder,
            lexical_weight=self.settings.lexical_weight,
            model_name=f"{TEXT_MODEL}@{TEXT_REVISION}:title-author",
        )
        transcripts = CachedTranscriptRepository(self.paths.transcript_cache)
        if self.live_transcript_retrieval:
            from backend.video_retrieval.transcript import TranscriptVideoRetriever

            retriever = TranscriptVideoRetriever(
                metadata=retriever,
                repository=transcripts,
                encoder=text_encoder,
            )
        transcript_localizer = TranscriptWindowLocalizer(
            repository=transcripts,
            encoder=text_encoder,
            window_seconds=self.settings.window_seconds,
            stride_seconds=self.settings.stride_seconds,
            embedding_model_name=f"{TEXT_MODEL}@{TEXT_REVISION}",
            complete_cue_boundaries=self.live_transcript_retrieval,
        )
        if self.settings.on_demand_video_cache:
            videos = OnDemandVideoRepository(
                self.paths.video_cache,
                source_index=self.paths.video_source_index,
                metadata_dir=self.paths.video_cache_metadata,
                max_cache_bytes=self.settings.video_cache_max_bytes,
                seed_dirs=self.paths.video_seed_caches,
            )
        else:
            videos = LocalVideoRepository(self.paths.video_cache)
        frames = FFmpegFrameExtractor(videos)
        localizer = self._localizer(
            transcripts=transcripts,
            transcript_localizer=transcript_localizer,
            frames=frames,
        )
        artifact_store = EvidenceArtifactStore(self.paths.research_artifacts)
        evidence_extractor = EvidenceExtractor(
            transcript_repository=transcripts,
            frame_extractor=frames,
            clip_extractor=FFmpegClipExtractor(videos),
            store=artifact_store,
            frames_per_bundle=self.settings.frames_per_bundle,
        )
        evidence_pipeline = EndToEndMedicalPipeline(
            video_retriever=retriever,
            video_catalog=catalog,
            temporal_localizer=localizer,
            evidence_extractor=evidence_extractor,
            top_k=self.settings.top_k,
            retrieval_weight=max(0.5, self.settings.retrieval_weight)
            if self.live_transcript_retrieval
            else self.settings.retrieval_weight,
        )
        return ResearchPipelineComponents(
            evidence_pipeline=evidence_pipeline,
            artifact_store=artifact_store,
            retriever=retriever,
            localizer=localizer,
            catalog=catalog,
        )

    def _localizer(
        self,
        *,
        transcripts: CachedTranscriptRepository,
        transcript_localizer: TranscriptWindowLocalizer,
        frames: FFmpegFrameExtractor,
    ) -> TemporalLocalizer:
        strategy = self.settings.localizer_strategy
        if strategy == "transcript_window":
            return transcript_localizer
        if strategy == "ccal":
            predictor = TransformersCCALSpanPredictor.from_checkpoint(
                self.paths.ccal_checkpoint,
                cycle_weight=self.settings.ccal_cycle_weight,
            )
            return CCALSpanLocalizer(
                repository=transcripts,
                predictor=predictor,
            )
        from backend.adapters.visual_similarity import ClipFrameScorer

        return MultimodalWindowLocalizer(
            transcript_localizer=transcript_localizer,
            frame_extractor=frames,
            frame_scorer=ClipFrameScorer(
                VISUAL_MODEL,
                revision=VISUAL_REVISION,
                device=self.visual_device,
                cache_dir=self.feature_cache_dir / "visual" if self.feature_cache_dir else None,
            ),
            candidate_limit=self.visual_candidate_limit,
            transcript_weight=max(0.8, self.settings.transcript_weight)
            if self.live_transcript_retrieval
            else self.settings.transcript_weight,
            frames_per_window=self.settings.frames_per_window,
        )

    def _runtime_documents(self, documents: tuple[Any, ...]) -> tuple[Any, ...]:
        if not self.settings.supported_collection_only:
            return documents
        path = self.paths.supported_video_collection
        if not path.is_file():
            raise FileNotFoundError(
                "Supported video collection is missing. Run "
                "`uv run python -m development.scripts.build_supported_collection`."
            )
        payload = json.loads(path.read_text(encoding="utf-8"))
        video_ids = payload.get("video_ids") if isinstance(payload, dict) else None
        if not isinstance(video_ids, list) or not video_ids:
            raise ValueError("supported video collection must contain video_ids")
        allowed = {str(video_id) for video_id in video_ids}
        filtered = tuple(document for document in documents if document.video_id in allowed)
        if len(filtered) != len(allowed):
            missing = allowed - {document.video_id for document in filtered}
            raise ValueError(
                "supported video collection contains unknown catalog IDs: "
                + ", ".join(sorted(missing))
            )
        return filtered

    def build(self) -> tuple[GroundedMedicalQAPipeline, ResearchPipelineComponents]:
        components = self.build_components()
        generator = EvidenceGroundedAnswerGenerator(self._answer_model())
        return (
            GroundedMedicalQAPipeline(
                evidence_pipeline=components.evidence_pipeline,
                answer_generator=generator,
            ),
            components,
        )

    def _answer_model(self) -> Any:
        if self.settings.answer_model == "extractive":
            return ExtractiveEvidenceAnswerModel(max_claims=3)
        if self.settings.answer_model == "structured_voyager":
            from backend.adapters.voyager import (
                VoyagerStructuredAnswerModel,
                get_voyager_client,
                voyager_model,
            )

            return VoyagerStructuredAnswerModel(get_voyager_client(), voyager_model())
        if self.settings.answer_model == "structured_sol":
            return OllamaStructuredEvidenceAnswerModel(
                base_url=os.environ.get("SOL_OLLAMA_BASE_URL", "http://localhost:11500")
                .rstrip("/")
                .removesuffix("/v1"),
                model=os.environ.get("SOL_CHAT_MODEL", "qwen3.6:27b"),
                max_output_tokens=512,
            )
        if self.app_settings is None:
            raise ValueError(f"{self.settings.answer_model} requires application AI settings")
        if self.settings.answer_model == "structured_ollama":
            config = self._provider_config("ollama")
            return OllamaStructuredEvidenceAnswerModel(
                base_url=str(config["base_url"]),
                model=str(config["model"]),
                max_output_tokens=int(config.get("max_tokens", 512)),
            )
        raise ValueError(f"Unsupported answer model: {self.settings.answer_model}")

    def _provider_config(self, provider: str) -> dict[str, Any]:
        assert self.app_settings is not None
        try:
            return self.app_settings.ai.providers[provider]
        except KeyError as exc:
            raise ValueError(
                f"{self.settings.answer_model} requires ai.{provider} configuration"
            ) from exc

    @staticmethod
    def _load_text_encoder() -> Any:
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer(TEXT_MODEL, revision=TEXT_REVISION)
