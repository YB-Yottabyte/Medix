"""Typed application configuration and project paths."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


class ConfigurationError(ValueError):
    """Raised when Medix configuration is missing or invalid."""


@dataclass(frozen=True)
class ProjectPaths:
    """Filesystem locations used by the backend."""

    root: Path
    backend: Path
    config: Path
    retrieval_cache: Path
    transcript_cache: Path
    video_catalog: Path
    video_cache: Path
    research_artifacts: Path
    supported_video_collection: Path
    ccal_checkpoint: Path

    @classmethod
    def discover(cls) -> ProjectPaths:
        backend = Path(__file__).resolve().parent
        root = backend.parent
        return cls(
            root=root,
            backend=backend,
            config=root / "config.yaml",
            retrieval_cache=root / "data" / "cache_medvidqa_verified",
            transcript_cache=root / "data" / "transcript_cache",
            video_catalog=root / "data" / "medvidqa_video_catalog.json",
            video_cache=root / "data" / "video_cache",
            research_artifacts=root / "data" / "research_runtime",
            supported_video_collection=root / "data" / "supported_video_collection.json",
            ccal_checkpoint=root / "data" / "models" / "ccal",
        )


@dataclass(frozen=True)
class WebSettings:
    host: str
    port: int
    debug: bool
    max_content_length: int = 10 * 1024 * 1024


@dataclass(frozen=True)
class DatabaseSettings:
    embedding_model: str
    top_k: int
    similarity_threshold: float
    lexical_weight: float
    qdrant_url: str
    qdrant_collection: str


@dataclass(frozen=True)
class AISettings:
    provider: str
    providers: dict[str, dict[str, Any]]

    @property
    def active(self) -> dict[str, Any]:
        return self.providers[self.provider]


@dataclass(frozen=True)
class VisionSettings:
    model: str
    max_image_size: int
    top_k_matches: int


@dataclass(frozen=True)
class SafetySettings:
    """Policy thresholds for deciding when the pipeline may answer."""

    answer_confidence_threshold: float


@dataclass(frozen=True)
class ResearchPipelineSettings:
    """Feature-gated settings for the canonical evidence-grounded pipeline."""

    enabled: bool = False
    top_k: int = 5
    retrieval_weight: float = 0.0
    lexical_weight: float = 0.15
    transcript_weight: float = 0.5
    window_seconds: float = 90.0
    stride_seconds: float = 45.0
    frames_per_window: int = 3
    frames_per_bundle: int = 3
    answer_model: str = "structured_groq"
    localizer_strategy: str = "multimodal_window"
    supported_collection_only: bool = False
    ccal_cycle_weight: float = 0.25


@dataclass(frozen=True)
class AppSettings:
    """Validated runtime settings with a legacy mapping for model adapters."""

    web: WebSettings
    database: DatabaseSettings
    ai: AISettings
    vision: VisionSettings
    safety: SafetySettings
    research: ResearchPipelineSettings

    @classmethod
    def from_mapping(cls, values: dict[str, Any]) -> AppSettings:
        try:
            web = values["web"]
            database = values["database"]
            ai = values["ai"]
            provider = str(ai["provider"]).lower()
            providers = {
                name: dict(provider_config)
                for name, provider_config in ai.items()
                if name != "provider" and isinstance(provider_config, dict)
            }
            if provider not in providers:
                raise ConfigurationError(f"Missing configuration for AI provider '{provider}'.")

            settings = cls(
                web=WebSettings(
                    host=str(web.get("host", "127.0.0.1")),
                    port=int(web.get("port", 5001)),
                    debug=bool(web.get("debug", False)),
                    max_content_length=int(web.get("max_content_length", 10 * 1024 * 1024)),
                ),
                database=DatabaseSettings(
                    embedding_model=str(database["embedding_model"]),
                    top_k=int(database.get("top_k", 5)),
                    similarity_threshold=float(database.get("similarity_threshold", 0.25)),
                    lexical_weight=float(database.get("lexical_weight", 0.15)),
                    qdrant_url=str(database.get("qdrant_url", "http://localhost:6333")),
                    qdrant_collection=str(
                        database.get("qdrant_collection", "medical_video_transcripts")
                    ),
                ),
                ai=AISettings(provider=provider, providers=providers),
                vision=VisionSettings(
                    model=str(values.get("vision", {}).get("model", "qwen/qwen3.6-27b")),
                    max_image_size=int(
                        values.get("vision", {}).get("max_image_size", 10 * 1024 * 1024)
                    ),
                    top_k_matches=int(values.get("vision", {}).get("top_k_matches", 5)),
                ),
                safety=SafetySettings(
                    answer_confidence_threshold=float(
                        values.get("safety", {}).get("answer_confidence_threshold", 0.35)
                    ),
                ),
                research=ResearchPipelineSettings(
                    enabled=bool(values.get("research_pipeline", {}).get("enabled", False)),
                    top_k=int(values.get("research_pipeline", {}).get("top_k", 5)),
                    retrieval_weight=float(
                        values.get("research_pipeline", {}).get("retrieval_weight", 0.0)
                    ),
                    lexical_weight=float(
                        values.get("research_pipeline", {}).get("lexical_weight", 0.15)
                    ),
                    transcript_weight=float(
                        values.get("research_pipeline", {}).get("transcript_weight", 0.5)
                    ),
                    window_seconds=float(
                        values.get("research_pipeline", {}).get("window_seconds", 90)
                    ),
                    stride_seconds=float(
                        values.get("research_pipeline", {}).get("stride_seconds", 45)
                    ),
                    frames_per_window=int(
                        values.get("research_pipeline", {}).get("frames_per_window", 3)
                    ),
                    frames_per_bundle=int(
                        values.get("research_pipeline", {}).get("frames_per_bundle", 3)
                    ),
                    answer_model=str(
                        values.get("research_pipeline", {}).get("answer_model", "structured_groq")
                    ).lower(),
                    localizer_strategy=str(
                        values.get("research_pipeline", {}).get(
                            "localizer_strategy", "multimodal_window"
                        )
                    ).lower(),
                    supported_collection_only=bool(
                        values.get("research_pipeline", {}).get("supported_collection_only", False)
                    ),
                    ccal_cycle_weight=float(
                        values.get("research_pipeline", {}).get("ccal_cycle_weight", 0.25)
                    ),
                ),
            )
        except (KeyError, TypeError, ValueError) as exc:
            if isinstance(exc, ConfigurationError):
                raise
            raise ConfigurationError(f"Invalid Medix configuration: {exc}") from exc

        settings._validate()
        return settings

    @classmethod
    def load(cls, path: Path) -> AppSettings:
        if not path.is_file():
            raise ConfigurationError(
                f"Configuration file not found: {path}. Copy the example from README.md."
            )
        with path.open(encoding="utf-8") as config_file:
            values = yaml.safe_load(config_file) or {}
        if not isinstance(values, dict):
            raise ConfigurationError("The configuration root must be a mapping.")
        return cls.from_mapping(values)

    @classmethod
    def safe_defaults(cls) -> AppSettings:
        """Minimal settings used only to expose diagnostics after startup failure."""
        return cls.from_mapping(
            {
                "web": {"host": "127.0.0.1", "port": 5001, "debug": False},
                "database": {
                    "embedding_model": "all-MiniLM-L6-v2",
                    "top_k": 5,
                    "similarity_threshold": 0.25,
                },
                "ai": {
                    "provider": "groq",
                    "groq": {
                        "api_key": "",
                        "model": "openai/gpt-oss-20b",
                        "temperature": 0.3,
                        "max_tokens": 800,
                    },
                },
                "vision": {"model": "qwen/qwen3.6-27b"},
            }
        )

    def _validate(self) -> None:
        if not 1 <= self.web.port <= 65535:
            raise ConfigurationError("web.port must be between 1 and 65535.")
        if self.database.top_k < 1:
            raise ConfigurationError("database.top_k must be positive.")
        if not 0 <= self.database.similarity_threshold <= 1:
            raise ConfigurationError("database.similarity_threshold must be between 0 and 1.")
        if not 0 <= self.database.lexical_weight <= 1:
            raise ConfigurationError("database.lexical_weight must be between 0 and 1.")
        if not self.vision.model.strip():
            raise ConfigurationError("vision.model must not be empty.")
        if self.vision.max_image_size < 1:
            raise ConfigurationError("vision.max_image_size must be positive.")
        if not 0 <= self.safety.answer_confidence_threshold <= 1:
            raise ConfigurationError("safety.answer_confidence_threshold must be between 0 and 1.")
        if self.research.top_k < 1:
            raise ConfigurationError("research_pipeline.top_k must be positive.")
        for name, value in (
            ("retrieval_weight", self.research.retrieval_weight),
            ("lexical_weight", self.research.lexical_weight),
            ("transcript_weight", self.research.transcript_weight),
        ):
            if not 0 <= value <= 1:
                raise ConfigurationError(f"research_pipeline.{name} must be between 0 and 1.")
        if self.research.window_seconds <= 0 or self.research.stride_seconds <= 0:
            raise ConfigurationError(
                "research_pipeline window and stride seconds must be positive."
            )
        if self.research.frames_per_window < 1 or self.research.frames_per_bundle < 1:
            raise ConfigurationError("research_pipeline frame counts must be positive.")
        if self.research.answer_model not in {
            "extractive",
            "structured_groq",
            "structured_ollama",
        }:
            raise ConfigurationError(
                "research_pipeline.answer_model must be extractive, structured_groq, "
                "or structured_ollama."
            )
        if self.research.localizer_strategy not in {
            "transcript_window",
            "multimodal_window",
            "ccal",
        }:
            raise ConfigurationError(
                "research_pipeline.localizer_strategy must be transcript_window, "
                "multimodal_window, or ccal."
            )
        if not 0 <= self.research.ccal_cycle_weight <= 1:
            raise ConfigurationError("research_pipeline.ccal_cycle_weight must be between 0 and 1.")

    def as_legacy_dict(self) -> dict[str, Any]:
        """Return the mapping expected by the existing model and retriever adapters."""
        return {
            "web": {
                "host": self.web.host,
                "port": self.web.port,
                "debug": self.web.debug,
                "max_content_length": self.web.max_content_length,
            },
            "database": {
                "embedding_model": self.database.embedding_model,
                "top_k": self.database.top_k,
                "similarity_threshold": self.database.similarity_threshold,
                "lexical_weight": self.database.lexical_weight,
                "qdrant_url": self.database.qdrant_url,
                "qdrant_collection": self.database.qdrant_collection,
            },
            "ai": {"provider": self.ai.provider, **self.ai.providers},
            "vision": {
                "model": self.vision.model,
                "max_image_size": self.vision.max_image_size,
                "top_k_matches": self.vision.top_k_matches,
            },
            "safety": {
                "answer_confidence_threshold": self.safety.answer_confidence_threshold,
            },
            "research_pipeline": {
                "enabled": self.research.enabled,
                "top_k": self.research.top_k,
                "retrieval_weight": self.research.retrieval_weight,
                "lexical_weight": self.research.lexical_weight,
                "transcript_weight": self.research.transcript_weight,
                "window_seconds": self.research.window_seconds,
                "stride_seconds": self.research.stride_seconds,
                "frames_per_window": self.research.frames_per_window,
                "frames_per_bundle": self.research.frames_per_bundle,
                "answer_model": self.research.answer_model,
                "localizer_strategy": self.research.localizer_strategy,
                "supported_collection_only": self.research.supported_collection_only,
                "ccal_cycle_weight": self.research.ccal_cycle_weight,
            },
        }
