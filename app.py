"""Compatibility entrypoint for running the FastAPI backend from the repo root."""

from backend.app import app, create_app, main

__all__ = ["app", "create_app", "main"]


if __name__ == "__main__":
    main()
