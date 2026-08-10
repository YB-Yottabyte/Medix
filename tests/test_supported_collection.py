"""Tests for deterministic supported-collection validation."""

from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar

from backend.domain import TranscriptCue
from evaluation.medvidqa_dataset import MedVidQASample, OfficialMedVidQADataset
from evaluation.supported_collection import SupportedCollectionBuilder

if TYPE_CHECKING:
    from pathlib import Path


class FakeTranscripts:
    cues: ClassVar[tuple[TranscriptCue, ...]] = (TranscriptCue(1.0, 3.0, "apply direct pressure"),)

    def load(self, video_id: str) -> tuple[TranscriptCue, ...]:
        if video_id == "missing":
            from backend.transcripts import TranscriptUnavailableError

            raise TranscriptUnavailableError("missing")
        return self.cues


class FakeVideos:
    def __init__(self, root: Path):
        self.root = root

    def resolve(self, video_id: str) -> Path:
        from backend.video_processing import VideoUnavailableError

        path = self.root / f"{video_id}.mp4"
        if not path.is_file():
            raise VideoUnavailableError("missing")
        return path


class FakeProbe:
    def duration_seconds(self, _path: Path) -> float:
        return 10.0


def _sample(sample_id: str, video_id: str) -> MedVidQASample:
    return MedVidQASample(
        sample_id=sample_id,
        question="How do I apply pressure?",
        video_id=video_id,
        answer_start_seconds=1.5,
        answer_end_seconds=3.5,
        video_duration_seconds=10.0,
    )


def test_supported_collection_requires_complete_local_evidence(tmp_path) -> None:
    (tmp_path / "supported.mp4").write_bytes(b"video")
    transcript_cache = tmp_path / "transcripts"
    transcript_cache.mkdir()
    (transcript_cache / "supported.json").write_text("[]", encoding="utf-8")
    dataset = OfficialMedVidQADataset(
        train=(_sample("1", "supported"),),
        validation=(_sample("2", "missing"),),
        test=(),
    )
    collection = SupportedCollectionBuilder(
        transcript_repository=FakeTranscripts(),
        video_repository=FakeVideos(tmp_path),
        video_probe=FakeProbe(),
        catalog_video_ids={"supported", "missing"},
        project_root=tmp_path,
        transcript_cache=transcript_cache,
    ).build(dataset)

    assert [sample.sample_id for sample in collection.samples] == ["1"]
    assert collection.rejected[0].sample_id == "2"
    assert collection.rejected[0].reasons == (
        "transcript_unavailable",
        "video_unavailable",
    )
    assert collection.supported_video_manifest()["video_ids"] == ["supported"]
