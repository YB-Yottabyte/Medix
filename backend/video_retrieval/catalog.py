"""Validated lookup for non-label video metadata."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

from backend.domain import VideoDocument

if TYPE_CHECKING:
    from collections.abc import Iterable


class VideoCatalog:
    """Provide duration and source metadata for retrieved videos."""

    def __init__(self, documents: Iterable[VideoDocument]):
        self._documents = {}
        for document in documents:
            if document.video_id in self._documents:
                raise ValueError(f"duplicate video document: {document.video_id}")
            self._documents[document.video_id] = document
        if not self._documents:
            raise ValueError("video catalog must not be empty")

    def get(self, video_id: str) -> VideoDocument:
        try:
            return self._documents[video_id]
        except KeyError as exc:
            raise KeyError(f"video not present in catalog: {video_id}") from exc

    def __len__(self) -> int:
        return len(self._documents)


def load_video_documents(path: str | Path) -> tuple[VideoDocument, ...]:
    """Load a label-free video catalog used by both runtime and evaluation."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    documents = payload.get("documents") if isinstance(payload, dict) else None
    if not isinstance(documents, list):
        raise TypeError("video catalog must contain a documents list")

    forbidden = {
        "question",
        "sample_id",
        "answer_start",
        "answer_end",
        "answer_start_second",
        "answer_end_second",
    }
    loaded = []
    for document in documents:
        if not isinstance(document, dict):
            raise TypeError("each video document must be a mapping")
        leaked = forbidden & document.keys()
        if leaked:
            raise ValueError(
                "video catalog contains prohibited benchmark labels: " + ", ".join(sorted(leaked))
            )
        loaded.append(VideoDocument(**document))
    if len({document.video_id for document in loaded}) != len(loaded):
        raise ValueError("video catalog contains duplicate video IDs")
    return tuple(loaded)
