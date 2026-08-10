"""Public FastAPI ASGI entrypoint."""

import uvicorn

from backend.application import create_app

app = create_app()


def main() -> None:
    """Run the local Uvicorn development server."""
    services = app.state.medix_services
    settings = services.settings.web
    uvicorn.run(
        "backend.app:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


__all__ = ["app", "create_app", "main"]


if __name__ == "__main__":
    main()
