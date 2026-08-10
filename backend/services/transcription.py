"""Speech-to-text service adapters."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar

from backend.errors import ValidationError

if TYPE_CHECKING:
    from collections.abc import Callable


class GroqTranscriptionService:
    """Transcribe short user recordings with Groq Whisper."""

    MODEL = "whisper-large-v3"
    _ALLOWED_EXTENSIONS: ClassVar[set[str]] = {
        "flac",
        "m4a",
        "mp3",
        "mp4",
        "mpeg",
        "mpga",
        "ogg",
        "wav",
        "webm",
    }

    def __init__(self, client_factory: Callable[[], Any]):
        self._client_factory = client_factory

    def transcribe(self, audio_bytes: bytes, filename: str = "audio.webm") -> str:
        if not audio_bytes:
            raise ValidationError("Empty audio file")

        extension = Path(filename).suffix.lower().lstrip(".")
        if extension not in self._ALLOWED_EXTENSIONS:
            extension = "webm"

        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=f".{extension}", delete=False) as temp_file:
                temp_file.write(audio_bytes)
                temp_path = Path(temp_file.name)

            with temp_path.open("rb") as audio_file:
                result = self._client_factory().audio.transcriptions.create(
                    model=self.MODEL,
                    file=audio_file,
                    language="en",
                )
            return result.text.strip()
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
