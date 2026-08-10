"""Feature extraction for retrieval-confidence calibration experiments."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, ClassVar


@dataclass(frozen=True)
class ConfidenceExample:
    """One labeled retrieval outcome used by all confidence models."""

    sample_id: str
    group_id: str
    features: tuple[float, ...]
    label: int


class RetrievalFeatureExtractor:
    """Convert a ranked retrieval result into small, model-independent features."""

    retrieval_feature_names: ClassVar[tuple[str, ...]] = (
        "top_score",
        "score_margin",
        "mean_score",
        "score_std",
        "score_entropy",
        "query_title_overlap",
        "candidate_fraction",
        "top_semantic_score",
    )
    agreement_feature_names: ClassVar[tuple[str, ...]] = (
        "top_lexical_score",
        "cross_encoder_score",
        "transcript_support_score",
        "visual_procedure_score",
        "semantic_lexical_agreement",
        "retrieval_reranker_agreement",
        "retrieval_transcript_agreement",
        "text_visual_agreement",
        "evidence_conflict",
        "cross_encoder_available",
        "transcript_available",
        "visual_available",
    )
    feature_names: ClassVar[tuple[str, ...]] = retrieval_feature_names
    profiles: ClassVar[dict[str, tuple[str, ...]]] = {
        "retrieval": retrieval_feature_names,
        "evidence_agreement": retrieval_feature_names + agreement_feature_names,
    }

    def __init__(self, max_candidates: int = 5, profile: str = "retrieval"):
        if max_candidates < 1:
            raise ValueError("max_candidates must be positive")
        if profile not in self.profiles:
            choices = ", ".join(sorted(self.profiles))
            raise ValueError(f"Unknown feature profile '{profile}'. Choose from: {choices}")
        self.max_candidates = max_candidates
        self.profile = profile

    @property
    def selected_feature_names(self) -> tuple[str, ...]:
        return self.profiles[self.profile]

    def transform(self, record: dict[str, Any]) -> ConfidenceExample:
        retrieved = record.get("retrieved", [])
        if not isinstance(retrieved, list):
            raise TypeError("'retrieved' must be a list")

        candidates = [item for item in retrieved if isinstance(item, dict)]
        scores = [self._score(item) for item in candidates[: self.max_candidates]]
        top = candidates[0] if candidates else {}
        top_score = scores[0] if scores else 0.0
        second_score = scores[1] if len(scores) > 1 else 0.0
        mean_score = sum(scores) / len(scores) if scores else 0.0
        variance = (
            sum((score - mean_score) ** 2 for score in scores) / len(scores) if scores else 0.0
        )
        top_semantic = self._finite_float(top.get("semantic_score"), top_score)
        lexical_default = self._token_overlap(
            str(record.get("question", "")),
            str(top.get("question", "")),
        )
        top_lexical, _ = self._optional_score(top.get("lexical_score"), lexical_default)
        evidence_signals = record.get("evidence_signals", {})
        if not isinstance(evidence_signals, dict):
            raise TypeError("'evidence_signals' must be a mapping when provided")
        cross_encoder, cross_encoder_available = self._optional_score(
            evidence_signals.get("cross_encoder_score"),
        )
        transcript_support, transcript_available = self._optional_score(
            evidence_signals.get("transcript_support_score"),
        )
        visual_procedure, visual_available = self._optional_score(
            evidence_signals.get("visual_procedure_score"),
        )
        retrieval_reference = (top_semantic + top_lexical) / 2
        available_evidence = [top_semantic, top_lexical]
        available_evidence.extend(
            value
            for value, available in (
                (cross_encoder, cross_encoder_available),
                (transcript_support, transcript_available),
                (visual_procedure, visual_available),
            )
            if available
        )

        feature_values = {
            "top_score": top_score,
            "score_margin": top_score - second_score,
            "mean_score": mean_score,
            "score_std": math.sqrt(variance),
            "score_entropy": self._normalized_entropy(scores),
            "query_title_overlap": lexical_default,
            "candidate_fraction": min(len(scores), self.max_candidates) / self.max_candidates,
            "top_semantic_score": top_semantic,
            "top_lexical_score": top_lexical,
            "cross_encoder_score": cross_encoder,
            "transcript_support_score": transcript_support,
            "visual_procedure_score": visual_procedure,
            "semantic_lexical_agreement": (
                self._agreement(top_semantic, top_lexical) if candidates else 0.0
            ),
            "retrieval_reranker_agreement": (
                self._agreement(retrieval_reference, cross_encoder)
                if cross_encoder_available
                else 0.0
            ),
            "retrieval_transcript_agreement": (
                self._agreement(retrieval_reference, transcript_support)
                if transcript_available
                else 0.0
            ),
            "text_visual_agreement": (
                self._agreement(retrieval_reference, visual_procedure) if visual_available else 0.0
            ),
            "evidence_conflict": max(available_evidence) - min(available_evidence),
            "cross_encoder_available": float(cross_encoder_available),
            "transcript_available": float(transcript_available),
            "visual_available": float(visual_available),
        }

        expected_video_id = str(record["expected_video_id"])
        predicted_video_id = str(top.get("video_id", ""))
        return ConfidenceExample(
            sample_id=str(record.get("sample_id", "")),
            group_id=expected_video_id,
            features=tuple(feature_values[name] for name in self.selected_feature_names),
            label=int(bool(candidates) and predicted_video_id == expected_video_id),
        )

    @staticmethod
    def _score(candidate: dict[str, Any]) -> float:
        return RetrievalFeatureExtractor._finite_float(candidate.get("similarity_score"), 0.0)

    @staticmethod
    def _finite_float(value: Any, default: float) -> float:
        try:
            result = float(value)
        except (TypeError, ValueError):
            return default
        return result if math.isfinite(result) else default

    @classmethod
    def _optional_score(cls, value: Any, default: float = 0.0) -> tuple[float, bool]:
        if value is None:
            return default, False
        parsed = cls._finite_float(value, default)
        return min(max(parsed, 0.0), 1.0), True

    @staticmethod
    def _agreement(left: float, right: float) -> float:
        return 1.0 - min(abs(left - right), 1.0)

    @staticmethod
    def _normalized_entropy(scores: list[float]) -> float:
        if len(scores) < 2:
            return 0.0
        minimum = min(scores)
        weights = [max(score - minimum, 0.0) + 1e-8 for score in scores]
        total = sum(weights)
        probabilities = [weight / total for weight in weights]
        entropy = -sum(probability * math.log(probability) for probability in probabilities)
        return entropy / math.log(len(probabilities))

    @staticmethod
    def _token_overlap(query: str, title: str) -> float:
        query_tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
        title_tokens = set(re.findall(r"[a-z0-9]+", title.lower()))
        if not query_tokens:
            return 0.0
        return len(query_tokens & title_tokens) / len(query_tokens)


def assert_disjoint_groups(splits: dict[str, list[ConfidenceExample]]) -> None:
    """Fail loudly when a video occurs in more than one experimental split."""

    group_sets = {
        name: {example.group_id for example in examples} for name, examples in splits.items()
    }
    names = list(group_sets)
    for index, left_name in enumerate(names):
        for right_name in names[index + 1 :]:
            overlap = group_sets[left_name] & group_sets[right_name]
            if overlap:
                examples = ", ".join(sorted(overlap)[:3])
                raise ValueError(f"Video leakage between {left_name} and {right_name}: {examples}")
