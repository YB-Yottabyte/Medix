"""Build a reproducible MedVidQA subset with complete local evidence."""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Protocol

from backend.transcripts import TranscriptUnavailableError
from backend.video_processing import VideoUnavailableError

if TYPE_CHECKING:
    from pathlib import Path

    from backend.transcripts import TranscriptRepository
    from backend.video_processing import LocalVideoRepository
    from evaluation.medvidqa_dataset import MedVidQASample, OfficialMedVidQADataset


class VideoProbe(Protocol):
    """Validate that a local video is readable and report its duration."""

    def duration_seconds(self, path: Path) -> float: ...


class FFprobeVideoProbe:
    """Use ffprobe plus one-frame decode without modifying source videos."""

    def __init__(
        self,
        *,
        binary: str = "ffprobe",
        decode_binary: str = "ffmpeg",
        timeout_seconds: int = 30,
    ):
        self.binary = binary
        self.decode_binary = decode_binary
        self.timeout_seconds = timeout_seconds

    def duration_seconds(self, path: Path) -> float:
        command = [
            self.binary,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
        try:
            completed = subprocess.run(  # noqa: S603 - explicit executable and local path
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
            duration = float(completed.stdout.strip())
        except (OSError, subprocess.SubprocessError, ValueError) as exc:
            raise VideoUnavailableError(f"Could not validate local video: {path}") from exc
        if duration <= 0:
            raise VideoUnavailableError(f"Local video has invalid duration: {path}")
        self._validate_decode(path)
        return duration

    def _validate_decode(self, path: Path) -> None:
        command = [
            self.decode_binary,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ]
        try:
            subprocess.run(  # noqa: S603 - explicit executable and local path
                command,
                check=True,
                capture_output=True,
                timeout=self.timeout_seconds,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise VideoUnavailableError(f"Could not decode local video: {path}") from exc


@dataclass(frozen=True)
class SupportedSample:
    split: str
    sample_id: str
    question: str
    video_id: str
    expected_start_seconds: float
    expected_end_seconds: float
    dataset_duration_seconds: float
    local_video_duration_seconds: float
    transcript_cues: int
    overlapping_transcript_cues: int
    video_artifact_path: str
    transcript_artifact_path: str


@dataclass(frozen=True)
class RejectedSample:
    split: str
    sample_id: str
    video_id: str
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class SupportedCollection:
    samples: tuple[SupportedSample, ...]
    rejected: tuple[RejectedSample, ...]
    runtime_video_ids: tuple[str, ...]

    def as_serializable(self) -> dict[str, object]:
        split_names = ("train", "validation", "test")
        split_summary = {}
        for split in split_names:
            accepted = [sample for sample in self.samples if sample.split == split]
            rejected = [sample for sample in self.rejected if sample.split == split]
            split_summary[split] = {
                "supported_samples": len(accepted),
                "supported_videos": len({sample.video_id for sample in accepted}),
                "rejected_samples": len(rejected),
            }
        return {
            "schema_version": 1,
            "definition": (
                "A sample is supported only when its catalog entry, local video, "
                "timestamped transcript, answer-overlapping transcript cues, and "
                "local video duration are all valid."
            ),
            "summary": {
                "supported_samples": len(self.samples),
                "supported_videos": len({sample.video_id for sample in self.samples}),
                "rejected_samples": len(self.rejected),
                "splits": split_summary,
            },
            "samples": [asdict(sample) for sample in self.samples],
            "rejected": [asdict(sample) for sample in self.rejected],
        }

    def supported_video_manifest(self) -> dict[str, object]:
        """Return a label-free allowlist safe for runtime retrieval.

        Unlike sample eligibility, this list does not inspect gold timestamps.
        """
        video_ids = list(self.runtime_video_ids)
        return {
            "schema_version": 1,
            "definition": "Videos with validated local video and transcript evidence.",
            "video_count": len(video_ids),
            "video_ids": video_ids,
        }


class SupportedCollectionBuilder:
    """Separate missing-data failures from model-quality failures."""

    def __init__(
        self,
        *,
        transcript_repository: TranscriptRepository,
        video_repository: LocalVideoRepository,
        video_probe: VideoProbe,
        catalog_video_ids: set[str],
        project_root: Path,
        transcript_cache: Path,
        duration_tolerance_seconds: float = 1.0,
    ):
        if duration_tolerance_seconds < 0:
            raise ValueError("duration_tolerance_seconds must not be negative")
        self.transcript_repository = transcript_repository
        self.video_repository = video_repository
        self.video_probe = video_probe
        self.catalog_video_ids = catalog_video_ids
        self.project_root = project_root.resolve()
        self.transcript_cache = transcript_cache
        self.duration_tolerance_seconds = duration_tolerance_seconds
        self._duration_cache: dict[str, tuple[Path, float]] = {}

    def build(self, dataset: OfficialMedVidQADataset) -> SupportedCollection:
        accepted = []
        rejected = []
        runtime_video_ids = set()
        splits = (
            ("train", dataset.train),
            ("validation", dataset.validation),
            ("test", dataset.test),
        )
        for split, samples in splits:
            for sample in samples:
                supported, failure, runtime_supported = self._inspect(split, sample)
                if runtime_supported:
                    runtime_video_ids.add(sample.video_id)
                if supported is not None:
                    accepted.append(supported)
                else:
                    assert failure is not None
                    rejected.append(failure)
        return SupportedCollection(
            tuple(accepted),
            tuple(rejected),
            tuple(sorted(runtime_video_ids)),
        )

    def _inspect(
        self,
        split: str,
        sample: MedVidQASample,
    ) -> tuple[SupportedSample | None, RejectedSample | None, bool]:
        reasons = []
        if sample.video_id not in self.catalog_video_ids:
            reasons.append("catalog_missing")

        video_path = None
        video_duration = None
        try:
            video_path, video_duration = self._video(sample.video_id)
            if video_duration + self.duration_tolerance_seconds < sample.answer_end_seconds:
                reasons.append("video_shorter_than_answer")
        except (ValueError, VideoUnavailableError):
            reasons.append("video_unavailable")

        cues = ()
        try:
            cues = self.transcript_repository.load(sample.video_id)
        except (ValueError, TranscriptUnavailableError):
            reasons.append("transcript_unavailable")
        overlapping = tuple(
            cue
            for cue in cues
            if cue.end_seconds > sample.answer_start_seconds
            and cue.start_seconds < sample.answer_end_seconds
        )
        if cues and not overlapping:
            reasons.append("answer_has_no_transcript_overlap")

        runtime_supported = (
            sample.video_id in self.catalog_video_ids
            and video_path is not None
            and video_duration is not None
            and bool(cues)
        )
        if reasons:
            return (
                None,
                RejectedSample(
                    split=split,
                    sample_id=sample.sample_id,
                    video_id=sample.video_id,
                    reasons=tuple(sorted(set(reasons))),
                ),
                runtime_supported,
            )

        assert video_path is not None and video_duration is not None
        transcript_path = self.transcript_cache / f"{sample.video_id}.json"
        return (
            SupportedSample(
                split=split,
                sample_id=sample.sample_id,
                question=sample.question,
                video_id=sample.video_id,
                expected_start_seconds=sample.answer_start_seconds,
                expected_end_seconds=sample.answer_end_seconds,
                dataset_duration_seconds=sample.video_duration_seconds,
                local_video_duration_seconds=video_duration,
                transcript_cues=len(cues),
                overlapping_transcript_cues=len(overlapping),
                video_artifact_path=self._relative(video_path),
                transcript_artifact_path=self._relative(transcript_path),
            ),
            None,
            runtime_supported,
        )

    def _video(self, video_id: str) -> tuple[Path, float]:
        cached = self._duration_cache.get(video_id)
        if cached is not None:
            return cached
        path = self.video_repository.resolve(video_id)
        result = (path, self.video_probe.duration_seconds(path))
        self._duration_cache[video_id] = result
        return result

    def _relative(self, path: Path) -> str:
        return str(path.resolve().relative_to(self.project_root))


def write_json(path: Path, payload: dict[str, object]) -> None:
    """Persist a deterministic JSON artifact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
