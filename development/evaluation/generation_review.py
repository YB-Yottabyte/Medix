"""Validation and unblinding for generation-comparison human reviews."""

from __future__ import annotations

import copy
from dataclasses import asdict, dataclass
from typing import Any, ClassVar

ORDINAL_RATING_FIELDS = (
    "evidence_support",
    "answer_relevance",
    "completeness",
    "coherence",
)
BINARY_RATING_FIELD = "unsafe_or_unsupported_claim"
RATING_FIELDS = (*ORDINAL_RATING_FIELDS, BINARY_RATING_FIELD)


class ReviewValidationError(ValueError):
    """Raised when a review cannot be analyzed safely."""


@dataclass(frozen=True)
class UnblindedRating:
    reviewer_id: str
    case_id: str
    response_id: str
    condition: str
    condition_model: str
    evidence_support: int
    answer_relevance: int
    completeness: int
    coherence: int
    unsafe_or_unsupported_claim: bool

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class GenerationReviewValidator:
    """Validate reviewer identity, case structure, and rubric values."""

    required_response_fields: ClassVar[set[str]] = {
        "response_id",
        "status",
        "response",
        "ratings",
        "reviewer_notes",
    }

    def validate(
        self,
        review: dict[str, Any],
        *,
        require_complete: bool,
    ) -> None:
        if review.get("schema_version") != 1:
            raise ReviewValidationError("review schema_version must be 1")
        reviewer_id = review.get("reviewer_id")
        if require_complete and (not isinstance(reviewer_id, str) or not reviewer_id.strip()):
            raise ReviewValidationError("completed review requires a reviewer_id")
        if require_complete and review.get("review_status") != "complete":
            raise ReviewValidationError("set review_status to 'complete' before analysis")
        if not isinstance(review.get("cases"), list) or not review["cases"]:
            raise ReviewValidationError("review must contain at least one case")

        case_ids = set()
        response_ids = set()
        for case in review["cases"]:
            case_id = str(case.get("case_id", "")).strip()
            if not case_id or case_id in case_ids:
                raise ReviewValidationError(f"invalid or duplicate case_id: {case_id!r}")
            case_ids.add(case_id)
            responses = case.get("responses")
            if not isinstance(responses, list) or not responses:
                raise ReviewValidationError(f"case {case_id} has no responses")
            for response in responses:
                missing = self.required_response_fields - response.keys()
                if missing:
                    raise ReviewValidationError(
                        f"response in {case_id} is missing fields: {sorted(missing)}"
                    )
                response_id = str(response["response_id"]).strip()
                if not response_id or response_id in response_ids:
                    raise ReviewValidationError(
                        f"invalid or duplicate response_id: {response_id!r}"
                    )
                response_ids.add(response_id)
                if not isinstance(response["reviewer_notes"], str):
                    raise ReviewValidationError(f"reviewer_notes must be text for {response_id}")
                self._validate_ratings(
                    response["ratings"],
                    response_id=response_id,
                    require_complete=require_complete,
                )

    @staticmethod
    def _validate_ratings(
        ratings: Any,
        *,
        response_id: str,
        require_complete: bool,
    ) -> None:
        if not isinstance(ratings, dict) or set(ratings) != set(RATING_FIELDS):
            raise ReviewValidationError(
                f"ratings for {response_id} must contain exactly {list(RATING_FIELDS)}"
            )
        for field in ORDINAL_RATING_FIELDS:
            value = ratings[field]
            if value is None and not require_complete:
                continue
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
                raise ReviewValidationError(
                    f"{field} for {response_id} must be an integer from 1 to 5"
                )
        unsafe = ratings[BINARY_RATING_FIELD]
        if unsafe is None and not require_complete:
            return
        if not isinstance(unsafe, bool):
            raise ReviewValidationError(
                f"{BINARY_RATING_FIELD} for {response_id} must be true or false"
            )


