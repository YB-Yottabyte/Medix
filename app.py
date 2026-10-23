"""Compatibility entrypoint for running Medix from the project root."""

from backend.app import app, create_app, main

__all__ = ["app", "create_app", "main"]


if __name__ == "__main__":
    main()
