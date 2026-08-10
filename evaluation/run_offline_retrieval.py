"""Reproduce Medix semantic retrieval without a running Qdrant service."""

from __future__ import annotations

import argparse
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import numpy as np
from sentence_transformers import SentenceTransformer

from evaluation.build_manifest import build_manifest

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def lexical_overlap(query: str, candidate: str) -> float:
    query_tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
    candidate_tokens = set(re.findall(r"[a-z0-9]+", candidate.lower()))
    if not query_tokens:
        return 0.0
    return len(query_tokens & candidate_tokens) / len(query_tokens)


def rank_candidates(
    query: str,
    query_embedding: np.ndarray,
    corpus: list[dict[str, Any]],
    corpus_embeddings: np.ndarray,
    *,
    excluded_sample_id: str,
    top_k: int,
    lexical_weight: float,
) -> list[dict[str, Any]]:
    """Apply the same semantic/lexical blend as the production retriever."""

    semantic_scores = corpus_embeddings @ query_embedding
    semantic_limit = min(max(top_k * 3, 10) + 1, len(corpus))
    candidate_indices = np.argpartition(semantic_scores, -semantic_limit)[-semantic_limit:]
    ranked: list[dict[str, Any]] = []
    for index in candidate_indices:
        candidate = corpus[int(index)]
        if str(candidate.get("sample_id", "")) == excluded_sample_id:
            continue
        semantic_score = float(semantic_scores[index])
        lexical_score = lexical_overlap(query, str(candidate.get("question", "")))
        blended_score = (1.0 - lexical_weight) * semantic_score + lexical_weight * lexical_score
        ranked.append(
            {
                "video_id": candidate.get("video_id"),
                "sample_id": candidate.get("sample_id"),
                "question": candidate.get("question"),
                "answer_start": candidate.get("answer_start_second"),
                "answer_end": candidate.get("answer_end_second"),
                "semantic_score": semantic_score,
                "lexical_score": lexical_score,
                "similarity_score": blended_score,
            }
        )
    ranked.sort(key=lambda item: item["similarity_score"], reverse=True)
    return ranked[:top_k]


def evaluate_split(
    records: list[dict[str, Any]],
    query_embeddings: np.ndarray,
    corpus: list[dict[str, Any]],
    corpus_embeddings: np.ndarray,
    *,
    top_k: int,
    lexical_weight: float,
    model_name: str = "unspecified",
    model_revision: str = "unspecified",
) -> list[dict[str, Any]]:
    manifest = build_manifest(records)
    output = []
    for sample, query_embedding in zip(manifest, query_embeddings, strict=True):
        started = time.monotonic()
        retrieved = rank_candidates(
            sample["question"],
            query_embedding,
            corpus,
            corpus_embeddings,
            excluded_sample_id=sample["sample_id"],
            top_k=top_k,
            lexical_weight=lexical_weight,
        )
        output.append(
            {
                **sample,
                "evaluation_protocol": "leave-one-question-out-offline",
                "retrieval_model": model_name,
                "retrieval_model_revision": model_revision,
                "lexical_weight": lexical_weight,
                "top_k": top_k,
                "retrieval_ms": int((time.monotonic() - started) * 1000),
                "retrieved": retrieved,
            }
        )
    return output


def _normalized_embeddings(model: SentenceTransformer, texts: list[str]) -> np.ndarray:
    return model.encode(
        texts,
        batch_size=64,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    ).astype(np.float32)


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--corpus",
        type=Path,
        default=PROJECT_ROOT / "data" / "verified_medvidqa_videos.json",
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=PROJECT_ROOT / "MedVidQA",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results",
    )
    parser.add_argument("--model", default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument(
        "--revision",
        default="1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
        help="Pinned Hugging Face model revision.",
    )
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--lexical-weight", type=float, default=0.15)
    args = parser.parse_args()

    corpus = json.loads(args.corpus.read_text(encoding="utf-8"))
    if not isinstance(corpus, list) or not corpus:
        raise ValueError("The verified retrieval corpus must be a non-empty list")
    model = SentenceTransformer(args.model, revision=args.revision)
    corpus_embeddings = _normalized_embeddings(
        model,
        [str(candidate["question"]) for candidate in corpus],
    )

    for source_name, output_name in (
        ("train.json", "retrieval_train.jsonl"),
        ("val.json", "retrieval_validation.jsonl"),
        ("test.json", "retrieval_test.jsonl"),
    ):
        records = json.loads((args.dataset_dir / source_name).read_text(encoding="utf-8"))
        query_embeddings = _normalized_embeddings(
            model,
            [str(record["question"]) for record in records],
        )
        predictions = evaluate_split(
            records,
            query_embeddings,
            corpus,
            corpus_embeddings,
            top_k=args.top_k,
            lexical_weight=args.lexical_weight,
            model_name=args.model,
            model_revision=args.revision,
        )
        output_path = args.output_dir / output_name
        _write_jsonl(output_path, predictions)
        LOGGER.info("Wrote %d retrieval records to %s", len(predictions), output_path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
