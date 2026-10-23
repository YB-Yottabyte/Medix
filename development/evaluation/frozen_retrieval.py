"""Replay a frozen retrieval snapshot without recomputing candidate rankings."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from backend.domain import VideoCandidate

if TYPE_CHECKING:
    from pathlib import Path


class FrozenVideoRetriever:
    """Return the exact candidates and scores saved by retrieval-only evaluation."""

    def __init__(
        self,
        candidates_by_question: dict[str, tuple[VideoCandidate, ...]],
        *,
        model_name: str,
        source_path: Path,
    ) -> None:
        self._candidates_by_question = candidates_by_question
        self.model_name = f"frozen:{model_name}"
        self.source_path = source_path

    @classmethod
    def load(cls, path: Path) -> FrozenVideoRetriever:
        rows = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if not rows:
            raise ValueError(f"Frozen retrieval snapshot is empty: {path}")

        model_names = {str(row.get("retrieval_model", "")).strip() for row in rows}
        if "" in model_names or len(model_names) != 1:
            raise ValueError("Frozen retrieval rows must name exactly one retrieval model")

        candidates_by_question: dict[str, tuple[VideoCandidate, ...]] = {}
        for row in rows:
            question = str(row.get("question", "")).strip()
            if not question:
                raise ValueError("Frozen retrieval row has no question")
            candidates = cls._parse_candidates(row.get("retrieved"), question=question)
            previous = candidates_by_question.get(question)
            if previous is not None and previous != candidates:
                raise ValueError(f"Conflicting frozen rankings for question: {question}")
            candidates_by_question[question] = candidates

        return cls(
            candidates_by_question,
            model_name=model_names.pop(),
            source_path=path,
        )

    @staticmethod
    def _parse_candidates(
        payload: Any,
        *,
        question: str,
    ) -> tuple[VideoCandidate, ...]:
        if not isinstance(payload, list) or not payload:
            raise ValueError(f"Frozen retrieval row has no candidates: {question}")
        candidates = tuple(
            VideoCandidate(
                video_id=str(candidate["video_id"]),
                title=str(candidate["title"]),
                retrieval_score=float(candidate["similarity_score"]),
                source_uri=(
                    str(candidate["source_uri"])
                    if candidate.get("source_uri") is not None
                    else None
                ),
            )
            for candidate in payload
        )
        video_ids = [candidate.video_id for candidate in candidates]
        if len(video_ids) != len(set(video_ids)):
            raise ValueError(f"Frozen retrieval row contains duplicate video IDs: {question}")
        return candidates

    def retrieve(self, question: str, *, limit: int = 5) -> tuple[VideoCandidate, ...]:
        normalized_question = question.strip()
        if limit < 1:
            raise ValueError("limit must be positive")
        try:
            candidates = self._candidates_by_question[normalized_question]
        except KeyError as exc:
            raise KeyError(
                f"Question is absent from frozen retrieval: {normalized_question}"
            ) from exc
        if limit > len(candidates):
            raise ValueError(
                f"Requested {limit} candidates, but snapshot contains {len(candidates)}"
            )
        return candidates[:limit]
