"""Temporal-localization contracts.

Concrete learned models belong in this package. Evaluation-only oracle and
random baselines live under ``evaluation`` so production composition cannot
select them accidentally.
"""

from backend.temporal_localization.base import TemporalLocalizer
from backend.temporal_localization.ccal import (
    CCALSpanLocalizer,
    CCALSpanPrediction,
    TranscriptDocument,
    TransformersCCALSpanPredictor,
)
from backend.temporal_localization.multimodal import (
    MultimodalLocalizationResult,
    MultimodalWindowLocalizer,
)
from backend.temporal_localization.transcript import TranscriptWindowLocalizer

__all__ = [
    "CCALSpanLocalizer",
    "CCALSpanPrediction",
    "MultimodalLocalizationResult",
    "MultimodalWindowLocalizer",
    "TemporalLocalizer",
    "TranscriptDocument",
    "TranscriptWindowLocalizer",
    "TransformersCCALSpanPredictor",
]
