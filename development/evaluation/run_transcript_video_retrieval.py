"""Compare title retrieval with validation-only transcript-window retrieval.

The transcript condition adds a second, label-free retrieval signal. It ranks
timestamped transcript windows, pools each video's best window, then fuses the
title-author and transcript rankings with reciprocal-rank fusion. Videos
without a cached transcript remain in the catalog and retain their title leg.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
from sentence_transformers import SentenceTransformer

from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from backend.video_retrieval import SemanticVideoRetriever
from development.evaluation.medvidqa_dataset import OfficialMedVidQADataset
from development.evaluation.metrics import summarize_video_retrieval
from development.evaluation.video_catalog import load_video_documents

if TYPE_CHECKING:
    from backend.domain import TranscriptCue, VideoDocument

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


def transcript_windows(
    cues: tuple[TranscriptCue, ...],
    duration_seconds: float,
    *,
    window_seconds: float = 90.0,
    stride_seconds: float = 45.0,
) -> tuple[str, ...]:
    """Build deterministic timestamped text windows without answer labels."""
    if window_seconds <= 0 or stride_seconds <= 0:
        raise ValueError("window and stride durations must be positive")
    window = min(window_seconds, duration_seconds)
    last_start = max(duration_seconds - window, 0.0)
    starts = list(np.arange(0.0, last_start + stride_seconds, stride_seconds))
    if not starts or starts[-1] < last_start:
        starts.append(last_start)
    starts = sorted({min(float(start), last_start) for start in starts})
    texts = []
    for start in starts:
        end = min(start + window, duration_seconds)
        text = " ".join(
            cue.text.strip()
            for cue in cues
            if cue.start_seconds < end and cue.end_seconds > start and cue.text.strip()
        )
        if text:
            texts.append(text)
    return tuple(texts)


def reciprocal_rank_fusion(
    title_ranks: dict[str, int],
    transcript_ranks: dict[str, int],
    *,
    rank_constant: int = 60,
) -> dict[str, float]:
    """Fuse rank lists, preserving title-only candidates when transcripts miss."""
    if rank_constant < 1:
        raise ValueError("rank_constant must be positive")
    video_ids = set(title_ranks) | set(transcript_ranks)
    return {
        video_id: (
            1.0 / (rank_constant + title_ranks[video_id]) if video_id in title_ranks else 0.0
        )
        + (
            1.0 / (rank_constant + transcript_ranks[video_id])
            if video_id in transcript_ranks
            else 0.0
        )
        for video_id in video_ids
    }


def _read_cues(
    repository: CachedTranscriptRepository, video_id: str
) -> tuple[TranscriptCue, ...] | None:
    try:
        return repository.load(video_id)
    except TranscriptUnavailableError:
        return None


def _encode_transcript_windows(
    documents: tuple[VideoDocument, ...],
    repository: CachedTranscriptRepository,
    encoder: SentenceTransformer,
) -> tuple[dict[str, tuple[int, int]], np.ndarray, int]:
    texts: list[str] = []
    spans: dict[str, tuple[int, int]] = {}
    transcript_count = 0
    for document in documents:
        cues = _read_cues(repository, document.video_id)
        if cues is None:
            continue
        windows = transcript_windows(cues, document.duration_seconds)
        if not windows:
            continue
        start = len(texts)
        texts.extend(windows)
        spans[document.video_id] = (start, len(texts))
        transcript_count += 1
    if not texts:
        raise ValueError("No valid transcript windows found in the supplied cache")
    embeddings = encoder.encode(
        texts,
        batch_size=128,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    return spans, np.asarray(embeddings, dtype=np.float32), transcript_count


def evaluate(
    *,
    split: str,
    samples: tuple[Any, ...],
    documents: tuple[VideoDocument, ...],
    retriever: SemanticVideoRetriever,
    encoder: SentenceTransformer,
    transcript_spans: dict[str, tuple[int, int]],
    transcript_embeddings: np.ndarray,
    transcript_video_count: int,
    top_k: int,
    rank_constant: int,
    output_dir: Path,
    frozen_retrieval: Path,
) -> dict[str, Any]:
    document_by_id = {document.video_id: document for document in documents}
    frozen_rows = {
        row["sample_id"]: tuple(candidate["video_id"] for candidate in row["retrieved"][:top_k])
        for row in (
            json.loads(line)
            for line in frozen_retrieval.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    }
    title_rows: list[dict[str, Any]] = []
    hybrid_rows: list[dict[str, Any]] = []
    for sample in samples:
        started = time.monotonic()
        title_candidates = retriever.retrieve(sample.question, limit=len(documents))
        title_ranks = {item.video_id: rank for rank, item in enumerate(title_candidates, 1)}
        current_top_k = tuple(item.video_id for item in title_candidates[:top_k])
        if frozen_rows.get(sample.sample_id) != current_top_k:
            raise ValueError(
                f"Title-author Top-{top_k} does not match frozen baseline for {sample.sample_id}"
            )

        query_embedding = encoder.encode(
            [sample.question],
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )[0]
        window_scores = transcript_embeddings @ np.asarray(query_embedding, dtype=np.float32)
        per_video_scores = {
            video_id: float(np.max(window_scores[start:end]))
            for video_id, (start, end) in transcript_spans.items()
        }
        transcript_order = sorted(
            per_video_scores,
            key=lambda video_id: (-per_video_scores[video_id], video_id),
        )
        transcript_ranks = {video_id: rank for rank, video_id in enumerate(transcript_order, 1)}
        fused = reciprocal_rank_fusion(
            title_ranks,
            transcript_ranks,
            rank_constant=rank_constant,
        )
        max_fusion = 2.0 / (rank_constant + 1)
        hybrid_order = sorted(fused, key=lambda video_id: (-fused[video_id], video_id))
        hybrid_candidates = []
        for video_id in hybrid_order[:top_k]:
            document = document_by_id[video_id]
            # Map normalized RRF into [-1, 1] because the end-to-end selector
            # converts retrieval scores back to confidence via (score + 1) / 2.
            normalized_fusion = min(fused[video_id] / max_fusion, 1.0)
            hybrid_candidates.append(
                {
                    "video_id": video_id,
                    "title": document.title,
                    "similarity_score": 2.0 * normalized_fusion - 1.0,
                    "source_uri": document.source_uri,
                    "title_rank": title_ranks[video_id],
                    "transcript_rank": transcript_ranks.get(video_id),
                    "rrf_score": fused[video_id],
                }
            )

        title_rows.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "retrieval_model": retriever.model_name,
                "candidate_video_count": len(documents),
                "retrieved": [
                    {
                        "video_id": candidate.video_id,
                        "title": candidate.title,
                        "similarity_score": candidate.retrieval_score,
                        "source_uri": candidate.source_uri,
                    }
                    for candidate in title_candidates[:top_k]
                ],
            }
        )
        hybrid_rows.append(
            {
                "sample_id": sample.sample_id,
                "question": sample.question,
                "expected_video_id": sample.video_id,
                "expected_start": sample.answer_start_seconds,
                "expected_end": sample.answer_end_seconds,
                "retrieval_model": f"title-author+transcript-windows-rrf@k{rank_constant}",
                "candidate_video_count": len(documents),
                "transcript_video_coverage": transcript_video_count,
                "retrieval_ms": int((time.monotonic() - started) * 1000),
                "retrieved": hybrid_candidates,
            }
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    title_path = output_dir / f"{split}-title-author.jsonl"
    hybrid_path = output_dir / f"{split}-transcript-hybrid.jsonl"
    _write_jsonl(title_path, title_rows)
    _write_jsonl(hybrid_path, hybrid_rows)
    summaries = {
        "split": split,
        "top_k": top_k,
        "catalog_video_count": len(documents),
        "transcript_video_count": transcript_video_count,
        "transcript_catalog_coverage": transcript_video_count / len(documents),
        "target_transcript_questions": sum(
            sample.video_id in transcript_spans for sample in samples
        ),
        "sample_count": len(samples),
        "title_author": summarize_video_retrieval(title_rows),
        "transcript_hybrid_rrf": summarize_video_retrieval(hybrid_rows),
        "title_author_predictions": str(title_path),
        "transcript_hybrid_predictions": str(hybrid_path),
        "protocol": "validation-only-global-catalog-transcript-window-retrieval",
        "rank_constant": rank_constant,
        "transcript_window_seconds": 90,
        "transcript_stride_seconds": 45,
        "embedding_model": f"{MODEL_NAME}@{MODEL_REVISION}",
        "frozen_retrieval_path": str(frozen_retrieval),
        "frozen_retrieval_sha256": hashlib.sha256(frozen_retrieval.read_bytes()).hexdigest(),
    }
    summary_path = output_dir / f"{split}-summary.json"
    summary_path.write_text(json.dumps(summaries, indent=2) + "\n", encoding="utf-8")
    return summaries


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as stream:
        for record in records:
            stream.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--catalog", type=Path, default=PROJECT_ROOT / "data/medvidqa_video_catalog.json"
    )
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument("--transcript-cache", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--frozen-retrieval",
        type=Path,
        default=(
            PROJECT_ROOT
            / "development/evaluation/results/week1/2026-09-24-candidate-snapshot-v1/retrieval/validation.jsonl"
        ),
    )
    parser.add_argument("--split", choices=("validation",), default="validation")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--lexical-weight", type=float, default=0.15)
    parser.add_argument("--rank-constant", type=int, default=60)
    args = parser.parse_args()
    if args.top_k < 1:
        raise ValueError("top-k must be positive")

    documents = load_video_documents(json.loads(args.catalog.read_text(encoding="utf-8")))
    encoder = SentenceTransformer(MODEL_NAME, revision=MODEL_REVISION)
    retriever = SemanticVideoRetriever.build(
        documents,
        encoder,
        lexical_weight=args.lexical_weight,
        model_name=f"{MODEL_NAME}@{MODEL_REVISION}:title-author",
    )
    transcript_repo = CachedTranscriptRepository(args.transcript_cache)
    spans, embeddings, transcript_count = _encode_transcript_windows(
        documents,
        transcript_repo,
        encoder,
    )
    dataset = OfficialMedVidQADataset.load(args.dataset_dir)
    result = evaluate(
        split=args.split,
        samples=dataset.validation,
        documents=documents,
        retriever=retriever,
        encoder=encoder,
        transcript_spans=spans,
        transcript_embeddings=embeddings,
        transcript_video_count=transcript_count,
        top_k=args.top_k,
        rank_constant=args.rank_constant,
        output_dir=args.output_dir,
        frozen_retrieval=args.frozen_retrieval,
    )
    LOGGER.info("Transcript retrieval comparison: %s", json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
