"""Tests for local Kokoro speech generation."""

from __future__ import annotations

import wave
from io import BytesIO

import numpy as np

from backend.services.kokoro_tts import KokoroSpeechSynthesizer


class FakePipeline:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, float]] = []

    def __call__(self, text: str, *, voice: str, speed: float):
        self.calls.append((text, voice, speed))
        yield text, "phonemes", np.array([-0.5, 0.0, 0.5], dtype=np.float32)


def test_kokoro_synthesizer_returns_24khz_mono_wav() -> None:
    pipeline = FakePipeline()

    def factory(*, lang_code: str) -> FakePipeline:
        assert lang_code == "a"
        return pipeline

    synthesizer = KokoroSpeechSynthesizer(
        pipeline_factory=factory,
    )

    audio = synthesizer.synthesize("  Apply   pressure.  ")

    assert audio.startswith(b"RIFF")
    assert pipeline.calls == [("Apply pressure.", "af_heart", 1.0)]
    with wave.open(BytesIO(audio), "rb") as wav_file:
        assert wav_file.getframerate() == 24_000
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        assert wav_file.getnframes() == 3


def test_kokoro_pipeline_is_lazily_initialized_once() -> None:
    pipeline = FakePipeline()
    initialization_count = 0

    def factory(*, lang_code: str) -> FakePipeline:
        nonlocal initialization_count
        assert lang_code == "a"
        initialization_count += 1
        return pipeline

    synthesizer = KokoroSpeechSynthesizer(pipeline_factory=factory)

    synthesizer.synthesize("First sentence.")
    synthesizer.synthesize("Second sentence.")

    assert initialization_count == 1
