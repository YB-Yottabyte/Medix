"""ASU RC Voyager gateway: no automatic retries or cross-provider fallback."""

from __future__ import annotations

import os
from functools import lru_cache

import requests

from backend.adapters.structured_vision import StructuredVisionModel
from backend.errors import ServiceUnavailableError
from backend.performance import timed

VOYAGER_BASE_URL = "https://openai.rc.asu.edu/v1"
VOYAGER_MODEL = "qwen35-27b"


class VoyagerClient:
    def __init__(self, token: str, *, session=requests, max_tokens: int = 2048):
        if not token.strip():
            raise ValueError("ASU_RC_API_KEY is required for Voyager")
        self._token = token
        self._session = session
        self.max_tokens = max_tokens

    @timed("model.voyager")
    def chat(self, model: str, messages: list[dict]) -> str:
        try:
            response = self._session.post(
                VOYAGER_BASE_URL + "/chat/completions",
                headers={"Authorization": f"Bearer {self._token}"},
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "temperature": 0,
                    "max_tokens": self.max_tokens,
                    "response_format": {"type": "json_object"},
                    "chat_template_kwargs": {"enable_thinking": False},
                },
                timeout=120,
                allow_redirects=False,
            )
        except requests.RequestException:
            raise ServiceUnavailableError(
                "Voyager connection failed; check network or ASU VPN"
            ) from None
        if response.status_code in (401, 403):
            raise ServiceUnavailableError("Voyager API key or model access was rejected")
        if response.status_code == 429:
            raise ServiceUnavailableError("Voyager is temporarily rate limited; try again later")
        if response.status_code != 200:
            raise ServiceUnavailableError(f"Voyager request failed (HTTP {response.status_code})")
        try:
            choice = response.json()["choices"][0]
            content = choice["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise ServiceUnavailableError("Voyager returned an incomplete model response") from None
        finish_reason = choice.get("finish_reason")
        if finish_reason == "length":
            raise ServiceUnavailableError(
                "Voyager reached the output token limit before completing its response"
            )
        if finish_reason != "stop":
            raise ServiceUnavailableError("Voyager did not complete a normal text response")
        if not isinstance(content, str) or not content.strip():
            raise ServiceUnavailableError("Voyager completed without returning answer content")
        return content


@lru_cache(maxsize=1)
def get_voyager_client() -> VoyagerClient:
    return VoyagerClient(os.environ.get("ASU_RC_API_KEY", ""))


def voyager_model() -> str:
    return os.environ.get("ASU_RC_MODEL", VOYAGER_MODEL)


class VoyagerVisionModel(StructuredVisionModel):
    def __init__(self, client: VoyagerClient, model: str = VOYAGER_MODEL):
        super().__init__(client, model, require_provider_alias=False)


class VoyagerStructuredAnswerModel:
    def __init__(self, client: VoyagerClient, model: str = VOYAGER_MODEL):
        if not model.strip():
            raise ValueError("An explicit Voyager model ID is required")
        self.client = client
        self.model = model

    @property
    def model_name(self) -> str:
        return f"voyager-structured:{self.model}"

    @timed("generation.structured")
    def generate(self, request):
        from backend.generation.structured import (
            decode_structured_answer,
            structured_answer_repair_prompt,
            structured_answer_system_prompt,
            structured_answer_user_prompt,
        )

        messages = [
            {"role": "system", "content": structured_answer_system_prompt()},
            {"role": "user", "content": structured_answer_user_prompt(request)},
        ]
        content = self.client.chat(self.model, messages)
        try:
            return decode_structured_answer(content)
        except (ValueError, TypeError) as error:
            # One formatting correction only; transport failures and domain-level
            # citation/grounding failures are never retried or bypassed.
            messages.extend(
                [
                    {"role": "assistant", "content": content},
                    {"role": "user", "content": structured_answer_repair_prompt(error)},
                ]
            )
            return decode_structured_answer(self.client.chat(self.model, messages))
