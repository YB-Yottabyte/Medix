"""Benchmark leakage-free video-title retrieval on MedVidQA questions."""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path
from typing import Any

from sentence_transformers import SentenceTransformer

from backend.video_retrieval import SemanticVideoRetriever
from evaluation.medvidqa_dataset import OfficialMedVidQADataset
from evaluation.metrics import summarize_video_retrieval
from evaluation.video_catalog import load_video_documents

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


def evaluate_video_retriever(
    samples: tuple[Any, ...],
    retriever: SemanticVideoRetriever,
    *,
    top_k: int,
    candidate_count: int,
) -> list[dict[str, Any]]:
    """Evaluate only video identity; localization remains a separate stage."""
    predictions = []
    for sample in samples:
        started = time.monotonic()
        candidates = retriever.retrieve(sample.question, limit=top_k)
        predictions.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "evaluation_protocol": "global-video-catalog-no-answer-labels",
                "candidate_video_count": candidate_count,
                "retrieval_model": retriever.model_name,
                "retrieval_ms": int((time.monotonic() - started) * 1000),
                "retrieved": [
                    {
                        "video_id": candidate.video_id,
                        "title": candidate.title,
                        "similarity_score": candidate.retrieval_score,
                        "source_uri": candidate.source_uri,
                    }
                    for candidate in candidates
                ],
            }
        )
    return predictions


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--catalog",
        type=Path,
        default=PROJECT_ROOT / "data" / "medvidqa_video_catalog.json",
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=PROJECT_ROOT / "MedVidQA",
    )
    parser.add_argument(
        "--output",
        type=Path,
    )
    parser.add_argument("--split", choices=("validation", "test"), default="test")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--lexical-weight", type=float, default=0.15)
    args = parser.parse_args()

    catalog_payload = json.loads(args.catalog.read_text(encoding="utf-8"))
    documents = load_video_documents(catalog_payload)
    model = SentenceTransformer(args.model, revision=args.revision)
    retriever = SemanticVideoRetriever.build(
        documents,
        model,
        lexical_weight=args.lexical_weight,
        model_name=f"{args.model}@{args.revision}:title-author",
    )
    dataset = OfficialMedVidQADataset.load(args.dataset_dir)
    samples = dataset.validation if args.split == "validation" else dataset.test
    output_path = args.output or (
        PROJECT_ROOT / "evaluation" / "results" / f"video_retrieval_{args.split}.jsonl"
    )
    predictions = evaluate_video_retriever(
        samples,
        retriever,
        top_k=args.top_k,
        candidate_count=len(documents),
    )
    _write_jsonl(output_path, predictions)
    summary = summarize_video_retrieval(predictions)
    available_video_ids = {document.video_id for document in documents}
    target_coverage = sum(sample.video_id in available_video_ids for sample in samples) / len(
        samples
    )
    summary.update(
        {
            "catalog_videos": len(documents),
            "catalog_unavailable_videos": int(catalog_payload.get("unavailable_video_count", 0)),
            "expected_video_coverage": target_coverage,
            "split": args.split,
            "catalog_coverage_recall_upper_bound": target_coverage,
            "uniform_random_expected_recall_at_1": target_coverage / len(documents),
            "uniform_random_expected_recall_at_5": (
                target_coverage * min(5, len(documents)) / len(documents)
            ),
            "model": retriever.model_name,
            "lexical_weight": args.lexical_weight,
        }
    )
    summary_path = output_path.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Video retrieval summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
