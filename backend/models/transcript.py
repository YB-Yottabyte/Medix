"""
YouTube Transcript Fetcher
Fetches and caches video transcripts so the LLM can generate
answers grounded in actual video content instead of hallucinating.
"""

import json
from pathlib import Path


class TranscriptFetcher:
    def __init__(self, cache_dir: str = "./data/transcript_cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            from youtube_transcript_api import YouTubeTranscriptApi

            self.api = YouTubeTranscriptApi()
            self.available = True
        except ImportError:
            self.api = None
            self.available = False

    def _cache_path(self, video_id: str) -> Path:
        return self.cache_dir / f"{video_id}.json"

    def fetch(
        self, video_id: str, start: float | None = None, end: float | None = None
    ) -> str | None:
        """
        Fetch transcript for a YouTube video, optionally filtered to a time range.
        Returns plain text transcript or None if unavailable.
        Results are cached on disk to avoid repeated API calls.
        """
        if not self.available or not video_id:
            return None

        # Check cache first
        cached = self._load_cache(video_id)
        if cached is not None:
            return self._filter_and_format(cached, start, end)

        # Fetch from YouTube using YoutubeTranscriptApi
        try:
            transcript_obj = self.api.fetch(video_id)
            snippets = []
            for s in transcript_obj.snippets:
                snippets.append({"start": s.start, "duration": s.duration, "text": s.text})
            self._save_cache(video_id, snippets)
            return self._filter_and_format(snippets, start, end)
        except Exception:
            return None

    # database stores answer_start and answer_end, so we can use those to filter the transcript to just the relevant portion

    def _filter_and_format(
        self, snippets: list, start: float | None = None, end: float | None = None
    ) -> str:
        """Filter snippets to time range and join into readable text."""
        filtered = snippets
        if start is not None or end is not None:
            s = start or 0
            e = end or float("inf")
            filtered = [x for x in snippets if x["start"] >= s - 2 and x["start"] <= e + 2]

        if not filtered:
            # Fall back to full transcript if filter returns nothing
            filtered = snippets

        return " ".join(x["text"] for x in filtered)

    def _load_cache(self, video_id: str) -> list | None:
        path = self._cache_path(video_id)
        if path.exists():
            try:
                with open(path) as f:
                    return json.load(f)
            except Exception:
                return None
        return None

    def _save_cache(self, video_id: str, snippets: list):
        try:
            with open(self._cache_path(video_id), "w") as f:
                json.dump(snippets, f)
        except Exception:
            pass
