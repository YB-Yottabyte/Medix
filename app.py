"""Compatibility entrypoint for running the Flask backend from the repo root."""

from backend.app import app, main

__all__ = ["app", "main"]


if __name__ == "__main__":
    main()
