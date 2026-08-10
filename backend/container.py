"""Dependency container and production service composition."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.config import AppSettings, ProjectPaths
    from backend.services.grounded_qa import GroundedMedicalQAPipeline

LOGGER = logging.getLogger(__name__)


@dataclass
class ServiceContainer:
    """Runtime dependencies exposed to the HTTP application."""

    settings: AppSettings
    qa: GroundedMedicalQAPipeline | None
    startup_error: str | None = None

    @property
    def ready(self) -> bool:
        return (
            self.settings.research.enabled
            and self.qa is not None
            and self.startup_error is None
        )

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
            from backend.research_pipeline import ResearchPipelineFactory

            qa, _components = ResearchPipelineFactory(
                settings=self.settings.research,
                paths=self.paths,
                app_settings=self.settings,
            ).build()
            return ServiceContainer(
                settings=self.settings,
                qa=qa,
            )
        except Exception as exc:
            LOGGER.exception("Canonical Medix pipeline could not be initialized")
            return ServiceContainer.unavailable(self.settings, str(exc))
