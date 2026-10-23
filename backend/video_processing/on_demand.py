"""Validated, reproducible on-demand media caching for evaluation runs."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.performance import timed
from backend.video_processing.base import VideoUnavailableError
from backend.video_processing.ffmpeg import LocalVideoRepository

_VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov")
_FORMAT = "bestvideo[height<=360]+bestaudio/best[height<=360]/worst"
_YT_DLP = ("uvx", "--from", "yt-dlp[default]==2026.08.19", "yt-dlp")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class OnDemandVideoRepository(LocalVideoRepository):
    """Resolve seed media first, then acquire and bound a writable LRU cache.

    Media resolved during this repository's lifetime is pinned and cannot be
    evicted. Seed directories are always read-only and are never considered for
    eviction. Acquisition and eviction events are appended to a durable journal
    outside the media directory.
    """

    def __init__(
        self,
        video_dir: str | Path,
        *,
        source_index: str | Path,
        metadata_dir: str | Path,
        max_cache_bytes: int,
        seed_dirs: tuple[str | Path, ...] = (),
        ffmpeg_binary: str = "ffmpeg",
        ffprobe_binary: str = "ffprobe",
    ):
        super().__init__(video_dir)
        if max_cache_bytes < 1:
            raise ValueError("max_cache_bytes must be positive")
        self.video_dir.mkdir(parents=True, exist_ok=True)
        self.source_index_path = Path(source_index)
        self.metadata_dir = Path(metadata_dir)
        self.metadata_dir.mkdir(parents=True, exist_ok=True)
        self.max_cache_bytes = max_cache_bytes
        self.seed_repositories = tuple(LocalVideoRepository(path) for path in seed_dirs)
        self.ffmpeg_binary = ffmpeg_binary
        self.ffprobe_binary = ffprobe_binary
        self._sources = self._load_sources()
        self._session_pins: set[str] = set()
        self._lock = threading.RLock()
        self._journal_lock = threading.Lock()
        self._video_locks: dict[str, threading.Lock] = {}
        self._journal = self.metadata_dir / "media-cache-events.jsonl"
        self._acquisition_records = self._load_acquisition_records()
        self._inflight = self.video_dir / ".inflight"
        self._inflight.mkdir(exist_ok=True)
        self._tool_versions = {
            "yt_dlp": "2026.08.19",
            "yt_dlp_ejs": "0.8.0",
            "deno": self._version(("deno", "--version")),
            "ffmpeg": self._version((self.ffmpeg_binary, "-version")),
            "ffprobe": self._version((self.ffprobe_binary, "-version")),
        }
        run_manifest = {
            "run_id": str(uuid.uuid4()),
            "created_at_utc": _utc_now(),
            "writable_cache": str(self.video_dir.resolve()),
            "seed_caches": [
                str(repository.video_dir.resolve()) for repository in self.seed_repositories
            ],
            "max_cache_bytes": self.max_cache_bytes,
            "source_index": str(self.source_index_path.resolve()),
            "source_index_sha256": _sha256(self.source_index_path),
            "tool_versions": self._tool_versions,
        }
        run_path = self.metadata_dir / "runs" / f"{run_manifest['run_id']}.json"
        run_path.parent.mkdir(parents=True, exist_ok=True)
        with run_path.open("x", encoding="utf-8") as stream:
            json.dump(run_manifest, stream, indent=2, sort_keys=True)
            stream.write("\n")

    @property
    def session_pins(self) -> frozenset[str]:
        return frozenset(self._session_pins)

    @timed("video.resolve")
    def resolve(self, video_id: str) -> Path:
        with self._lock:
            for repository in self.seed_repositories:
                if repository.contains(video_id):
                    path = repository.resolve(video_id)
                    self._session_pins.add(video_id)
                    return path
            try:
                path = super().resolve(video_id)
            except VideoUnavailableError:
                path = None
            if path is not None:
                self._session_pins.add(video_id)
                os.utime(path, None)
                self._evict_to_limit()
                return path
            video_lock = self._video_locks.setdefault(video_id, threading.Lock())

        with video_lock:
            with self._lock:
                try:
                    path = super().resolve(video_id)
                except VideoUnavailableError:
                    path = None
            if path is None:
                path = self._acquire(video_id)
            with self._lock:
                self._session_pins.add(video_id)
                os.utime(path, None)
                self._evict_to_limit()
                return path

    def contains(self, video_id: str) -> bool:
        if any(repository.contains(video_id) for repository in self.seed_repositories):
            return True
        return super().contains(video_id)

    def cache_size_bytes(self) -> int:
        return sum(path.stat().st_size for path in self._media_files())

    def _load_sources(self) -> dict[str, dict[str, Any]]:
        if not self.source_index_path.is_file():
            raise FileNotFoundError(f"Video source index is missing: {self.source_index_path}")
        payload = json.loads(self.source_index_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise TypeError("video source index must be a JSON object keyed by video ID")
        return {str(video_id): dict(value) for video_id, value in payload.items()}

    def _acquire(self, video_id: str) -> Path:
        try:
            source = self._sources[video_id]
            source_url = str(source["source_url"])
            latest_end = float(source["latest_annotated_answer_end_seconds"])
        except (KeyError, TypeError, ValueError) as exc:
            raise VideoUnavailableError(f"No valid acquisition metadata for {video_id}") from exc

        attempts: list[dict[str, Any]] = []
        acquired_at = _utc_now()
        with tempfile.TemporaryDirectory(dir=self._inflight, prefix=f"{video_id}-") as temporary:
            temporary_dir = Path(temporary)
            path = self._download(video_id, source_url, temporary_dir, _FORMAT, attempts)
            if path is None and attempts and "HTTP Error 403" in str(attempts[-1]["error"]):
                alternative, advertised = self._advertised_alternative(
                    source_url, attempts[-1].get("selected_format")
                )
                attempts[-1]["advertised_alternative_probe"] = advertised
                if alternative:
                    path = self._download(
                        video_id, source_url, temporary_dir, alternative, attempts
                    )
            if path is None:
                error = attempts[-1]["error"] if attempts else "download produced no file"
                self._append_event(
                    {
                        "event": "acquisition_failed",
                        "video_id": video_id,
                        "source_url": source_url,
                        "timestamp_utc": _utc_now(),
                        "tool_versions": self._tool_versions,
                        "attempts": attempts,
                        "error": error,
                    }
                )
                raise VideoUnavailableError(f"Could not acquire public video {video_id}: {error}")

            validation = self._validate(path, latest_end)
            if not validation["valid"]:
                self._append_event(
                    {
                        "event": "validation_failed",
                        "video_id": video_id,
                        "source_url": source_url,
                        "timestamp_utc": _utc_now(),
                        "tool_versions": self._tool_versions,
                        "attempts": attempts,
                        "validation": validation,
                        "file_sha256": _sha256(path),
                    }
                )
                raise VideoUnavailableError(f"Downloaded video failed validation for {video_id}")

            destination = self.video_dir / f"{video_id}{path.suffix.lower()}"
            if destination.exists():
                raise VideoUnavailableError(f"Refusing to overwrite cached media for {video_id}")
            os.replace(path, destination)
            digest = _sha256(destination)
            selected = attempts[-1].get("selected_format")
            acquisition_event = {
                "event": "acquired",
                "video_id": video_id,
                "source_url": source_url,
                "acquisition_timestamp_utc": acquired_at,
                "timestamp_utc": _utc_now(),
                "tool_versions": self._tool_versions,
                "selected_format": selected,
                "format_policy": _FORMAT,
                "file_name": destination.name,
                "file_size_bytes": destination.stat().st_size,
                "file_sha256": digest,
                "validation": validation,
                "attempts": attempts,
            }
            self._append_event(acquisition_event)
            self._acquisition_records[video_id] = acquisition_event
            return destination

    @timed("video.download")
    def _download(
        self,
        video_id: str,
        source_url: str,
        output_dir: Path,
        selector: str,
        attempts: list[dict[str, Any]],
    ) -> Path | None:
        command = [
            *_YT_DLP,
            "--ignore-config",
            "--no-cache-dir",
            "--no-playlist",
            "--socket-timeout",
            "15",
            "--retries",
            "1",
            "--fragment-retries",
            "1",
            "--no-progress",
            "--no-overwrites",
            "--no-continue",
            "--no-part",
            "--format",
            selector,
            "--merge-output-format",
            "mp4",
            "--print",
            "before_dl:medix|%(format_id)s",
            "--output",
            str(output_dir / "%(id)s.%(ext)s"),
            source_url,
        ]
        environment = dict(os.environ)
        environment.setdefault("UV_CACHE_DIR", str(self.metadata_dir / "uv-cache"))
        try:
            completed = subprocess.run(  # noqa: S603 - fixed tool and bounded arguments
                command,
                capture_output=True,
                text=True,
                timeout=900,
                env=environment,
                check=False,
            )
            error = completed.stderr.strip() if completed.returncode else None
            selected = next(
                (
                    line.removeprefix("medix|")
                    for line in completed.stdout.splitlines()
                    if line.startswith("medix|")
                ),
                None,
            )
            attempt = {
                "selector": selector,
                "selected_format": selected,
                "returncode": completed.returncode,
                "error": error,
            }
        except (OSError, subprocess.SubprocessError) as exc:
            attempt = {
                "selector": selector,
                "selected_format": None,
                "returncode": None,
                "error": f"{type(exc).__name__}: {exc}",
            }
        attempts.append(attempt)
        files = [
            path
            for extension in _VIDEO_EXTENSIONS
            if (path := output_dir / f"{video_id}{extension}").is_file()
        ]
        return files[0] if attempt["returncode"] == 0 and len(files) == 1 else None

    def _advertised_alternative(
        self, source_url: str, primary: str | None
    ) -> tuple[str | None, dict[str, Any]]:
        command = [
            *_YT_DLP,
            "--ignore-config",
            "--no-cache-dir",
            "--no-playlist",
            "--skip-download",
            "--dump-single-json",
            "--no-warnings",
            source_url,
        ]
        environment = dict(os.environ)
        environment.setdefault("UV_CACHE_DIR", str(self.metadata_dir / "uv-cache"))
        completed = subprocess.run(  # noqa: S603 - fixed tool and bounded arguments
            command,
            capture_output=True,
            text=True,
            timeout=120,
            env=environment,
            check=False,
        )
        formats: list[dict[str, Any]] = []
        if completed.returncode == 0:
            try:
                payload = json.loads(completed.stdout)
                formats = list(payload.get("formats", []))
            except (TypeError, ValueError):
                formats = []
        videos = sorted(
            (
                item
                for item in formats
                if item.get("ext") == "mp4"
                and item.get("height")
                and int(item["height"]) <= 360
                and item.get("vcodec") not in (None, "none")
                and item.get("acodec") == "none"
                and "http" in str(item.get("protocol"))
            ),
            key=lambda item: int(item["height"]),
            reverse=True,
        )
        audios = sorted(
            (
                item
                for item in formats
                if item.get("ext") == "m4a"
                and item.get("vcodec") == "none"
                and item.get("acodec") not in (None, "none")
                and "http" in str(item.get("protocol"))
            ),
            key=lambda item: str(item.get("language", "")).startswith("en"),
            reverse=True,
        )
        alternative = next(
            (
                f"{video['format_id']}+{audio['format_id']}"
                for video in videos
                for audio in audios
                if f"{video['format_id']}+{audio['format_id']}" != primary
            ),
            None,
        )
        return alternative, {
            "returncode": completed.returncode,
            "error": completed.stderr.strip() if completed.returncode else None,
            "advertised_format_ids": [item.get("format_id") for item in formats],
            "selected_alternative": alternative,
        }

    def _validate(self, path: Path, latest_end: float) -> dict[str, Any]:
        probe = subprocess.run(  # noqa: S603 - fixed executable and local file
            [
                self.ffprobe_binary,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        duration = None
        video_stream = False
        if probe.returncode == 0:
            try:
                payload = json.loads(probe.stdout)
                duration = float(payload["format"]["duration"])
                video_stream = any(
                    stream.get("codec_type") == "video" for stream in payload.get("streams", [])
                )
            except (KeyError, TypeError, ValueError):
                pass
        frame_results = []
        for timestamp in (1.0, max(0.0, latest_end / 2), max(0.0, latest_end - 1)):
            frame = subprocess.run(  # noqa: S603 - fixed executable and local file
                [
                    self.ffmpeg_binary,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-ss",
                    f"{timestamp:.3f}",
                    "-i",
                    str(path),
                    "-frames:v",
                    "1",
                    "-f",
                    "image2pipe",
                    "-vcodec",
                    "mjpeg",
                    "pipe:1",
                ],
                capture_output=True,
                timeout=45,
                check=False,
            )
            frame_results.append(frame.returncode == 0 and bool(frame.stdout))
        clip_start = max(0.0, latest_end - 3.0)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as temporary:
            clip_path = Path(temporary.name)
        clip = subprocess.run(  # noqa: S603 - fixed executable and local paths
            [
                self.ffmpeg_binary,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(path),
                "-ss",
                f"{clip_start:.3f}",
                "-t",
                f"{max(0.5, latest_end - clip_start):.3f}",
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-c:a",
                "aac",
                str(clip_path),
            ],
            capture_output=True,
            timeout=180,
            check=False,
        )
        clip_ok = clip.returncode == 0 and clip_path.is_file() and clip_path.stat().st_size > 0
        clip_path.unlink(missing_ok=True)
        reaches_end = duration is not None and duration + 0.1 >= latest_end
        return {
            "valid": bool(
                path.is_file()
                and path.stat().st_size > 0
                and duration
                and duration > 0
                and video_stream
                and reaches_end
                and all(frame_results)
                and clip_ok
            ),
            "duration_seconds": duration,
            "latest_annotated_answer_end_seconds": latest_end,
            "duration_reaches_latest_annotated_end": reaches_end,
            "video_stream_present": video_stream,
            "frame_decode_results": frame_results,
            "clip_extraction_success": clip_ok,
        }

    def _evict_to_limit(self) -> None:
        while self.cache_size_bytes() > self.max_cache_bytes:
            candidates = sorted(
                (
                    path
                    for path in self._media_files()
                    if path.stem not in self._session_pins
                    and path.stem in self._acquisition_records
                ),
                key=lambda path: path.stat().st_mtime,
            )
            if not candidates:
                return
            path = candidates[0]
            event = {
                "event": "evicted",
                "video_id": path.stem,
                "file_name": path.name,
                "file_size_bytes": path.stat().st_size,
                "file_sha256": _sha256(path),
                "eviction_timestamp_utc": _utc_now(),
                "timestamp_utc": _utc_now(),
                "reason": "LRU cache size limit",
                "acquisition_record": self._acquisition_records[path.stem],
            }
            path.unlink()
            self._append_event(event)

    def _media_files(self) -> tuple[Path, ...]:
        return tuple(
            path
            for path in self.video_dir.iterdir()
            if path.is_file() and path.suffix.lower() in _VIDEO_EXTENSIONS
        )

    def _append_event(self, event: dict[str, Any]) -> None:
        self.metadata_dir.mkdir(parents=True, exist_ok=True)
        line = json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n"
        with self._journal_lock, self._journal.open("a", encoding="utf-8") as stream:
            stream.write(line)
            stream.flush()
            os.fsync(stream.fileno())

    def _load_acquisition_records(self) -> dict[str, dict[str, Any]]:
        records: dict[str, dict[str, Any]] = {}
        if not self._journal.is_file():
            return records
        for line in self._journal.read_text(encoding="utf-8").splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("event") == "acquired" and event.get("video_id"):
                records[str(event["video_id"])] = event
        return records

    @staticmethod
    def _version(command: tuple[str, ...]) -> str:
        try:
            completed = subprocess.run(  # noqa: S603 - fixed version commands
                command,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            return (completed.stdout or completed.stderr).splitlines()[0]
        except (OSError, subprocess.SubprocessError, IndexError):
            return "unavailable"
