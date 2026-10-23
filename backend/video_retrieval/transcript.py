"""Live retrieval from cached transcript content, without question/answer labels."""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer

from backend.domain import VideoCandidate
from backend.performance import timed
from backend.transcripts import TranscriptUnavailableError
from backend.video_retrieval.semantic import SemanticVideoRetriever

if TYPE_CHECKING:
    from backend.transcripts import TranscriptRepository
    from backend.video_retrieval.semantic import TextEncoder


class TranscriptVideoRetriever:
    """Keep question intent primary; use image-assisted titles as secondary context."""

    def __init__(
        self,
        *,
        metadata: SemanticVideoRetriever,
        repository: TranscriptRepository,
        encoder: TextEncoder,
    ):
        self.metadata = metadata
        self.documents = metadata.documents
        self.encoder = encoder
        self.model_name = f"{metadata.model_name}:live-transcript-chunks-v2"
        chunks = []
        owners = []
        for document in self.documents:
            try:
                cues = repository.load(document.video_id)
            except TranscriptUnavailableError:
                continue
            # Overlapping cue groups retain neighboring action/condition fragments.
            for start in range(0, len(cues)):
                text = " ".join(cue.text for cue in cues[start : start + 3])
                if text.strip():
                    chunks.append(text)
                    owners.append(document.video_id)
        self._owners = tuple(owners)
        self._lexical = None
        self._lexical_bank = None
        if chunks:
            # Keep negation/conditions while discarding conversational filler.
            self._lexical = TfidfVectorizer(
                ngram_range=(1, 2),
                sublinear_tf=True,
                stop_words=sorted(ENGLISH_STOP_WORDS - {"not", "no", "too", "without"}),
            )
            try:
                self._lexical_bank = self._lexical.fit_transform(chunks)
            except ValueError:
                self._lexical = None
        self._embeddings = None
        if chunks:
            self._embeddings = SemanticVideoRetriever._normalize_rows(
                np.asarray(
                    encoder.encode(
                        chunks,
                        batch_size=64,
                        convert_to_numpy=True,
                        normalize_embeddings=True,
                        show_progress_bar=False,
                    ),
                    dtype=np.float32,
                )
            )

    @timed("retrieval.transcript")
    def retrieve(self, question: str, *, limit: int = 5) -> tuple[VideoCandidate, ...]:
        if not question.strip():
            raise ValueError("question must not be empty")
        if limit < 1:
            raise ValueError("limit must be positive")
        titles = self.metadata.retrieve(question, limit=len(self.documents))
        if self._embeddings is None:
            return titles[:limit]
        # Image observations are retrieval hints, never a replacement for the question.
        primary_question = question.split("\nVisible context (unverified):", 1)[0].strip()
        query = SemanticVideoRetriever._normalize_rows(
            np.asarray(
                self.encoder.encode(
                    [primary_question or question],
                    convert_to_numpy=True,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                ),
                dtype=np.float32,
            )
        )[0]
        dense = self._embeddings @ query
        passage_scores = 0.8 * dense
        if self._lexical is not None and self._lexical_bank is not None:
            query_terms = self._lexical.transform([primary_question or question])
            overlaps = ((self._lexical_bank > 0) @ query_terms.T).toarray().ravel()
            overlaps /= max(float(query_terms.sum()), np.finfo(np.float32).eps)
            passage_scores = 0.5 * overlaps + 0.3 * dense
        scores: dict[str, float] = {}
        for owner, value in zip(self._owners, passage_scores, strict=True):
            scores[owner] = max(scores.get(owner, -1.0), float(value))
        ranked = tuple(
            VideoCandidate(
                video_id=candidate.video_id,
                title=candidate.title,
                source_uri=candidate.source_uri,
                retrieval_score=(scores[candidate.video_id] + 0.2 * candidate.retrieval_score)
                if candidate.video_id in scores
                else candidate.retrieval_score,
            )
            for candidate in titles
        )
        return tuple(
            sorted(ranked, key=lambda item: (-item.retrieval_score, item.video_id))[:limit]
        )
