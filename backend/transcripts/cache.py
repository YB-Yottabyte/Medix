"""Read timestamped transcript cues from the local JSON cache."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.domain import TranscriptCue
from backend.transcripts.base import TranscriptUnavailableError


class CachedTranscriptRepository:
    """Offline repository backed by one JSON cue file per video."""

    def __init__(self, cache_dir: str | Path):
        self.cache_dir = Path(cache_dir)

    def load(self, video_id: str) -> tuple[TranscriptCue, ...]:
        normalized_id = video_id.strip()
        if not normalized_id:
            raise ValueError("video_id must not be empty")

        path = self.cache_dir / f"{normalized_id}.json"
        if not path.is_file():
            raise TranscriptUnavailableError(f"No cached transcript for {normalized_id}")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            cues = self._parse_cues(payload)
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise TranscriptUnavailableError(
                f"Cached transcript is invalid for {normalized_id}"
            ) from exc
        if not cues:
            raise TranscriptUnavailableError(f"Cached transcript is empty for {normalized_id}")
        return cues

    @staticmethod
    def _parse_cues(payload: Any) -> tuple[TranscriptCue, ...]:
        if not isinstance(payload, list):
            raise TypeError("transcript cache must contain a list")
        cues = []
        for item in payload:
            if not isinstance(item, dict):
                raise TypeError("transcript cue must be a mapping")
            text = str(item["text"]).strip()
            if not text:
                continue
            cues.append(
                TranscriptCue(
                    start_seconds=float(item["start"]),
                    duration_seconds=float(item["duration"]),
                    text=text,
                )
            )
        return tuple(sorted(cues, key=lambda cue: cue.start_seconds))
