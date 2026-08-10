"""Training data alignment and optimization for the CCAL baseline."""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from itertools import chain
from typing import TYPE_CHECKING, Any

from backend.temporal_localization.ccal import TranscriptDocument

if TYPE_CHECKING:
    from collections.abc import Iterable
    from pathlib import Path

    from backend.domain import TranscriptCue
    from backend.transcripts import TranscriptRepository
    from evaluation.medvidqa_dataset import MedVidQASample


@dataclass(frozen=True)
class CCALTrainingExample:
    sample_id: str
    question: str
    video_id: str
    context: str
    answer_text: str
    answer_character_start: int
    answer_character_end: int
    answer_start_seconds: float
    answer_end_seconds: float


class CCALTrainingExampleBuilder:
    """Map expert timestamps to transcript character spans without guessing."""

    def __init__(self, transcript_repository: TranscriptRepository):
        self.transcript_repository = transcript_repository

    def from_manifest(self, manifest_path: Path) -> tuple[CCALTrainingExample, ...]:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        samples = payload.get("samples") if isinstance(payload, dict) else None
        if not isinstance(samples, list):
            raise TypeError("supported collection manifest must contain samples")
        examples = []
        for sample in samples:
            if not isinstance(sample, dict) or sample.get("split") != "train":
                continue
            examples.append(
                self.build(
                    sample_id=str(sample["sample_id"]),
                    question=str(sample["question"]),
                    video_id=str(sample["video_id"]),
                    answer_start_seconds=float(sample["expected_start_seconds"]),
                    answer_end_seconds=float(sample["expected_end_seconds"]),
                )
            )
        return tuple(examples)

    def from_samples(
        self,
        samples: Iterable[MedVidQASample],
    ) -> tuple[tuple[CCALTrainingExample, ...], tuple[str, ...]]:
        """Align transcript-covered samples from one caller-selected split."""
        from backend.transcripts import TranscriptUnavailableError

        examples = []
        rejected = []
        for sample in samples:
            try:
                examples.append(
                    self.build(
                        sample_id=sample.sample_id,
                        question=sample.question,
                        video_id=sample.video_id,
                        answer_start_seconds=sample.answer_start_seconds,
                        answer_end_seconds=sample.answer_end_seconds,
                    )
                )
            except (TranscriptUnavailableError, ValueError):
                rejected.append(sample.sample_id)
        return tuple(examples), tuple(rejected)

    def build(
        self,
        *,
        sample_id: str,
        question: str,
        video_id: str,
        answer_start_seconds: float,
        answer_end_seconds: float,
    ) -> CCALTrainingExample:
        cues = self.transcript_repository.load(video_id)
        document = TranscriptDocument.from_cues(cues)
        overlapping = self._overlapping_indices(
            cues,
            answer_start_seconds,
            answer_end_seconds,
        )
        if not overlapping:
            raise ValueError(f"answer timestamps do not overlap transcript for {sample_id}")
        first = document.spans[overlapping[0]]
        last = document.spans[overlapping[-1]]
        answer_text = document.text[first.character_start : last.character_end].strip()
        if not answer_text:
            raise ValueError(f"aligned answer text is empty for {sample_id}")
        return CCALTrainingExample(
            sample_id=sample_id,
            question=question.strip(),
            video_id=video_id,
            context=document.text,
            answer_text=answer_text,
            answer_character_start=first.character_start,
            answer_character_end=last.character_end,
            answer_start_seconds=first.start_seconds,
            answer_end_seconds=last.end_seconds,
        )

    @staticmethod
    def _overlapping_indices(
        cues: tuple[TranscriptCue, ...],
        start_seconds: float,
        end_seconds: float,
    ) -> tuple[int, ...]:
        return tuple(
            index
            for index, cue in enumerate(cues)
            if cue.end_seconds > start_seconds and cue.start_seconds < end_seconds
        )