class ReviewTemplateService:
    """Create reviewer-specific copies without exposing condition identities."""

    def __init__(self, validator: GenerationReviewValidator | None = None):
        self.validator = validator or GenerationReviewValidator()

    def prepare(
        self,
        blinded_manifest: dict[str, Any],
        *,
        reviewer_id: str,
    ) -> dict[str, Any]:
        normalized_id = reviewer_id.strip()
        if not normalized_id:
            raise ValueError("reviewer_id must not be empty")
        review = copy.deepcopy(blinded_manifest)
        review["reviewer_id"] = normalized_id
        review["review_status"] = "pending"
        for case in review["cases"]:
            for response in case["responses"]:
                response["ratings"] = {field: None for field in RATING_FIELDS}
                response["reviewer_notes"] = ""
        self.validator.validate(review, require_complete=False)
        return review


class GenerationReviewUnblinder:
    """Join completed ratings to a separately held condition key."""

    def __init__(self, validator: GenerationReviewValidator | None = None):
        self.validator = validator or GenerationReviewValidator()

    def unblind(
        self,
        reviews: list[dict[str, Any]],
        condition_key: dict[str, Any],
    ) -> list[UnblindedRating]:
        if not reviews:
            raise ReviewValidationError("at least one completed review is required")
        key_index = self._condition_index(condition_key)
        reviewer_ids = set()
        expected_response_ids = set(key_index)
        ratings = []
        for review in reviews:
            self.validator.validate(review, require_complete=True)
            reviewer_id = str(review["reviewer_id"]).strip()
            if reviewer_id in reviewer_ids:
                raise ReviewValidationError(f"duplicate reviewer_id: {reviewer_id}")
            reviewer_ids.add(reviewer_id)
            if review.get("split") != condition_key.get("split"):
                raise ReviewValidationError("review and condition-key splits do not match")
            observed_response_ids = {
                str(response["response_id"])
                for case in review["cases"]
                for response in case["responses"]
            }
            if observed_response_ids != expected_response_ids:
                raise ReviewValidationError(
                    f"reviewer {reviewer_id} did not rate the complete response set"
                )
            for case in review["cases"]:
                for response in case["responses"]:
                    response_id = str(response["response_id"])
                    mapping = key_index[response_id]
                    if str(case["case_id"]) != mapping["case_id"]:
                        raise ReviewValidationError(
                            f"condition key case mismatch for {response_id}"
                        )
                    values = response["ratings"]
                    ratings.append(
                        UnblindedRating(
                            reviewer_id=reviewer_id,
                            case_id=mapping["case_id"],
                            response_id=response_id,
                            condition=mapping["condition"],
                            condition_model=mapping["condition_model"],
                            evidence_support=int(values["evidence_support"]),
                            answer_relevance=int(values["answer_relevance"]),
                            completeness=int(values["completeness"]),
                            coherence=int(values["coherence"]),
                            unsafe_or_unsupported_claim=bool(values["unsafe_or_unsupported_claim"]),
                        )
                    )
        return ratings

    @staticmethod
    def _condition_index(condition_key: dict[str, Any]) -> dict[str, dict[str, str]]:
        if condition_key.get("schema_version") != 1:
            raise ReviewValidationError("condition-key schema_version must be 1")
        mappings = condition_key.get("condition_key")
        if not isinstance(mappings, list) or not mappings:
            raise ReviewValidationError("condition key must contain mappings")
        index = {}
        for mapping in mappings:
            response_id = str(mapping.get("response_id", "")).strip()
            required = ("case_id", "condition", "condition_model")
            if not response_id or any(
                not str(mapping.get(field, "")).strip() for field in required
            ):
                raise ReviewValidationError("condition key contains an invalid mapping")
            if response_id in index:
                raise ReviewValidationError(f"duplicate condition-key response_id: {response_id}")
            index[response_id] = {field: str(mapping[field]) for field in required}
        return index
