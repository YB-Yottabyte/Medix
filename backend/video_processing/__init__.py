"""Offline local-video and frame-extraction adapters."""

from backend.video_processing.base import (
    ClipArtifact,
    ClipExtractor,
    FrameExtractor,
    FrameSample,
    VideoUnavailableError,
)
from backend.video_processing.ffmpeg import (
    FFmpegClipExtractor,
    FFmpegFrameExtractor,
    LocalVideoRepository,
)

__all__ = [
    "ClipArtifact",
    "ClipExtractor",
    "FFmpegClipExtractor",
    "FFmpegFrameExtractor",
    "FrameExtractor",
    "FrameSample",
    "LocalVideoRepository",
    "VideoUnavailableError",
]
