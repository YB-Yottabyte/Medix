"""Safe FFmpeg-backed extraction of timestamped JPEG frames."""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

from backend.video_processing.base import ClipArtifact, FrameSample, VideoUnavailableError

_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov")


class LocalVideoRepository:
    """Resolve video IDs only within an explicit local cache directory."""

    def __init__(self, video_dir: str | Path):
        self.video_dir = Path(video_dir)

    def resolve(self, video_id: str) -> Path:
        if not _VIDEO_ID.fullmatch(video_id):
            raise ValueError("video_id contains unsupported characters")
        for extension in _VIDEO_EXTENSIONS:
            candidate = self.video_dir / f"{video_id}{extension}"
            if candidate.is_file():
                return candidate
        raise VideoUnavailableError(f"No local video file for {video_id}")

    def contains(self, video_id: str) -> bool:
        try:
            self.resolve(video_id)
        except (ValueError, VideoUnavailableError):
            return False
        return True


class FFmpegFrameExtractor:
    """Decode requested frames without loading an entire video into memory."""

    def __init__(
        self,
        repository: LocalVideoRepository,
        *,
        ffmpeg_binary: str = "ffmpeg",
        output_width: int = 336,
    ):
        if output_width < 1:
            raise ValueError("output_width must be positive")
        self.repository = repository
        self.ffmpeg_binary = ffmpeg_binary
        self.output_width = output_width
        self._cache: dict[tuple[str, float], FrameSample] = {}

    def extract(
        self,
        video_id: str,
        timestamps_seconds: tuple[float, ...],
    ) -> tuple[FrameSample, ...]:
        if not timestamps_seconds:
            raise ValueError("at least one frame timestamp is required")
        path = self.repository.resolve(video_id)
        frames = []
        for timestamp in timestamps_seconds:
            if timestamp < 0:
                raise ValueError("frame timestamp must not be negative")
            cache_key = (video_id, round(timestamp, 3))
            frame = self._cache.get(cache_key)
            if frame is None:
                frame = self._decode(path, video_id, timestamp)
                self._cache[cache_key] = frame
            frames.append(frame)
        return tuple(frames)

    def _decode(self, path: Path, video_id: str, timestamp: float) -> FrameSample:
        command = [
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
            "-vf",
            f"scale={self.output_width}:-2",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "pipe:1",
        ]
        try:
            completed = subprocess.run(  # noqa: S603 - fixed executable and argument list
                command,
                check=True,
                capture_output=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise VideoUnavailableError(
                f"Could not decode frame {timestamp:.3f}s from {video_id}"
            ) from exc
        if not completed.stdout:
            raise VideoUnavailableError(
                f"FFmpeg returned no frame at {timestamp:.3f}s for {video_id}"
            )
        return FrameSample(
            video_id=video_id,
            timestamp_seconds=timestamp,
            jpeg_bytes=completed.stdout,
        )


class FFmpegClipExtractor:
    """Create accurately bounded, broadly playable MP4 evidence clips."""

    def __init__(
        self,
        repository: LocalVideoRepository,
        *,
        ffmpeg_binary: str = "ffmpeg",
        ffprobe_binary: str = "ffprobe",
    ):
        self.repository = repository
        self.ffmpeg_binary = ffmpeg_binary
        self.ffprobe_binary = ffprobe_binary

    def extract(
        self,
        video_id: str,
        start_seconds: float,
        end_seconds: float,
        output_path: Path,
    ) -> ClipArtifact:
        if start_seconds < 0 or end_seconds <= start_seconds:
            raise ValueError("clip extraction requires a valid interval")
        source = self.repository.resolve(video_id)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.is_file():
            return ClipArtifact(output_path, self._duration(output_path))

        with tempfile.NamedTemporaryFile(
            dir=output_path.parent,
            suffix=".mp4",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        command = [
            self.ffmpeg_binary,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-ss",
            f"{start_seconds:.3f}",
            "-t",
            f"{end_seconds - start_seconds:.3f}",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "25",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(temporary_path),
        ]
        try:
            subprocess.run(  # noqa: S603 - fixed executable and validated paths
                command,
                check=True,
                capture_output=True,
                timeout=300,
            )
            if not temporary_path.is_file() or temporary_path.stat().st_size == 0:
                raise VideoUnavailableError(f"FFmpeg created no clip for {video_id}")
            os.replace(temporary_path, output_path)
        except (OSError, subprocess.SubprocessError) as exc:
            temporary_path.unlink(missing_ok=True)
            raise VideoUnavailableError(f"Could not extract clip for {video_id}") from exc
        return ClipArtifact(output_path, self._duration(output_path))

    def _duration(self, path: Path) -> float:
        command = [
            self.ffprobe_binary,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
        try:
            completed = subprocess.run(  # noqa: S603 - fixed executable and local path
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            duration = float(completed.stdout.strip())
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            raise VideoUnavailableError(f"Could not inspect clip duration: {path}") from exc
        if duration <= 0:
            raise VideoUnavailableError(f"Clip has invalid duration: {path}")
        return duration
