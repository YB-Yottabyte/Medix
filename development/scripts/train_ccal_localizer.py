"""Train the paper-based CCAL localization baseline."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import platform
from pathlib import Path

from backend.temporal_localization.ccal import TransformersCCALSpanPredictor
from backend.transcripts import CachedTranscriptRepository
from development.evaluation.ccal_training import (
    CCALBatchEncoder,
    CCALTrainer,
    CCALTrainingExampleBuilder,
)
from development.evaluation.medvidqa_dataset import load_official_split

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
LONGFORMER_REVISION = "7a2d50a05513897192e79ea7c750493795d7cec0"
BART_REVISION = "aadd2ab0ae0c8268c7c9693540e9904811f36177"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_training_transcripts(cache_dir: Path, video_ids: set[str]) -> str:
    digest = hashlib.sha256()
    for video_id in sorted(video_ids):
        path = cache_dir / f"{video_id}.json"
        digest.update(video_id.encode("utf-8"))
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


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
    parser.add_argument("--span-revision", default=LONGFORMER_REVISION)
    parser.add_argument("--question-model", default="facebook/bart-base")
    parser.add_argument("--question-revision", default=BART_REVISION)
    parser.add_argument("--max-length", type=int, default=4096)
    parser.add_argument("--document-stride", type=int, default=256)
    parser.add_argument("--max-answer-tokens", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--cycle-loss-weight", type=float, default=1.0)
    parser.add_argument("--minimum-examples", type=int, default=100)
    parser.add_argument("--allow-small-training-set", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    training_samples = load_official_split(args.dataset_dir / "train.json")
    examples, rejected = CCALTrainingExampleBuilder(
        CachedTranscriptRepository(args.transcript_cache)
    ).from_samples(training_samples)
    aligned_example_count = len(examples)
    import torch
    import transformers
    from transformers import (
        AutoModelForQuestionAnswering,
        AutoModelForSeq2SeqLM,
        AutoTokenizer,
    )

    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = TransformersCCALSpanPredictor._default_device()
    span_tokenizer = AutoTokenizer.from_pretrained(
        args.span_model, revision=args.span_revision, use_fast=True
    )
    question_tokenizer = AutoTokenizer.from_pretrained(
        args.question_model, revision=args.question_revision
    )
    encoder = CCALBatchEncoder(
        span_tokenizer=span_tokenizer,
        question_tokenizer=question_tokenizer,
        max_length=args.max_length,
        document_stride=args.document_stride,
    )
    examples, tokenizer_rejected = encoder.filter_unrepresentable_answers(examples)
    LOGGER.info(
        "CCAL training data preflight: %d transcript-aligned, %d fit one tokenizer window, "
        "%d excluded because the annotated answer span exceeds a window",
        aligned_example_count,
        len(examples),
        len(tokenizer_rejected),
    )
    if len(examples) < args.minimum_examples and not args.allow_small_training_set:
        raise ValueError(
            f"Only {len(examples)} transcript-aligned training examples fit a tokenizer "
            f"window; at least {args.minimum_examples} are required. "
            f"{len(tokenizer_rejected)} aligned examples had answer spans too long for "
            "one window. Cache more training transcripts or review the rejected IDs."
        )

    span_model = AutoModelForQuestionAnswering.from_pretrained(
        args.span_model, revision=args.span_revision
    )
    question_model = AutoModelForSeq2SeqLM.from_pretrained(
        args.question_model, revision=args.question_revision
    )
    trainer = CCALTrainer(
        span_model=span_model,
        question_model=question_model,
        encoder=encoder,
        device=device,
        learning_rate=args.learning_rate,
        cycle_loss_weight=args.cycle_loss_weight,
        seed=args.seed,
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
        "span_base_revision": args.span_revision,
        "question_base_model": args.question_model,
        "question_base_revision": args.question_revision,
        "max_length": args.max_length,
        "document_stride": args.document_stride,
        "max_answer_tokens": args.max_answer_tokens,
        "seed": args.seed,
        "cycle_loss_weight": args.cycle_loss_weight,
        "training_dataset": {
            "path": str(args.dataset_dir / "train.json"),
            "sha256": sha256_file(args.dataset_dir / "train.json"),
            "official_training_questions": len(training_samples),
            "aligned_examples": aligned_example_count,
            "tokenizer_usable_examples": len(examples),
            "rejected_examples": len(rejected),
            "tokenizer_unrepresentable_examples": [
                {"sample_id": sample_id, "reason": reason}
                for sample_id, reason in tokenizer_rejected
            ],
            "transcript_video_count": len({example.video_id for example in examples}),
            "transcript_cache_path": str(args.transcript_cache),
            "used_transcripts_sha256": sha256_training_transcripts(
                args.transcript_cache,
                {example.video_id for example in examples},
            ),
        },
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "device": device,
        },
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
