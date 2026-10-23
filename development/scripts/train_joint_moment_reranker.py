"""Train a pairwise cross-encoder for joint video and temporal-window ranking."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import platform
import random
from dataclasses import asdict
from pathlib import Path

from backend.transcripts import CachedTranscriptRepository
from development.evaluation.joint_moment_reranker import build_pairwise_training_examples
from development.evaluation.medvidqa_dataset import load_official_split
from development.evaluation.video_catalog import load_video_documents

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--catalog",
        type=Path,
        default=PROJECT_ROOT / "data" / "medvidqa_video_catalog.json",
    )
    parser.add_argument("--transcript-cache", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default=MODEL_NAME)
    parser.add_argument("--revision", default=MODEL_REVISION)
    parser.add_argument("--window-sizes", nargs="+", type=float, default=(30, 60, 90))
    parser.add_argument("--stride-ratio", type=float, default=0.5)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--within-video-negatives", type=int, default=2)
    parser.add_argument("--cross-video-negatives", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite checkpoint: {args.output_dir}")
    if args.epochs < 1 or args.batch_size < 1 or args.learning_rate <= 0:
        raise ValueError("epochs, batch size, and learning rate must be positive")

    train_path = args.dataset_dir / "train.json"
    training_samples = load_official_split(train_path)
    catalog_payload = json.loads(args.catalog.read_text(encoding="utf-8"))
    titles = {
        document.video_id: document.title for document in load_video_documents(catalog_payload)
    }
    pairs, dataset_summary = build_pairwise_training_examples(
        training_samples,
        repository=CachedTranscriptRepository(args.transcript_cache),
        titles=titles,
        window_sizes=tuple(args.window_sizes),
        stride_ratio=args.stride_ratio,
        within_video_negatives=args.within_video_negatives,
        cross_video_negatives=args.cross_video_negatives,
        seed=args.seed,
    )
    if len(pairs) < 100:
        raise ValueError(f"Only {len(pairs)} pairwise examples are available")
    LOGGER.info("Pairwise training data: %s", json.dumps(asdict(dataset_summary), sort_keys=True))

    import torch
    import transformers
    from torch.nn import functional
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision, use_fast=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model,
        revision=args.revision,
        num_labels=1,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)

    indices = list(range(len(pairs)))
    generator = random.Random(args.seed)
    epoch_losses = []
    model.train()
    for epoch in range(args.epochs):
        generator.shuffle(indices)
        batch_losses = []
        for offset in range(0, len(indices), args.batch_size):
            batch = [pairs[index] for index in indices[offset : offset + args.batch_size]]
            questions = [example.question for example in batch]
            positive_inputs = tokenizer(
                questions,
                [example.positive_document for example in batch],
                max_length=args.max_length,
                truncation=True,
                padding=True,
                return_tensors="pt",
            )
            negative_inputs = tokenizer(
                questions,
                [example.negative_document for example in batch],
                max_length=args.max_length,
                truncation=True,
                padding=True,
                return_tensors="pt",
            )
            positive_inputs = {key: value.to(device) for key, value in positive_inputs.items()}
            negative_inputs = {key: value.to(device) for key, value in negative_inputs.items()}
            optimizer.zero_grad(set_to_none=True)
            positive_scores = model(**positive_inputs).logits.squeeze(-1)
            negative_scores = model(**negative_inputs).logits.squeeze(-1)
            loss = functional.softplus(-(positive_scores - negative_scores)).mean()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            batch_losses.append(float(loss.detach().cpu()))
        mean_loss = sum(batch_losses) / len(batch_losses)
        epoch_losses.append(mean_loss)
        LOGGER.info("Epoch %d/%d mean pairwise loss %.6f", epoch + 1, args.epochs, mean_loss)

    args.output_dir.mkdir(parents=True)
    model.save_pretrained(args.output_dir / "model")
    tokenizer.save_pretrained(args.output_dir / "model")
    metadata = {
        "schema_version": 1,
        "model_name": "medix-joint-moment-reranker-v1",
        "base_model": args.model,
        "base_revision": args.revision,
        "protocol": "train-split-only-pairwise-video-moment-ranking",
        "test_split_read": False,
        "seed": args.seed,
        "window_sizes_seconds": list(args.window_sizes),
        "stride_ratio": args.stride_ratio,
        "max_length": args.max_length,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "training_dataset": {
            **asdict(dataset_summary),
            "train_path": str(train_path),
            "train_sha256": sha256_file(train_path),
            "catalog_path": str(args.catalog),
            "catalog_sha256": sha256_file(args.catalog),
            "transcript_cache": str(args.transcript_cache),
        },
        "training": {
            "epoch_mean_pairwise_losses": epoch_losses,
            "final_mean_pairwise_loss": epoch_losses[-1],
        },
        "runtime": {
            "device": device,
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
        },
    }
    (args.output_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("Joint reranker training complete: %s", json.dumps(metadata, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
