"""Cycle-consistent transcript span localization.

The localizer is an inference adapter: training remains under ``evaluation`` so
benchmark labels cannot leak into runtime composition.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

import numpy as np

from backend.domain import LocalizationRequest, TemporalSegment
from backend.transcripts import TranscriptUnavailableError

if TYPE_CHECKING:
    from backend.domain import TranscriptCue
    from backend.transcripts import TranscriptRepository


@dataclass(frozen=True)
class TranscriptCharacterSpan:
    """Character and timestamp boundaries for one cue in joined context."""

    character_start: int
    character_end: int
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True)
class TranscriptDocument:
    """A transcript string retaining a lossless mapping back to timestamps."""

    text: str
    spans: tuple[TranscriptCharacterSpan, ...]

    @classmethod
    def from_cues(cls, cues: tuple[TranscriptCue, ...]) -> TranscriptDocument:
        parts = []
        spans = []
        cursor = 0
        for cue in cues:
            if parts:
                parts.append(" ")
                cursor += 1
            text = cue.text.strip()
            start = cursor
            parts.append(text)
            cursor += len(text)
            spans.append(
                TranscriptCharacterSpan(
                    character_start=start,
                    character_end=cursor,
                    start_seconds=cue.start_seconds,
                    end_seconds=cue.end_seconds,
                )
            )
        return cls(text="".join(parts), spans=tuple(spans))

    def timestamps_for_characters(
        self,
        start_character: int,
        end_character: int,
    ) -> tuple[float, float]:
        if start_character < 0 or end_character <= start_character:
            raise ValueError("predicted character span is invalid")
        overlapping = tuple(
            span
            for span in self.spans
            if span.character_end > start_character and span.character_start < end_character
        )
        if not overlapping:
            raise ValueError("predicted character span does not overlap transcript cues")
        return overlapping[0].start_seconds, overlapping[-1].end_seconds


@dataclass(frozen=True)
class CCALSpanPrediction:
    start_seconds: float
    end_seconds: float
    span_confidence: float
    cycle_consistency: float
    localization_score: float
    reconstructed_question: str | None = None


class CCALSpanPredictor(Protocol):
    model_name: str

    def predict(
        self,
        question: str,
        cues: tuple[TranscriptCue, ...],
    ) -> CCALSpanPrediction: ...


class CCALSpanLocalizer:
    """Expose a trained CCAL predictor through Medix's localizer contract."""

    def __init__(
        self,
        *,
        repository: TranscriptRepository,
        predictor: CCALSpanPredictor,
    ):
        self.repository = repository
        self.predictor = predictor
        self.model_name = predictor.model_name

    def localize(self, request: LocalizationRequest) -> TemporalSegment:
        cues = self.repository.load(request.video_id)
        prediction = self.predictor.predict(request.question, cues)
        start = max(0.0, min(prediction.start_seconds, request.duration_seconds))
        end = max(start, min(prediction.end_seconds, request.duration_seconds))
        if end <= start:
            raise TranscriptUnavailableError(
                f"CCAL produced an invalid interval for {request.video_id}"
            )
        return TemporalSegment(
            video_id=request.video_id,
            start_seconds=start,
            end_seconds=end,
            localization_score=prediction.localization_score,
            model_name=self.model_name,
        )


