"""Training examples and inference helpers for joint video-moment reranking."""

from __future__ import annotations

import math
import random
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING

from backend.transcripts import TranscriptUnavailableError
from development.evaluation.metrics import interval_iou

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping, Sequence

    from backend.domain import TranscriptCue
    from backend.transcripts import TranscriptRepository
    from development.evaluation.medvidqa_dataset import MedVidQASample


@dataclass(frozen=True)
class MomentWindow:
    video_id: str
    start_seconds: float
    end_seconds: float
    text: str


@dataclass(frozen=True)
class PairwiseMomentExample:
    sample_id: str
    question: str
    positive_video_id: str
    positive_document: str
    negative_video_id: str
    negative_document: str
    negative_kind: str


@dataclass(frozen=True)
class PairwiseDatasetSummary:
    official_samples: int
    usable_samples: int
    skipped_samples: tuple[str, ...]
    missing_transcript_samples: int
    no_overlapping_window_samples: int
    pairs: int
    within_video_pairs: int
    cross_video_pairs: int
    videos_with_windows: int


def build_moment_windows(
    video_id: str,
    cues: tuple[TranscriptCue, ...],
    duration_seconds: float,
    *,
    window_sizes: Sequence[float] = (30.0, 60.0, 90.0),
    stride_ratio: float = 0.5,
) -> tuple[MomentWindow, ...]:
    """Create deterministic multi-scale windows without reading answer labels."""
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")
    if not window_sizes or any(size <= 0 for size in window_sizes):
        raise ValueError("window sizes must be positive")
    if not 0 < stride_ratio <= 1:
        raise ValueError("stride_ratio must be in (0, 1]")

    windows = {}
    for requested_size in sorted({float(size) for size in window_sizes}):
        size = min(requested_size, duration_seconds)
        stride = max(size * stride_ratio, 1.0)
        last_start = max(duration_seconds - size, 0.0)
        starts = list(_float_range(last_start, stride))
        if not starts or starts[-1] < last_start:
            starts.append(last_start)
        for start in sorted({min(value, last_start) for value in starts}):
            end = min(start + size, duration_seconds)
            text = " ".join(
                cue.text.strip()
                for cue in cues
                if cue.text.strip() and cue.end_seconds > start and cue.start_seconds < end
            ).strip()
            if text:
                key = (round(start, 6), round(end, 6), text)
                windows[key] = MomentWindow(
                    video_id=video_id,
                    start_seconds=start,
                    end_seconds=end,
                    text=text,
                )
    return tuple(
        windows[key] for key in sorted(windows, key=lambda item: (item[0], item[1], item[2]))
    )


def select_gold_window(
    sample: MedVidQASample,
    windows: Sequence[MomentWindow],
) -> MomentWindow:
    if not windows:
        raise ValueError(f"No transcript windows for sample {sample.sample_id}")
    return max(
        windows,
        key=lambda window: (
            interval_iou(
                sample.answer_start_seconds,
                sample.answer_end_seconds,
                window.start_seconds,
                window.end_seconds,
            ),
            lexical_overlap(sample.question, window.text),
            -(window.end_seconds - window.start_seconds),
            -window.start_seconds,
        ),
    )


def pair_document(title: str, window: MomentWindow) -> str:
    normalized_title = title.strip() or window.video_id
    return f"Title: {normalized_title}\nTranscript window: {window.text}"


def lexical_overlap(query: str, candidate: str) -> float:
    query_tokens = _tokens(query)
    if not query_tokens:
        return 0.0
    return len(query_tokens & _tokens(candidate)) / len(query_tokens)


