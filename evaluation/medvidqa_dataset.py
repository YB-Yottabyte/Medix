"""Paper-faithful loading and validation for the official MedVidQA splits."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

OFFICIAL_SPLIT_SIZES = {"train": 2710, "val": 145, "test": 155}
OFFICIAL_VIDEO_COUNTS = {"train": 800, "val": 49, "test": 50}


@dataclass(frozen=True)
class MedVidQASample:
    """One official question and its expert-annotated visual answer."""

    sample_id: str
    question: str
    video_id: str
    answer_start_seconds: float
    answer_end_seconds: float
    video_duration_seconds: float

    @property
    def answer_duration_seconds(self) -> float:
        return self.answer_end_seconds - self.answer_start_seconds


@dataclass(frozen=True)
class OfficialMedVidQADataset:
    """Video-disjoint official train, validation, and test partitions."""

    train: tuple[MedVidQASample, ...]
    validation: tuple[MedVidQASample, ...]
    test: tuple[MedVidQASample, ...]

    @classmethod
    def load(cls, dataset_dir: Path, *, validate_official_counts: bool = True):
        dataset = cls(
            train=load_official_split(dataset_dir / "train.json"),
            validation=load_official_split(dataset_dir / "val.json"),
            test=load_official_split(dataset_dir / "test.json"),
        )
        dataset.validate(validate_official_counts=validate_official_counts)
        return dataset

    def validate(self, *, validate_official_counts: bool = True) -> None:
        splits = {
            "train": self.train,
            "val": self.validation,
            "test": self.test,
        }
        if validate_official_counts:
            for name, samples in splits.items():
                if len(samples) != OFFICIAL_SPLIT_SIZES[name]:
                    raise ValueError(
                        f"Official {name} split must contain "
                        f"{OFFICIAL_SPLIT_SIZES[name]} questions; found {len(samples)}"
                    )
                video_count = len({sample.video_id for sample in samples})
                if video_count != OFFICIAL_VIDEO_COUNTS[name]:
                    raise ValueError(
                        f"Official {name} split must contain "
                        f"{OFFICIAL_VIDEO_COUNTS[name]} videos; found {video_count}"
                    )

        video_sets = {
            name: {sample.video_id for sample in samples} for name, samples in splits.items()
        }
        for left, right in (("train", "val"), ("train", "test"), ("val", "test")):
            overlap = video_sets[left] & video_sets[right]
            if overlap:
                raise ValueError(
                    f"MedVidQA video leakage between {left} and {right}: "
                    f"{len(overlap)} overlapping video IDs"
                )


def load_official_split(path: Path) -> tuple[MedVidQASample, ...]:
    """Load a split without filtering or modifying the paper's examples."""
    records = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise TypeError(f"MedVidQA split must be a JSON list: {path}")
    return tuple(parse_medvidqa_sample(record, path) for record in records)


def parse_medvidqa_sample(
    record: dict[str, Any],
    source: Path,
) -> MedVidQASample:
    start = timestamp_seconds(record, "answer_start_second", "answer_start")
    end = timestamp_seconds(record, "answer_end_second", "answer_end")
    if start < 0 or end <= start:
        raise ValueError(
            f"Invalid answer interval for sample {record.get('sample_id')} in {source}"
        )

    video_duration = float(record.get("video_length", end))
    if video_duration < end:
        raise ValueError(
            f"Answer ends after video for sample {record.get('sample_id')} in {source}"
        )

    return MedVidQASample(
        sample_id=str(record["sample_id"]),
        question=str(record["question"]).strip(),
        video_id=str(record["video_id"]).strip(),
        answer_start_seconds=start,
        answer_end_seconds=end,
        video_duration_seconds=video_duration,
    )


def timestamp_seconds(
    record: dict[str, Any],
    numeric_field: str,
    formatted_field: str,
) -> float:
    value = record.get(numeric_field)
    if value is not None:
        return float(value)

    formatted = record.get(formatted_field)
    if isinstance(formatted, int | float):
        return float(formatted)
    if not isinstance(formatted, str) or not formatted.strip():
        raise ValueError(f"Missing timestamp field {numeric_field}")

    parts = [float(part) for part in formatted.strip().split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        return minutes * 60 + seconds
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return hours * 3600 + minutes * 60 + seconds
    raise ValueError(f"Unsupported timestamp format: {formatted}")
