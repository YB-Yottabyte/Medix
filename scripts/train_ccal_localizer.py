"""Train the paper-based CCAL localization baseline."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from backend.temporal_localization.ccal import TransformersCCALSpanPredictor
from backend.transcripts import CachedTranscriptRepository
from evaluation.ccal_training import (
    CCALBatchEncoder,
    CCALTrainer,
    CCALTrainingExampleBuilder,
)
from evaluation.medvidqa_dataset import OfficialMedVidQADataset

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "data" / "models" / "ccal",
    )
    parser.add_argument("--span-model", default="allenai/longformer-base-4096")
    parser.add_argument("--question-model", default="facebook/bart-base")
    parser.add_argument("--max-length", type=int, default=4096)
    parser.add_argument("--document-stride", type=int, default=256)
    parser.add_argument("--max-answer-tokens", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--cycle-loss-weight", type=float, default=1.0)
    parser.add_argument("--minimum-examples", type=int, default=100)
    parser.add_argument("--allow-small-training-set", action="store_true")
    args = parser.parse_args()

    examples, rejected = CCALTrainingExampleBuilder(
        CachedTranscriptRepository(args.transcript_cache)
    ).from_samples(OfficialMedVidQADataset.load(args.dataset_dir).train)
    if len(examples) < args.minimum_examples and not args.allow_small_training_set:
        raise ValueError(
            f"Only {len(examples)} transcript-aligned training examples are available; "
            f"at least {args.minimum_examples} are required. Cache more training "
            "videos/transcripts or pass --allow-small-training-set for a non-reportable smoke run."
        )

    from transformers import (
        AutoModelForQuestionAnswering,
        AutoModelForSeq2SeqLM,
        AutoTokenizer,
    )

    device = TransformersCCALSpanPredictor._default_device()
    span_tokenizer = AutoTokenizer.from_pretrained(args.span_model, use_fast=True)
    question_tokenizer = AutoTokenizer.from_pretrained(args.question_model, use_fast=True)
    span_model = AutoModelForQuestionAnswering.from_pretrained(args.span_model)
    question_model = AutoModelForSeq2SeqLM.from_pretrained(args.question_model)
    encoder = CCALBatchEncoder(
        span_tokenizer=span_tokenizer,
        question_tokenizer=question_tokenizer,
        max_length=args.max_length,
        document_stride=args.document_stride,
    )
    trainer = CCALTrainer(
        span_model=span_model,
        question_model=question_model,
        encoder=encoder,
        device=device,
        learning_rate=args.learning_rate,
        cycle_loss_weight=args.cycle_loss_weight,
    )
    summary = trainer.train(
        examples,
        epochs=args.epochs,
        batch_size=args.batch_size,
    )
    metadata = {
        "schema_version": 1,
        "model_name": "ccal-longformer-bart-medvidqa-v1",
        "span_base_model": args.span_model,
        "question_base_model": args.question_model,
        "max_length": args.max_length,
        "document_stride": args.document_stride,
        "max_answer_tokens": args.max_answer_tokens,
        "cycle_loss_weight": args.cycle_loss_weight,
        "training_summary": {
            "examples": summary.examples,
            "unavailable_or_unaligned_examples": len(rejected),
            "epochs": summary.epochs,
            "mean_total_loss": summary.mean_total_loss,
            "mean_span_loss": summary.mean_span_loss,
            "mean_cycle_loss": summary.mean_cycle_loss,
        },
    }
    trainer.save(
        args.output_dir,
        span_tokenizer=span_tokenizer,
        question_tokenizer=question_tokenizer,
        metadata=metadata,
    )
    LOGGER.info("CCAL training summary: %s", json.dumps(metadata, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
