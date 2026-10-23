"""Local Ollama baseline for structured evidence-constrained answer generation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import requests

from backend.generation.structured import (
    STRUCTURED_CONTRACT_VERSION,
    decode_structured_answer,
    structured_answer_json_schema,
    structured_answer_repair_prompt,
    structured_answer_system_prompt,
    structured_answer_user_prompt,
)
from backend.performance import timed

if TYPE_CHECKING:
    from backend.generation import EvidenceGenerationRequest, StructuredAnswerDraft


class OllamaStructuredEvidenceAnswerModel:
    """Request the shared strict JSON contract from a local Ollama server."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        session: Any = requests,
        timeout_seconds: float = 180,
        max_output_tokens: int = 512,
    ):
        if not base_url.strip():
            raise ValueError("base_url must not be empty")
        if not model.strip():
            raise ValueError("model must not be empty")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if max_output_tokens < 1:
            raise ValueError("max_output_tokens must be positive")
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._session = session
        self._timeout_seconds = timeout_seconds
        self._max_output_tokens = max_output_tokens

    @property
    def model_name(self) -> str:
        return f"ollama-{STRUCTURED_CONTRACT_VERSION}:{self._model}"

    @timed("generation.local_structured")
    def generate(self, request: EvidenceGenerationRequest) -> StructuredAnswerDraft:
        messages = [
            {"role": "system", "content": structured_answer_system_prompt()},
            {"role": "user", "content": structured_answer_user_prompt(request)},
        ]
        content = self._chat(messages)
        try:
            return decode_structured_answer(content)
        except (TypeError, ValueError) as exc:
            repaired_content = self._chat(
                [
                    *messages,
                    {"role": "assistant", "content": content[:4000]},
                    {"role": "user", "content": structured_answer_repair_prompt(exc)},
                ]
            )
            return decode_structured_answer(repaired_content)

    @timed("model.local_provider")
    def _chat(self, messages: list[dict[str, str]]) -> str:
        response = self._session.post(
            f"{self._base_url}/api/chat",
            json={
                "model": self._model,
                "stream": False,
                "think": False,
                "format": structured_answer_json_schema(),
                "options": {
                    "temperature": 0,
                    "num_predict": self._max_output_tokens,
                },
                "messages": messages,
            },
            timeout=self._timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise TypeError("Ollama returned a non-object response")
        message = payload.get("message")
        if not isinstance(message, dict):
            raise TypeError("Ollama response is missing message")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Ollama returned an empty structured response")
        return content
