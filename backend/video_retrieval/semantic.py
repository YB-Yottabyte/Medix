"""Dense video-title retrieval with a deterministic lexical re-ranker."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Protocol

import numpy as np

from backend.domain import VideoCandidate

if TYPE_CHECKING:
    from collections.abc import Sequence

    from backend.domain import VideoDocument


class TextEncoder(Protocol):
    """Minimal interface implemented by SentenceTransformer."""

    def encode(self, sentences: list[str], **kwargs: object) -> np.ndarray: ...


class SemanticVideoRetriever:
    """Rank one document per video without answer-label metadata."""

    def __init__(
        self,
        *,
        documents: Sequence[VideoDocument],
        embeddings: np.ndarray,
        encoder: TextEncoder,
        lexical_weight: float = 0.15,
        model_name: str = "semantic-video-retriever",
    ):
        if not documents:
            raise ValueError("documents must not be empty")
        if len({document.video_id for document in documents}) != len(documents):
            raise ValueError("video documents must contain unique video IDs")
        if embeddings.ndim != 2 or embeddings.shape[0] != len(documents):
            raise ValueError("embeddings must have one row per video document")
        if not 0 <= lexical_weight <= 1:
            raise ValueError("lexical_weight must be between zero and one")

        self.documents = tuple(documents)
        self.embeddings = self._normalize_rows(np.asarray(embeddings, dtype=np.float32))
        self.encoder = encoder
        self.lexical_weight = lexical_weight
        self.model_name = model_name

    @classmethod
    def build(
        cls,
        documents: Sequence[VideoDocument],
        encoder: TextEncoder,
        *,
        lexical_weight: float = 0.15,
        model_name: str = "semantic-video-retriever",
        batch_size: int = 64,
    ) -> SemanticVideoRetriever:
        """Embed the non-label catalog once and construct a retriever."""
        document_list = tuple(documents)
        embeddings = encoder.encode(
            [document.searchable_text for document in document_list],
            batch_size=batch_size,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=True,
        )
        return cls(
            documents=document_list,
            embeddings=np.asarray(embeddings),
            encoder=encoder,
            lexical_weight=lexical_weight,
            model_name=model_name,
        )

    def retrieve(self, question: str, *, limit: int = 5) -> tuple[VideoCandidate, ...]:
        normalized_question = question.strip()
        if not normalized_question:
            raise ValueError("question must not be empty")
        if limit < 1:
            raise ValueError("limit must be positive")

        encoded = self.encoder.encode(
            [normalized_question],
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        query_embedding = self._normalize_rows(np.asarray(encoded, dtype=np.float32))[0]
        semantic_scores = self.embeddings @ query_embedding

        scored = []
        for index, document in enumerate(self.documents):
            semantic_score = float(semantic_scores[index])
            lexical_score = self._lexical_overlap(
                normalized_question,
                document.searchable_text,
            )
            score = (
                1.0 - self.lexical_weight
            ) * semantic_score + self.lexical_weight * lexical_score
            scored.append((score, document))

        scored.sort(key=lambda item: (-item[0], item[1].video_id))
        return tuple(
            VideoCandidate(
                video_id=document.video_id,
                title=document.title,
                retrieval_score=float(score),
                source_uri=document.source_uri,
            )
            for score, document in scored[: min(limit, len(scored))]
        )

    @staticmethod
    def _lexical_overlap(query: str, candidate: str) -> float:
        query_tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
        if not query_tokens:
            return 0.0
        candidate_tokens = set(re.findall(r"[a-z0-9]+", candidate.lower()))
        return len(query_tokens & candidate_tokens) / len(query_tokens)

    @staticmethod
    def _normalize_rows(values: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(values, axis=1, keepdims=True)
        return values / np.maximum(norms, np.finfo(np.float32).eps)
