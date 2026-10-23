"""Label-free multi-scale transcript candidates and conservative boundary refinement."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from collections.abc import Sequence

    from backend.domain import TranscriptCue


@dataclass(frozen=True)
class AdaptiveWindow:
    start: float
    end: float
    text: str
    scale: float


def build_adaptive_windows(
    cues: Sequence[TranscriptCue],
    duration: float,
    sizes: tuple[float, ...] = (30.0, 60.0, 90.0),
) -> tuple[AdaptiveWindow, ...]:
    """Generate half-overlapping windows, retaining the existing 90/45 baseline grid."""
    if duration <= 0 or not sizes or any(size <= 0 for size in sizes):
        raise ValueError("duration and window sizes must be positive")
    result = []
    for requested in sorted(set(sizes)):
        width = min(requested, duration)
        last = max(0.0, duration - width)
        starts = sorted(
            {min(float(s), last) for s in np.arange(0, last + requested / 2, requested / 2)}
        )
        for start in starts:
            end = min(duration, start + width)
            text = " ".join(
                c.text for c in cues if c.start_seconds < end and c.end_seconds > start
            ).strip()
            if text:
                result.append(AdaptiveWindow(start, end, text, requested))
    return tuple(result)


def refine_to_cues(
    window: AdaptiveWindow, cues: Sequence[TranscriptCue], duration: float
) -> tuple[float, float]:
    """Snap each edge to the nearest cue boundary within ten seconds, without labels."""
    starts = [c.start_seconds for c in cues if abs(c.start_seconds - window.start) <= 10]
    ends = [c.end_seconds for c in cues if abs(c.end_seconds - window.end) <= 10]
    start = min(starts, key=lambda value: abs(value - window.start)) if starts else window.start
    end = min(ends, key=lambda value: abs(value - window.end)) if ends else window.end
    start, end = max(0.0, start), min(duration, end)
    return (start, end) if end > start else (window.start, window.end)


def select_window(
    windows: Sequence[AdaptiveWindow],
    dense: np.ndarray,
    lexical: np.ndarray,
    *,
    mode: str,
) -> tuple[int, float]:
    """Keep confidence on a fixed scale; never normalize separately per video."""
    if len(windows) != len(dense) or len(windows) != len(lexical):
        raise ValueError("Scores must match candidate windows")
    if mode not in {"fixed90", "fixed60", "adaptive", "adaptive_lexical", "refined"}:
        raise ValueError(f"Unknown localization mode: {mode}")
    indices = [
        i
        for i, w in enumerate(windows)
        if mode not in {"fixed90", "fixed60"} or w.scale == (90 if mode == "fixed90" else 60)
    ]
    if not indices:
        raise ValueError("No candidate windows for the selected mode")
    scores = dense if mode in {"fixed90", "fixed60", "adaptive"} else 0.85 * dense + 0.15 * lexical
    # Descending index on ties reproduces the existing localizer's reversed argsort.
    best = max(indices, key=lambda i: (float(scores[i]), i))
    return best, float(scores[best])
