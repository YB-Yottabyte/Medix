"""Dependency container and production service composition."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.adapters.vision_context import OptionalVisionAdapter
    from backend.config import AppSettings, ProjectPaths
    from backend.services.grounded_qa import GroundedMedicalQAPipeline

LOGGER = logging.getLogger(__name__)


@dataclass
class ServiceContainer:
    """Runtime dependencies exposed to the HTTP application."""

    settings: AppSettings
    qa: GroundedMedicalQAPipeline | None
    startup_error: str | None = None
    vision: OptionalVisionAdapter | None = None

    @property
    def ready(self) -> bool:
        return self.settings.research.enabled and self.qa is not None and self.startup_error is None

    @classmethod
    def unavailable(cls, settings: AppSettings, reason: str) -> ServiceContainer:
        return cls(settings=settings, qa=None, startup_error=reason)


class ServiceFactory:
    """Build the production object graph in one explicit location."""

    def __init__(self, settings: AppSettings, paths: ProjectPaths):
        self.settings = settings
        self.paths = paths

    def build(self) -> ServiceContainer:
        if not self.settings.research.enabled:
            return ServiceContainer.unavailable(
                self.settings,
                "The canonical pipeline is disabled. Set research_pipeline.enabled to true.",
            )

        try:
            import os
            from pathlib import Path

            from backend.research_pipeline import ResearchPipelineFactory

            cache_dir = os.environ.get("MEDIX_FEATURE_CACHE")
            qa, _components = ResearchPipelineFactory(
                settings=self.settings.research,
                paths=self.paths,
                app_settings=self.settings,
                feature_cache_dir=Path(cache_dir) if cache_dir else None,
                live_transcript_retrieval=True,
                visual_candidate_limit=2,
            ).build()
            max_candidates = int(os.environ.get("MEDIX_MAX_EVIDENCE_CANDIDATES", "2"))
            if max_candidates not in (1, 2):
                return ServiceContainer.unavailable(
                    self.settings, "MEDIX_MAX_EVIDENCE_CANDIDATES must be 1 or 2"
                )
            qa.max_evidence_candidates = max_candidates

            from backend.adapters.vision_context import OptionalVisionAdapter

            vision = None
            provider = os.environ.get("MEDIX_VISION_PROVIDER", "voyager")
            if provider not in {"voyager", "disabled"}:
                return ServiceContainer.unavailable(
                    self.settings, "MEDIX_VISION_PROVIDER must be voyager or disabled"
                )
            if provider == "voyager":
                from backend.adapters.voyager import (
                    VoyagerVisionModel,
                    get_voyager_client,
                    voyager_model,
                )

                vision = OptionalVisionAdapter(
                    VoyagerVisionModel(get_voyager_client(), voyager_model())
                )
            return ServiceContainer(settings=self.settings, qa=qa, vision=vision)
        except Exception as exc:
            LOGGER.exception("Canonical Medix pipeline could not be initialized")
            return ServiceContainer.unavailable(self.settings, str(exc))