def build_pairwise_training_examples(
    samples: Sequence[MedVidQASample],
    *,
    repository: TranscriptRepository,
    titles: Mapping[str, str],
    window_sizes: Sequence[float] = (30.0, 60.0, 90.0),
    stride_ratio: float = 0.5,
    within_video_negatives: int = 2,
    cross_video_negatives: int = 2,
    seed: int = 42,
) -> tuple[tuple[PairwiseMomentExample, ...], PairwiseDatasetSummary]:
    """Build deterministic train-only positive/hard-negative ranking pairs."""
    if within_video_negatives < 0 or cross_video_negatives < 0:
        raise ValueError("negative counts must not be negative")
    if within_video_negatives + cross_video_negatives < 1:
        raise ValueError("at least one negative is required")

    samples_by_video: dict[str, list[MedVidQASample]] = defaultdict(list)
    for sample in samples:
        samples_by_video[sample.video_id].append(sample)

    windows_by_video: dict[str, tuple[MomentWindow, ...]] = {}
    for video_id, video_samples in sorted(samples_by_video.items()):
        duration = max(sample.video_duration_seconds for sample in video_samples)
        try:
            cues = repository.load(video_id)
        except TranscriptUnavailableError:
            continue
        windows = build_moment_windows(
            video_id,
            cues,
            duration,
            window_sizes=window_sizes,
            stride_ratio=stride_ratio,
        )
        if windows:
            windows_by_video[video_id] = windows

    descriptor_tokens = {
        video_id: _tokens(
            " ".join(
                [titles.get(video_id, video_id)]
                + [sample.question for sample in samples_by_video[video_id]]
            )
        )
        for video_id in windows_by_video
    }
    token_to_videos: dict[str, set[str]] = defaultdict(set)
    for video_id, tokens in descriptor_tokens.items():
        for token in tokens:
            token_to_videos[token].add(video_id)

    generator = random.Random(seed)  # noqa: S311 - deterministic experiment sampling
    pairs = []
    skipped = []
    missing_transcript_count = 0
    no_overlap_count = 0
    within_count = 0
    cross_count = 0
    for sample in samples:
        own_windows = windows_by_video.get(sample.video_id)
        if not own_windows:
            skipped.append(sample.sample_id)
            missing_transcript_count += 1
            continue
        positive = select_gold_window(sample, own_windows)
        positive_iou = interval_iou(
            sample.answer_start_seconds,
            sample.answer_end_seconds,
            positive.start_seconds,
            positive.end_seconds,
        )
        if positive_iou <= 0:
            skipped.append(sample.sample_id)
            no_overlap_count += 1
            continue
        positive_document = pair_document(titles.get(sample.video_id, sample.video_id), positive)

        within_candidates = sorted(
            (
                window
                for window in own_windows
                if interval_iou(
                    sample.answer_start_seconds,
                    sample.answer_end_seconds,
                    window.start_seconds,
                    window.end_seconds,
                )
                < 0.1
            ),
            key=lambda window: (
                -lexical_overlap(sample.question, window.text),
                window.start_seconds,
                window.end_seconds,
            ),
        )
        for negative in within_candidates[:within_video_negatives]:
            pairs.append(
                PairwiseMomentExample(
                    sample_id=sample.sample_id,
                    question=sample.question,
                    positive_video_id=sample.video_id,
                    positive_document=positive_document,
                    negative_video_id=sample.video_id,
                    negative_document=pair_document(
                        titles.get(sample.video_id, sample.video_id), negative
                    ),
                    negative_kind="within_video",
                )
            )
            within_count += 1

        query_tokens = _tokens(sample.question)
        candidate_video_ids = set().union(
            *(token_to_videos.get(token, set()) for token in query_tokens)
        )
        candidate_video_ids.discard(sample.video_id)
        ranked_video_ids = sorted(
            candidate_video_ids,
            key=lambda video_id: (
                -len(query_tokens & descriptor_tokens[video_id]),
                video_id,
            ),
        )
        remaining_video_ids = sorted(set(windows_by_video) - {sample.video_id})
        generator.shuffle(remaining_video_ids)
        for video_id in remaining_video_ids:
            if video_id not in candidate_video_ids:
                ranked_video_ids.append(video_id)
        for video_id in ranked_video_ids[:cross_video_negatives]:
            negative = max(
                windows_by_video[video_id],
                key=lambda window: (
                    lexical_overlap(sample.question, window.text),
                    -window.start_seconds,
                ),
            )
            pairs.append(
                PairwiseMomentExample(
                    sample_id=sample.sample_id,
                    question=sample.question,
                    positive_video_id=sample.video_id,
                    positive_document=positive_document,
                    negative_video_id=video_id,
                    negative_document=pair_document(titles.get(video_id, video_id), negative),
                    negative_kind="cross_video",
                )
            )
            cross_count += 1

    usable_samples = len(samples) - len(skipped)
    return tuple(pairs), PairwiseDatasetSummary(
        official_samples=len(samples),
        usable_samples=usable_samples,
        skipped_samples=tuple(skipped),
        missing_transcript_samples=missing_transcript_count,
        no_overlapping_window_samples=no_overlap_count,
        pairs=len(pairs),
        within_video_pairs=within_count,
        cross_video_pairs=cross_count,
        videos_with_windows=len(windows_by_video),
    )


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _float_range(last_start: float, stride: float) -> Iterable[float]:
    steps = int(math.floor(last_start / stride))
    for index in range(steps + 1):
        yield index * stride
