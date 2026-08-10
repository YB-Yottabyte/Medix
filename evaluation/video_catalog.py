"""Build and validate a one-document-per-video retrieval catalog."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any, Protocol

from backend.domain import VideoDocument

if TYPE_CHECKING:
    from collections.abc import Iterable


class VideoMetadataFetcher(Protocol):
    """Retrieve public metadata without reading benchmark answer labels."""

    def fetch(self, video_id: str) -> dict[str, str]: ...


@dataclass(frozen=True)
class CatalogBuildResult:
    documents: tuple[VideoDocument, ...]
    unavailable_video_ids: tuple[str, ...]

    def as_serializable(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "document_count": len(self.documents),
            "unavailable_video_count": len(self.unavailable_video_ids),
            "unavailable_video_ids": list(self.unavailable_video_ids),
            "documents": [asdict(document) for document in self.documents],
        }


class VideoCatalogBuilder:
    """Create video documents while excluding questions and answer timestamps."""

    def __init__(self, metadata_fetcher: VideoMetadataFetcher, *, workers: int = 1):
        if workers < 1:
            raise ValueError("workers must be positive")
        self.metadata_fetcher = metadata_fetcher
        self.workers = workers

    def build(self, records: Iterable[dict[str, Any]]) -> CatalogBuildResult:
        source_videos = self._unique_video_sources(records)
        documents_by_id = {}
        unavailable = []
        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            pending = {
                executor.submit(self._build_document, video_id, source): video_id
                for video_id, source in source_videos.items()
            }
            for future in as_completed(pending):
                video_id = pending[future]
                try:
                    documents_by_id[video_id] = future.result()
                except (KeyError, RuntimeError, ValueError):
                    unavailable.append(video_id)

        return CatalogBuildResult(
            documents=tuple(documents_by_id[key] for key in sorted(documents_by_id)),
            unavailable_video_ids=tuple(sorted(unavailable)),
        )

    def _build_document(
        self,
        video_id: str,
        source: dict[str, str | float],
    ) -> VideoDocument:
        metadata = self.metadata_fetcher.fetch(video_id)
        return VideoDocument(
            video_id=video_id,
            title=self._required_title(metadata),
            duration_seconds=float(source["duration_seconds"]),
            source_uri=str(source["source_uri"]),
            author_name=str(metadata.get("author_name", "")).strip() or None,
        )

    @staticmethod
    def _required_title(metadata: dict[str, str]) -> str:
        title = str(metadata["title"]).strip()
        if not title:
            raise ValueError("empty video title")
        return title

    @staticmethod
    def _unique_video_sources(
        records: Iterable[dict[str, Any]],
    ) -> dict[str, dict[str, str | float]]:
        sources: dict[str, dict[str, str | float]] = {}
        for record in records:
            video_id = str(record["video_id"]).strip()
            duration = float(record["video_length"])
            if not video_id or duration <= 0:
                raise ValueError("video records require an ID and positive duration")
            source_uri = str(
                record.get("video_url") or f"https://www.youtube.com/watch?v={video_id}"
            )
            existing = sources.get(video_id)
            if existing and existing["duration_seconds"] != duration:
                raise ValueError(f"conflicting duration for video {video_id}")
            sources[video_id] = {
                "duration_seconds": duration,
                "source_uri": source_uri,
            }
        return sources


def load_video_documents(payload: dict[str, Any]) -> tuple[VideoDocument, ...]:
    """Load a serialized catalog and reject duplicate or label-bearing documents."""
    documents = payload.get("documents")
    if not isinstance(documents, list):
        raise TypeError("video catalog must contain a documents list")

    forbidden_fields = {
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
        leaked_fields = forbidden_fields & document.keys()
        if leaked_fields:
            raise ValueError(
                "video catalog contains prohibited benchmark labels: "
                + ", ".join(sorted(leaked_fields))
            )
        loaded.append(VideoDocument(**document))

    if len({document.video_id for document in loaded}) != len(loaded):
        raise ValueError("video catalog contains duplicate video IDs")
    return tuple(loaded)
