"""Evaluate joint video-and-moment reranking on validation only."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path
from statistics import mean
from typing import Any

from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from backend.video_retrieval.catalog import load_video_documents
from development.evaluation.frozen_retrieval import FrozenVideoRetriever
from development.evaluation.joint_moment_reranker import (
    MomentWindow,
    build_moment_windows,
    pair_document,
)
from development.evaluation.medvidqa_dataset import load_official_split
from development.evaluation.metrics import summarize_localization_predictions

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checkpoint_hashes(checkpoint: Path) -> dict[str, str]:
    return {
        str(path.relative_to(checkpoint)): sha256_file(path)
        for path in sorted(checkpoint.rglob("*"))
        if path.is_file()
    }


class JointMomentScorer:
    def __init__(self, checkpoint: Path, *, batch_size: int = 64):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        metadata = json.loads((checkpoint / "metadata.json").read_text(encoding="utf-8"))
        self.metadata = metadata
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.tokenizer = AutoTokenizer.from_pretrained(checkpoint / "model", use_fast=True)
        self.model = (
            AutoModelForSequenceClassification.from_pretrained(checkpoint / "model")
            .to(self.device)
            .eval()
        )
        self.batch_size = batch_size
        self.max_length = int(metadata["max_length"])

    def score(
        self,
        question: str,
        candidates: list[tuple[str, MomentWindow]],
    ) -> list[float]:
        import torch

        scores = []
        for offset in range(0, len(candidates), self.batch_size):
            batch = candidates[offset : offset + self.batch_size]
            encoded = self.tokenizer(
                [question] * len(batch),
                [pair_document(title, window) for title, window in batch],
                max_length=self.max_length,
                truncation=True,
                padding=True,
                return_tensors="pt",
            )
            encoded = {key: value.to(self.device) for key, value in encoded.items()}
            with torch.inference_mode():
                logits = self.model(**encoded).logits.squeeze(-1)
            scores.extend(float(value) for value in logits.detach().cpu().tolist())
        return scores


def _best(
    scorer: JointMomentScorer,
    question: str,
    candidates: list[tuple[str, MomentWindow]],
) -> tuple[MomentWindow, float, float | None]:
    if not candidates:
        raise TranscriptUnavailableError("No transcript windows are available to rank")
    scores = scorer.score(question, candidates)
    ranked = sorted(
        zip(scores, candidates, strict=True),
        key=lambda item: (
            -item[0],
            item[1][1].video_id,
            item[1][1].start_seconds,
            item[1][1].end_seconds,
        ),
    )
    best_score, (_, best_window) = ranked[0]
    margin = best_score - ranked[1][0] if len(ranked) > 1 else None
    return best_window, best_score, margin


def evaluate(
    *,
    dataset_dir: Path,
    transcript_cache: Path,
    frozen_retrieval: Path,
    checkpoint: Path,
    top_k: int,
    batch_size: int,
    catalog: Path = PROJECT_ROOT / "data/medvidqa_video_catalog.json",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    samples = load_official_split(dataset_dir / "val.json")
    repository = CachedTranscriptRepository(transcript_cache)
    retriever = FrozenVideoRetriever.load(frozen_retrieval)
    documents = {document.video_id: document for document in load_video_documents(catalog)}
    scorer = JointMomentScorer(checkpoint, batch_size=batch_size)
    window_sizes = tuple(float(value) for value in scorer.metadata["window_sizes_seconds"])
    stride_ratio = float(scorer.metadata["stride_ratio"])
    window_cache: dict[tuple[str, float | None], tuple[MomentWindow, ...]] = {}

    def windows(video_id: str) -> tuple[MomentWindow, ...]:
        if video_id not in documents:
            raise TranscriptUnavailableError(f"No catalog metadata for {video_id}")
        duration = documents[video_id].duration_seconds
        cache_key = (video_id, duration)
        if cache_key not in window_cache:
            cues = repository.load(video_id)
            effective_duration = duration or max(cue.end_seconds for cue in cues)
            window_cache[cache_key] = build_moment_windows(
                video_id,
                cues,
                effective_duration,
                window_sizes=window_sizes,
                stride_ratio=stride_ratio,
            )
        return window_cache[cache_key]

    joint_records = []
    oracle_records = []
    target_in_top_k = 0
    all_candidates_ready = 0
    candidate_failures: dict[str, int] = {}
    margins = []
    for sample in samples:
        retrieved = retriever.retrieve(sample.question, limit=top_k)
        target_in_top_k += int(any(item.video_id == sample.video_id for item in retrieved))
        candidate_windows = []
        ready_candidates = 0
        for candidate in retrieved:
            try:
                current = windows(candidate.video_id)
            except TranscriptUnavailableError:
                candidate_failures["TranscriptUnavailableError"] = (
                    candidate_failures.get("TranscriptUnavailableError", 0) + 1
                )
                continue
            if current:
                ready_candidates += 1
                candidate_windows.extend((candidate.title, window) for window in current)
        all_candidates_ready += int(ready_candidates == top_k)
        try:
            selected, score, margin = _best(scorer, sample.question, candidate_windows)
            if margin is not None:
                margins.append(margin)
            predicted_video_id: str | None = selected.video_id
            predicted_start: float | None = selected.start_seconds
            predicted_end: float | None = selected.end_seconds
        except TranscriptUnavailableError:
            score = margin = None
            predicted_video_id = None
            predicted_start = predicted_end = None
        joint_records.append(
            _record(
                sample,
                predicted_video_id=predicted_video_id,
                predicted_start=predicted_start,
                predicted_end=predicted_end,
                score=score,
                margin=margin,
            )
        )

        try:
            target_windows = windows(sample.video_id)
            target_title = documents[sample.video_id].title
            target_candidates = [(target_title, window) for window in target_windows]
            oracle, oracle_score, oracle_margin = _best(scorer, sample.question, target_candidates)
            oracle_records.append(
                _record(
                    sample,
                    predicted_video_id=sample.video_id,
                    predicted_start=oracle.start_seconds,
                    predicted_end=oracle.end_seconds,
                    score=oracle_score,
                    margin=oracle_margin,
                )
            )
        except TranscriptUnavailableError:
            oracle_records.append(
                _record(
                    sample,
                    predicted_video_id=None,
                    predicted_start=None,
                    predicted_end=None,
                    score=None,
                    margin=None,
                )
            )

    selected_video_accuracy = sum(
        row["predicted_video_id"] == row["expected_video_id"] for row in joint_records
    ) / len(joint_records)
    summary = {
        "protocol": "validation-only-frozen-top5-joint-video-moment-reranking",
        "split": "validation",
        "test_split_read": False,
        "sample_count": len(samples),
        "top_k": top_k,
        "target_video_recall_at_k": target_in_top_k / len(samples),
        "selected_video_accuracy": selected_video_accuracy,
        "all_top_k_candidates_resource_ready": all_candidates_ready,
        "candidate_failure_reasons": candidate_failures,
        "joint_top_k": summarize_localization_predictions(joint_records),
        "oracle_target_video": summarize_localization_predictions(oracle_records),
        "score_margin": {
            "available": len(margins),
            "mean": mean(margins) if margins else None,
            "minimum": min(margins) if margins else None,
            "maximum": max(margins) if margins else None,
        },
        "window_sizes_seconds": list(window_sizes),
        "stride_ratio": stride_ratio,
        "metadata_protocol": "catalog-title-and-duration-for-all-candidates-v2",
        "catalog_sha256": sha256_file(catalog),
        "checkpoint": str(checkpoint),
        "checkpoint_hashes": checkpoint_hashes(checkpoint),
        "frozen_retrieval": {
            "path": str(frozen_retrieval),
            "sha256": sha256_file(frozen_retrieval),
        },
        "validation_annotations_sha256": sha256_file(dataset_dir / "val.json"),
    }
    return joint_records, oracle_records, summary


def _record(
    sample: Any,
    *,
    predicted_video_id: str | None,
    predicted_start: float | None,
    predicted_end: float | None,
    score: float | None,
    margin: float | None,
) -> dict[str, Any]:
    return {
        "sample_id": sample.sample_id,
        "question": sample.question,
        "expected_video_id": sample.video_id,
        "expected_start": sample.answer_start_seconds,
        "expected_end": sample.answer_end_seconds,
        "predicted_video_id": predicted_video_id,
        "predicted_start": predicted_start,
        "predicted_end": predicted_end,
        "reranker_score": score,
        "score_margin": margin,
    }


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument("--transcript-cache", type=Path, required=True)
    parser.add_argument("--frozen-retrieval", type=Path, required=True)
    parser.add_argument(
        "--catalog", type=Path, default=PROJECT_ROOT / "data/medvidqa_video_catalog.json"
    )
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite validation output: {args.output_dir}")
    if args.top_k < 1 or args.batch_size < 1:
        raise ValueError("top-k and batch size must be positive")
    joint, oracle, summary = evaluate(
        dataset_dir=args.dataset_dir,
        transcript_cache=args.transcript_cache,
        frozen_retrieval=args.frozen_retrieval,
        checkpoint=args.checkpoint,
        top_k=args.top_k,
        batch_size=args.batch_size,
        catalog=args.catalog,
    )
    args.output_dir.mkdir(parents=True)
    _write_jsonl(args.output_dir / "validation-joint-top5.jsonl", joint)
    _write_jsonl(args.output_dir / "validation-oracle-target.jsonl", oracle)
    (args.output_dir / "validation-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("Joint moment validation complete: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
