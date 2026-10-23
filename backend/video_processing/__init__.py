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
from backend.video_processing.on_demand import OnDemandVideoRepository

__all__ = [
    "ClipArtifact",
    "ClipExtractor",
    "FFmpegClipExtractor",
    "FFmpegFrameExtractor",
    "FrameExtractor",
    "FrameSample",
    "LocalVideoRepository",
    "OnDemandVideoRepository",
    "VideoUnavailableError",
]
