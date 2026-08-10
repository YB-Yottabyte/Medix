"""Tests for blinded review validation, unblinding, and statistics."""

from __future__ import annotations

import pytest

from evaluation.build_generation_calibration import CalibrationPacketBuilder
from evaluation.generation_review import (
    GenerationReviewUnblinder,
    GenerationReviewValidator,
    ReviewTemplateService,
    ReviewValidationError,
)
from evaluation.summarize_generation_reviews import summarize_reviews


def make_manifest() -> dict:
    return {
        "schema_version": 1,
        "split": "validation",
        "rubric": {},
        "cases": [
            {
                "case_id": "case-1",
                "question": "Question one",
                "evidence": {},
                "responses": [
                    {
                        "response_id": "R-1A",
                        "status": "answered",
                        "response": "First",
                        "ratings": {},
                        "reviewer_notes": "",
                    },
                    {
                        "response_id": "R-1B",
                        "status": "answered",
                        "response": "Second",
                        "ratings": {},
                        "reviewer_notes": "",
                    },
                ],
            },
            {
                "case_id": "case-2",
                "question": "Question two",
                "evidence": {},
                "responses": [
                    {
                        "response_id": "R-2B",
                        "status": "answered",
                        "response": "Second",
                        "ratings": {},
                        "reviewer_notes": "",
                    },
                    {
                        "response_id": "R-2A",
                        "status": "answered",
                        "response": "First",
                        "ratings": {},
                        "reviewer_notes": "",
                    },
                ],
            },
        ],
    }


def make_key() -> dict:
    return {
        "schema_version": 1,
        "split": "validation",
        "condition_key": [
            {
                "case_id": "case-1",
                "response_id": "R-1A",
                "condition": "structured",
                "condition_model": "structured-v1",
            },
            {
                "case_id": "case-1",
                "response_id": "R-1B",
                "condition": "freeform",
                "condition_model": "freeform-v1",
            },
            {
                "case_id": "case-2",
                "response_id": "R-2A",
                "condition": "structured",
                "condition_model": "structured-v1",
            },
            {
                "case_id": "case-2",
                "response_id": "R-2B",
                "condition": "freeform",
                "condition_model": "freeform-v1",
            },
        ],
    }


def complete_review(reviewer_id: str, *, offset: int = 0) -> dict:
    review = ReviewTemplateService().prepare(
        make_manifest(),
        reviewer_id=reviewer_id,
    )
    review["review_status"] = "complete"
    for case in review["cases"]:
        for response in case["responses"]:
            structured = response["response_id"].endswith("A")
            score = (5 if structured else 3) - offset
            response["ratings"] = {
                "evidence_support": score,
                "answer_relevance": score,
                "completeness": score,
                "coherence": score,
                "unsafe_or_unsupported_claim": not structured,
            }
    return review


def test_review_template_resets_identity_and_ratings() -> None:
    review = ReviewTemplateService().prepare(
        make_manifest(),
        reviewer_id="reviewer-01",
    )

    assert review["reviewer_id"] == "reviewer-01"
    assert review["review_status"] == "pending"
    assert all(
        value is None
        for case in review["cases"]
        for response in case["responses"]
        for value in response["ratings"].values()
    )


def test_completed_review_requires_valid_rating_ranges() -> None:
    review = complete_review("reviewer-01")
    review["cases"][0]["responses"][0]["ratings"]["coherence"] = 6

    with pytest.raises(ReviewValidationError, match="integer from 1 to 5"):
        GenerationReviewValidator().validate(review, require_complete=True)


def test_unblinding_requires_explicit_completion() -> None:
    review = ReviewTemplateService().prepare(
        make_manifest(),
        reviewer_id="reviewer-01",
    )

    with pytest.raises(ReviewValidationError, match="review_status"):
        GenerationReviewUnblinder().unblind([review], make_key())


def test_unblinding_and_paired_statistics() -> None:
    ratings = GenerationReviewUnblinder().unblind(
        [
            complete_review("reviewer-01"),
            complete_review("reviewer-02", offset=1),
        ],
        make_key(),
    )

    summary = summarize_reviews(ratings, bootstrap_samples=100, seed=7)

    assert len(ratings) == 8
    assert summary["reviewer_count"] == 2
    assert summary["conditions"]["structured"]["evidence_support"]["mean"] == 4.5
    assert (
        summary["reviewer_condition_summaries"]["reviewer-01"]["structured"]["evidence_support"][
            "mean"
        ]
        == 5
    )
    comparison = summary["paired_condition_comparisons"]["freeform_minus_structured"]
    assert comparison["ordinal"]["evidence_support"]["mean_difference"] == -2
    assert comparison["unsafe_or_unsupported_claim"]["unsafe_rate_difference"] == 1
    assert summary["inter_rater_agreement"]["available"] is True
    agreement = summary["inter_rater_agreement"]["conditions"]["structured"]["evidence_support"][
        "reviewer_pairs"
    ][0]
    assert agreement["observed_agreement"] == 0


def test_calibration_packet_is_condition_blinded_and_filters_agreement() -> None:
    blinded = ReviewTemplateService().prepare(
        make_manifest(),
        reviewer_id="template",
    )
    reviewer_one = complete_review("reviewer-01")
    reviewer_two = complete_review("reviewer-02", offset=1)
    disputed = reviewer_two["cases"][0]["responses"][0]["ratings"]
    disputed["evidence_support"] = 1
    disputed["unsafe_or_unsupported_claim"] = True

    packet = CalibrationPacketBuilder(ordinal_difference_threshold=2).build(
        blinded,
        [reviewer_one, reviewer_two],
    )

    assert packet["materially_disputed_responses"] == 1
    response = packet["cases"][0]["responses"][0]
    assert "condition" not in response
    assert {item["field"] for item in response["disagreements"]} == {
        "evidence_support",
        "unsafe_or_unsupported_claim",
    }