class TransformersCCALSpanPredictor:
    """Long-context QA span predictor with question-reconstruction scoring."""

    def __init__(
        self,
        *,
        span_tokenizer: Any,
        span_model: Any,
        question_tokenizer: Any,
        question_model: Any,
        model_name: str,
        device: str,
        max_length: int = 4096,
        document_stride: int = 256,
        max_answer_tokens: int = 512,
        candidate_tokens: int = 24,
        cycle_weight: float = 0.25,
    ):
        if max_length < 16 or document_stride < 0:
            raise ValueError("CCAL token limits are invalid")
        if max_answer_tokens < 1 or candidate_tokens < 1:
            raise ValueError("CCAL candidate limits must be positive")
        if not 0 <= cycle_weight <= 1:
            raise ValueError("cycle_weight must be between zero and one")
        self.span_tokenizer = span_tokenizer
        self.span_model = span_model.to(device).eval()
        self.question_tokenizer = question_tokenizer
        self.question_model = question_model.to(device).eval()
        self.model_name = model_name
        self.device = device
        self.max_length = max_length
        self.document_stride = document_stride
        self.max_answer_tokens = max_answer_tokens
        self.candidate_tokens = candidate_tokens
        self.cycle_weight = cycle_weight

    @classmethod
    def from_checkpoint(
        cls,
        checkpoint: str | Path,
        *,
        device: str | None = None,
        cycle_weight: float = 0.25,
    ) -> TransformersCCALSpanPredictor:
        """Load only a complete trained checkpoint; never use random weights."""
        checkpoint_path = Path(checkpoint)
        span_path = checkpoint_path / "span_model"
        question_path = checkpoint_path / "question_model"
        metadata_path = checkpoint_path / "metadata.json"
        missing = [
            str(path) for path in (span_path, question_path, metadata_path) if not path.exists()
        ]
        if missing:
            raise FileNotFoundError("CCAL checkpoint is incomplete; missing: " + ", ".join(missing))

        from transformers import (
            AutoModelForQuestionAnswering,
            AutoModelForSeq2SeqLM,
            AutoTokenizer,
        )

        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        runtime_device = device or cls._default_device()
        return cls(
            span_tokenizer=AutoTokenizer.from_pretrained(span_path, use_fast=True),
            span_model=AutoModelForQuestionAnswering.from_pretrained(span_path),
            question_tokenizer=AutoTokenizer.from_pretrained(question_path, use_fast=True),
            question_model=AutoModelForSeq2SeqLM.from_pretrained(question_path),
            model_name=str(metadata.get("model_name", "ccal-span-localizer-v1")),
            device=runtime_device,
            max_length=int(metadata.get("max_length", 4096)),
            document_stride=int(metadata.get("document_stride", 256)),
            max_answer_tokens=int(metadata.get("max_answer_tokens", 512)),
            cycle_weight=cycle_weight,
        )

    def predict(
        self,
        question: str,
        cues: tuple[TranscriptCue, ...],
    ) -> CCALSpanPrediction:
        import torch

        document = TranscriptDocument.from_cues(cues)
        if not document.text:
            raise TranscriptUnavailableError("CCAL requires a non-empty transcript")
        encoded = self.span_tokenizer(
            question,
            document.text,
            truncation="only_second",
            max_length=self.max_length,
            stride=self.document_stride,
            return_overflowing_tokens=True,
            return_offsets_mapping=True,
            padding=True,
            return_tensors="pt",
        )
        offsets = encoded.pop("offset_mapping")
        encoded.pop("overflow_to_sample_mapping", None)
        sequence_ids = [encoded.sequence_ids(index) for index in range(offsets.shape[0])]
        global_attention_mask = torch.zeros_like(encoded["input_ids"])
        for feature_index, feature_sequence_ids in enumerate(sequence_ids):
            global_attention_mask[feature_index, 0] = 1
            for token_index, sequence_id in enumerate(feature_sequence_ids):
                if sequence_id == 0:
                    global_attention_mask[feature_index, token_index] = 1
        encoded["global_attention_mask"] = global_attention_mask
        model_inputs = {
            key: value.to(self.device) for key, value in encoded.items() if hasattr(value, "to")
        }
        with torch.inference_mode():
            output = self.span_model(**model_inputs)

        best: tuple[float, int, int, int, float] | None = None
        for feature_index, feature_sequence_ids in enumerate(sequence_ids):
            valid = [
                index
                for index, sequence_id in enumerate(feature_sequence_ids)
                if sequence_id == 1
                and int(offsets[feature_index, index, 1]) > int(offsets[feature_index, index, 0])
            ]
            if not valid:
                continue
            starts = output.start_logits[feature_index].detach().float().cpu().numpy()
            ends = output.end_logits[feature_index].detach().float().cpu().numpy()
            start_probabilities = self._masked_softmax(starts, valid)
            end_probabilities = self._masked_softmax(ends, valid)
            top_starts = sorted(valid, key=lambda index: starts[index], reverse=True)[
                : self.candidate_tokens
            ]
            top_ends = sorted(valid, key=lambda index: ends[index], reverse=True)[
                : self.candidate_tokens
            ]
            for start_index in top_starts:
                for end_index in top_ends:
                    if not start_index <= end_index:
                        continue
                    if end_index - start_index + 1 > self.max_answer_tokens:
                        continue
                    confidence = math.sqrt(
                        start_probabilities[start_index] * end_probabilities[end_index]
                    )
                    logit_score = float(starts[start_index] + ends[end_index])
                    candidate = (
                        logit_score,
                        feature_index,
                        start_index,
                        end_index,
                        confidence,
                    )
                    if best is None or candidate[0] > best[0]:
                        best = candidate
        if best is None:
            raise TranscriptUnavailableError("CCAL could not produce a transcript span")

        _, feature_index, start_index, end_index, span_confidence = best
        start_character = int(offsets[feature_index, start_index, 0])
        end_character = int(offsets[feature_index, end_index, 1])
        start_seconds, end_seconds = document.timestamps_for_characters(
            start_character,
            end_character,
        )
        answer_text = document.text[start_character:end_character].strip()
        cycle_score, reconstructed = self._cycle_score(answer_text, question)
        score = float(
            np.clip(
                (1.0 - self.cycle_weight) * span_confidence + self.cycle_weight * cycle_score,
                0.0,
                1.0,
            )
        )
        return CCALSpanPrediction(
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            span_confidence=float(np.clip(span_confidence, 0.0, 1.0)),
            cycle_consistency=cycle_score,
            localization_score=score,
            reconstructed_question=reconstructed,
        )

    def _cycle_score(self, answer_text: str, question: str) -> tuple[float, str | None]:
        import torch

        inputs = self.question_tokenizer(
            answer_text,
            max_length=512,
            truncation=True,
            return_tensors="pt",
        )
        labels = self.question_tokenizer(
            text_target=question,
            max_length=64,
            truncation=True,
            return_tensors="pt",
        )["input_ids"]
        model_inputs = {key: value.to(self.device) for key, value in inputs.items()}
        with torch.inference_mode():
            output = self.question_model(
                **model_inputs,
                labels=labels.to(self.device),
            )
            generated = self.question_model.generate(
                **model_inputs,
                max_new_tokens=32,
                num_beams=2,
            )
        score = float(np.clip(math.exp(-float(output.loss)), 0.0, 1.0))
        reconstructed = self.question_tokenizer.batch_decode(
            generated,
            skip_special_tokens=True,
        )[0].strip()
        return score, reconstructed or None

    @staticmethod
    def _masked_softmax(logits: np.ndarray, valid: list[int]) -> np.ndarray:
        result = np.zeros_like(logits, dtype=np.float64)
        values = logits[valid].astype(np.float64)
        values = np.exp(values - np.max(values))
        result[valid] = values / max(float(values.sum()), np.finfo(np.float64).eps)
        return result

    @staticmethod
    def _default_device() -> str:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"
