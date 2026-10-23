"""Structural interfaces between use cases and external adapters.

Protocols keep the service layer independent from model providers, semantic retrieval, YouTube,
SentenceTransformers, and Flask while avoiding inheritance-only abstractions.
"""

from __future__ import annotations

from typing import Any, Protocol


class ResponseGeneratorPort(Protocol):
    def generate(self, query: str) -> dict[str, Any]: ...


class RetrieverPort(Protocol):
    def multi_query_search(
        self,
        queries: list[str],
        weights: list[float] | None = None,
    ) -> list[dict[str, Any]]: ...

    def search_with_context(
        self,
        query: str,
        body_part: str | None = None,
        condition: str | None = None,
    ) -> list[dict[str, Any]]: ...

    def format_results_for_context(self, results: list[dict[str, Any]]) -> str: ...


class LanguageModelPort(Protocol):
    def generate_multimodal_response(self, query: str, context: str) -> str: ...


class ImageRecognizerPort(Protocol):
    def recognize_from_bytes(self, image_bytes: bytes) -> dict[str, Any]: ...


class TranscriptionPort(Protocol):
    MODEL: str

    def transcribe(self, audio_bytes: bytes, filename: str) -> str: ...


class MedicalDatabasePort(Protocol):
    procedures: list[dict[str, Any]]
