"""FastAPI application factory for Medix."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.api.routes import router
from backend.config import AppSettings, ConfigurationError, ProjectPaths
from backend.container import ServiceContainer, ServiceFactory
from backend.errors import ResourceNotFoundError, ServiceUnavailableError, ValidationError

LOGGER = logging.getLogger(__name__)

if TYPE_CHECKING:
    from pathlib import Path


class MedixApplication:
    """Construct the FastAPI transport around injected Medix services."""

    def __init__(
        self,
        settings: AppSettings,
        paths: ProjectPaths,
        services: ServiceContainer,
    ):
        self.settings = settings
        self.paths = paths
        self.services = services

    def create(self) -> FastAPI:
        app = FastAPI(
            title="Medix Medical Procedure QA API",
            description=(
                "Research API for transcript-grounded medical-procedure question answering. "
                "This software is not a medical device."
            ),
            version="3.0.0",
        )
        app.state.medix_services = self.services
        app.state.max_content_length = self.settings.web.max_content_length
        app.state.research_artifact_root = self.paths.research_artifacts

        app.include_router(router)
        self._register_error_handlers(app)
        self._register_size_limit(app)

        @app.get("/", include_in_schema=False)
        async def index() -> dict[str, str]:
            return {
                "service": "Medix canonical evidence-grounded API",
                "query_endpoint": "/api/query",
                "documentation": "/docs",
            }

        return app

    def _register_size_limit(self, app: FastAPI) -> None:
        maximum = self.settings.web.max_content_length

        @app.middleware("http")
        async def reject_oversized_request(request: Request, call_next):
            content_length = request.headers.get("content-length")
            if content_length and content_length.isdecimal() and int(content_length) > maximum:
                return JSONResponse(
                    status_code=413,
                    content={"error": "Request body is too large"},
                )
            return await call_next(request)

    @staticmethod
    def _register_error_handlers(app: FastAPI) -> None:
        @app.exception_handler(ValidationError)
        async def validation_error(
            _request: Request,
            error: ValidationError,
        ) -> JSONResponse:
            status_code = 413 if str(error) == "Request body is too large" else 400
            return JSONResponse(status_code=status_code, content={"error": str(error)})

        @app.exception_handler(ResourceNotFoundError)
        async def not_found(
            _request: Request,
            error: ResourceNotFoundError,
        ) -> JSONResponse:
            return JSONResponse(status_code=404, content={"error": str(error)})

        @app.exception_handler(ServiceUnavailableError)
        async def unavailable(
            _request: Request,
            error: ServiceUnavailableError,
        ) -> JSONResponse:
            return JSONResponse(status_code=503, content={"error": str(error)})

        @app.exception_handler(RequestValidationError)
        async def request_validation_error(
            _request: Request,
            error: RequestValidationError,
        ) -> JSONResponse:
            first_error = error.errors()[0] if error.errors() else {}
            message = str(first_error.get("msg", "Invalid request"))
            return JSONResponse(status_code=422, content={"error": message})

        @app.exception_handler(StarletteHTTPException)
        async def http_error(
            _request: Request,
            error: StarletteHTTPException,
        ) -> JSONResponse:
            return JSONResponse(
                status_code=error.status_code,
                content={"error": str(error.detail)},
            )

        @app.exception_handler(Exception)
        async def unexpected_error(_request: Request, error: Exception) -> JSONResponse:
            LOGGER.exception("Unhandled API error", exc_info=error)
            return JSONResponse(
                status_code=500,
                content={"error": "An internal error occurred."},
            )


def create_app(
    *,
    settings: AppSettings | None = None,
    services: ServiceContainer | None = None,
    config_path: Path | None = None,
) -> FastAPI:
    """Create a testable ASGI application without import-time termination."""
    paths = ProjectPaths.discover()
    startup_error = None
    if settings is None:
        try:
            settings = AppSettings.load(config_path or paths.config)
        except ConfigurationError as exc:
            LOGGER.error("Configuration error: %s", exc)
            startup_error = str(exc)
            settings = AppSettings.safe_defaults()

    if services is None:
        services = (
            ServiceContainer.unavailable(settings, startup_error)
            if startup_error
            else ServiceFactory(settings, paths).build()
        )

    return MedixApplication(settings, paths, services).create()