class CCALBatchEncoder:
    """Create QA span labels and answer-to-question reconstruction labels."""

    def __init__(
        self,
        *,
        span_tokenizer: Any,
        question_tokenizer: Any,
        max_length: int = 4096,
        document_stride: int = 256,
        question_max_length: int = 64,
    ):
        self.span_tokenizer = span_tokenizer
        self.question_tokenizer = question_tokenizer
        self.max_length = max_length
        self.document_stride = document_stride
        self.question_max_length = question_max_length

    def encode(
        self,
        examples: list[CCALTrainingExample],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        import torch

        qa_features = [self._qa_feature(example) for example in examples]
        qa_batch = {
            key: torch.cat([feature[key] for feature in qa_features], dim=0)
            for key in qa_features[0]
        }
        qg_batch = self.question_tokenizer(
            [example.answer_text for example in examples],
            text_target=[example.question for example in examples],
            max_length=512,
            truncation=True,
            padding=True,
            return_tensors="pt",
        )
        labels = qg_batch["labels"]
        padding_id = self.question_tokenizer.pad_token_id
        if padding_id is not None:
            labels = labels.masked_fill(labels == padding_id, -100)
        qg_batch["labels"] = labels
        return qa_batch, dict(qg_batch)

    def _qa_feature(self, example: CCALTrainingExample) -> dict[str, Any]:
        encoded = self.span_tokenizer(
            example.question,
            example.context,
            truncation="only_second",
            max_length=self.max_length,
            stride=self.document_stride,
            return_overflowing_tokens=True,
            return_offsets_mapping=True,
            padding="max_length",
            return_tensors="pt",
        )
        offsets = encoded["offset_mapping"]
        selected = None
        for feature_index in range(offsets.shape[0]):
            sequence_ids = encoded.sequence_ids(feature_index)
            start_index = self._token_for_character(
                offsets[feature_index],
                sequence_ids,
                example.answer_character_start,
            )
            end_index = self._token_for_character(
                offsets[feature_index],
                sequence_ids,
                example.answer_character_end - 1,
            )
            if start_index is not None and end_index is not None:
                selected = (feature_index, start_index, end_index)
                break
        if selected is None:
            raise ValueError(
                f"No tokenized window contains the answer for sample {example.sample_id}"
            )
        feature_index, start_index, end_index = selected
        feature = {
            key: value[feature_index : feature_index + 1]
            for key, value in encoded.items()
            if key not in {"offset_mapping", "overflow_to_sample_mapping"}
        }
        import torch

        global_attention = torch.zeros_like(feature["input_ids"])
        global_attention[0, 0] = 1
        sequence_ids = encoded.sequence_ids(feature_index)
        for token_index, sequence_id in enumerate(sequence_ids):
            if sequence_id == 0:
                global_attention[0, token_index] = 1
        feature["global_attention_mask"] = global_attention
        feature["start_positions"] = torch.tensor([start_index])
        feature["end_positions"] = torch.tensor([end_index])
        return feature

    @staticmethod
    def _token_for_character(
        offsets: Any,
        sequence_ids: list[int | None],
        character: int,
    ) -> int | None:
        for index, sequence_id in enumerate(sequence_ids):
            start, end = (int(value) for value in offsets[index])
            if sequence_id == 1 and start <= character < end:
                return index
        return None


@dataclass(frozen=True)
class CCALTrainingSummary:
    examples: int
    epochs: int
    mean_total_loss: float
    mean_span_loss: float
    mean_cycle_loss: float


class CCALTrainer:
    """Optimize span prediction and question reconstruction jointly."""

    def __init__(
        self,
        *,
        span_model: Any,
        question_model: Any,
        encoder: CCALBatchEncoder,
        device: str,
        learning_rate: float = 5e-5,
        cycle_loss_weight: float = 1.0,
        seed: int = 42,
    ):
        if learning_rate <= 0 or cycle_loss_weight < 0:
            raise ValueError("CCAL optimization settings are invalid")
        self.span_model = span_model.to(device)
        self.question_model = question_model.to(device)
        self.encoder = encoder
        self.device = device
        self.learning_rate = learning_rate
        self.cycle_loss_weight = cycle_loss_weight
        self.seed = seed

    def train(
        self,
        examples: tuple[CCALTrainingExample, ...],
        *,
        epochs: int,
        batch_size: int,
    ) -> CCALTrainingSummary:
        import torch

        if not examples or epochs < 1 or batch_size < 1:
            raise ValueError("CCAL training requires examples, epochs, and batch size")
        optimizer = torch.optim.AdamW(
            chain(self.span_model.parameters(), self.question_model.parameters()),
            lr=self.learning_rate,
        )
        random_generator = random.Random(self.seed)  # noqa: S311 - experiment shuffling
        total_losses = []
        span_losses = []
        cycle_losses = []
        self.span_model.train()
        self.question_model.train()
        for _epoch in range(epochs):
            shuffled = list(examples)
            random_generator.shuffle(shuffled)
            for offset in range(0, len(shuffled), batch_size):
                batch = shuffled[offset : offset + batch_size]
                qa, qg = self.encoder.encode(batch)
                qa = {key: value.to(self.device) for key, value in qa.items()}
                qg = {key: value.to(self.device) for key, value in qg.items()}
                optimizer.zero_grad(set_to_none=True)
                span_loss = self.span_model(**qa).loss
                cycle_loss = self.question_model(**qg).loss
                loss = span_loss + self.cycle_loss_weight * cycle_loss
                loss.backward()
                optimizer.step()
                span_losses.append(float(span_loss.detach().cpu()))
                cycle_losses.append(float(cycle_loss.detach().cpu()))
                total_losses.append(float(loss.detach().cpu()))
        return CCALTrainingSummary(
            examples=len(examples),
            epochs=epochs,
            mean_total_loss=sum(total_losses) / len(total_losses),
            mean_span_loss=sum(span_losses) / len(span_losses),
            mean_cycle_loss=sum(cycle_losses) / len(cycle_losses),
        )

    def save(
        self,
        output_dir: Path,
        *,
        span_tokenizer: Any,
        question_tokenizer: Any,
        metadata: dict[str, object],
    ) -> None:
        span_path = output_dir / "span_model"
        question_path = output_dir / "question_model"
        self.span_model.save_pretrained(span_path)
        span_tokenizer.save_pretrained(span_path)
        self.question_model.save_pretrained(question_path)
        question_tokenizer.save_pretrained(question_path)
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "metadata.json").write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
