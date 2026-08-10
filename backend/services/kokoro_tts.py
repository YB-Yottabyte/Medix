"""Lazy, local Kokoro text-to-speech inference."""

from __future__ import annotations

import os
import threading
import wave
from functools import lru_cache
from io import BytesIO
from typing import TYPE_CHECKING, Any, Protocol

import numpy as np

if TYPE_CHECKING:
    from collections.abc import Iterable


class KokoroUnavailableError(RuntimeError):
    """Raised when local Kokoro inference cannot be initialized or completed."""


class KokoroPipeline(Protocol):
    """Narrow interface implemented by ``kokoro.KPipeline``."""

    def __call__(
        self,
        text: str,
        *,
        voice: str,
        speed: float,
    ) -> Iterable[tuple[str, str, Any]]: ...


class PipelineFactory(Protocol):
    """Factory shape used by ``KPipeline(lang_code=...)``."""

    def __call__(self, *, lang_code: str) -> KokoroPipeline: ...


class KokoroSpeechSynthesizer:
    """Generate 24 kHz WAV speech without a hosted speech API."""

    def __init__(
        self,
        *,
        lang_code: str = "a",
        voice: str = "af_heart",
        speed: float = 1.0,
        pipeline_factory: PipelineFactory | None = None,
    ) -> None:
        self.lang_code = lang_code
        self.voice = voice
        self.speed = speed
        self._pipeline_factory = pipeline_factory
        self._pipeline: KokoroPipeline | None = None
        self._lock = threading.Lock()

    def synthesize(self, text: str) -> bytes:
        """Synthesize normalized text and return a PCM WAV payload."""
        normalized = " ".join(text.split())
        if not normalized:
            raise ValueError("Speech text must not be empty.")

        # KPipeline and the underlying torch model are shared. Serializing
        # inference avoids racing the lazy load or mutating model state.
        with self._lock:
            pipeline = self._get_pipeline()
            try:
                audio_parts = [
                    _to_numpy_audio(audio)
                    for _graphemes, _phonemes, audio in pipeline(
                        normalized,
                        voice=self.voice,
                        speed=self.speed,
                    )
                ]
            except Exception as exc:
                raise KokoroUnavailableError(f"Kokoro could not synthesize speech: {exc}") from exc

        if not audio_parts:
            raise KokoroUnavailableError("Kokoro returned no audio.")
        return _encode_wav(np.concatenate(audio_parts), sample_rate=24_000)

    def _get_pipeline(self) -> KokoroPipeline:
        if self._pipeline is not None:
            return self._pipeline

        factory = self._pipeline_factory
        if factory is None:
            try:
                from kokoro import KPipeline
            except ImportError as exc:
                raise KokoroUnavailableError(
                    "Kokoro TTS is not installed. Run `uv sync` before using Listen."
                ) from exc
            factory = KPipeline

        try:
            self._pipeline = factory(lang_code=self.lang_code)
        except Exception as exc:
            raise KokoroUnavailableError(
                f"Kokoro could not initialize its local model: {exc}"
            ) from exc
        return self._pipeline


def _to_numpy_audio(audio: Any) -> np.ndarray[Any, Any]:
    if hasattr(audio, "detach"):
        audio = audio.detach()
    if hasattr(audio, "cpu"):
        audio = audio.cpu()
    converted = np.asarray(audio, dtype=np.float32).reshape(-1)
    if converted.size == 0:
        raise KokoroUnavailableError("Kokoro returned an empty audio segment.")
    return converted


def _encode_wav(audio: np.ndarray[Any, Any], *, sample_rate: int) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * np.iinfo(np.int16).max).astype("<i2")
    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())
    return output.getvalue()


@lru_cache(maxsize=1)
def get_kokoro_synthesizer() -> KokoroSpeechSynthesizer:
    """Return the process-wide lazy synthesizer configured from local env."""
    return KokoroSpeechSynthesizer(
        lang_code=os.environ.get("KOKORO_LANG_CODE", "a"),
        voice=os.environ.get("KOKORO_VOICE", "af_heart"),
        speed=float(os.environ.get("KOKORO_SPEED", "1.0")),
    )
