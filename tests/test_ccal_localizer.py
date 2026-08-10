"""Tests for transcript alignment and the CCAL runtime adapter."""

from __future__ import annotations

from typing import ClassVar

import pytest

from backend.domain import LocalizationRequest, TranscriptCue
from backend.temporal_localization import (
    CCALSpanLocalizer,
    CCALSpanPrediction,
    TranscriptDocument,
)
from evaluation.ccal_training import CCALTrainingExampleBuilder
from evaluation.medvidqa_dataset import MedVidQASample


class FakeTranscriptRepository:
    cues: ClassVar[tuple[TranscriptCue, ...]] = (
        TranscriptCue(0.0, 2.0, "prepare the bandage"),
        TranscriptCue(2.0, 3.0, "apply direct pressure"),
        TranscriptCue(5.0, 2.0, "secure the dressing"),
    )

    def load(self, _video_id: str) -> tuple[TranscriptCue, ...]:
        return self.cues


class FakeCCALPredictor:
    model_name = "fake-ccal"

    def predict(
        self,
        _question: str,
        _cues: tuple[TranscriptCue, ...],
    ) -> CCALSpanPrediction:
        return CCALSpanPrediction(
            start_seconds=2.0,
            end_seconds=5.0,
            span_confidence=0.8,
            cycle_consistency=0.6,
            localization_score=0.75,
            reconstructed_question="How do I apply pressure?",
        )


def test_transcript_document_maps_character_span_to_cue_timestamps() -> None:
    document = TranscriptDocument.from_cues(FakeTranscriptRepository.cues)
    start = document.text.index("apply")
    end = start + len("apply direct pressure")

    assert document.timestamps_for_characters(start, end) == (2.0, 5.0)


def test_ccal_localizer_implements_temporal_localizer_contract() -> None:
    localizer = CCALSpanLocalizer(
        repository=FakeTranscriptRepository(),
        predictor=FakeCCALPredictor(),
    )

    segment = localizer.localize(
        LocalizationRequest(
            question="How do I apply pressure?",
            video_id="video-1",
            duration_seconds=7.0,
        )
    )

    assert segment.start_seconds == 2.0
    assert segment.end_seconds == 5.0
    assert segment.localization_score == 0.75
    assert segment.model_name == "fake-ccal"


def test_training_example_aligns_gold_timestamps_to_transcript_text() -> None:
    example = CCALTrainingExampleBuilder(FakeTranscriptRepository()).build(
        sample_id="1",
        question="How do I apply pressure?",
        video_id="video-1",
        answer_start_seconds=2.1,
        answer_end_seconds=4.9,
    )

    assert example.answer_text == "apply direct pressure"
    assert example.answer_start_seconds == 2.0
    assert example.answer_end_seconds == 5.0
    assert (
        example.context[example.answer_character_start : example.answer_character_end]
        == "apply direct pressure"
    )


def test_training_examples_use_caller_selected_samples() -> None:
    samples = (
        MedVidQASample(
            sample_id="train-1",
            question="How do I apply pressure?",
            video_id="video-1",
            answer_start_seconds=2.1,
            answer_end_seconds=4.9,
            video_duration_seconds=7.0,
        ),
    )

    examples, rejected = CCALTrainingExampleBuilder(FakeTranscriptRepository()).from_samples(
        samples
    )

    assert [example.sample_id for example in examples] == ["train-1"]
    assert rejected == ()


def test_ccal_checkpoint_must_be_complete(tmp_path) -> None:
    from backend.temporal_localization.ccal import TransformersCCALSpanPredictor

    with pytest.raises(FileNotFoundError, match="checkpoint is incomplete"):
        TransformersCCALSpanPredictor.from_checkpoint(tmp_path)
