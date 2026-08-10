"""Build a condition-blinded packet for reviewer rubric calibration."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from evaluation.generation_review import (
    BINARY_RATING_FIELD,
    ORDINAL_RATING_FIELDS,
    GenerationReviewValidator,
    ReviewValidationError,
)


class CalibrationPacketBuilder:
    """Expose material rating disagreements without exposing model conditions."""

    def __init__(
        self,
        *,
        ordinal_difference_threshold: int = 2,
        validator: GenerationReviewValidator | None = None,
    ):
        if not 1 <= ordinal_difference_threshold <= 4:
            raise ValueError("ordinal_difference_threshold must be between 1 and 4")
        self.ordinal_difference_threshold = ordinal_difference_threshold
        self.validator = validator or GenerationReviewValidator()

    def build(
        self,
        blinded_manifest: dict[str, Any],
        reviews: list[dict[str, Any]],
    ) -> dict[str, Any]:
        self.validator.validate(blinded_manifest, require_complete=False)
        if len(reviews) < 2:
            raise ReviewValidationError("calibration requires at least two completed reviews")
        reviewer_ids = []
        review_indices = {}
        expected_ids = self._response_ids(blinded_manifest)
        for review in reviews:
            self.validator.validate(review, require_complete=True)
            reviewer_id = str(review["reviewer_id"])
            if reviewer_id in reviewer_ids:
                raise ReviewValidationError(f"duplicate reviewer_id: {reviewer_id}")
            if review.get("split") != blinded_manifest.get("split"):
                raise ReviewValidationError("review and manifest splits do not match")
            index = self._response_index(review)
            if set(index) != expected_ids:
                raise ReviewValidationError(
                    f"reviewer {reviewer_id} did not rate the manifest response set"
                )
            reviewer_ids.append(reviewer_id)
            review_indices[reviewer_id] = index

        cases = []
        for case in blinded_manifest["cases"]:
            response_packets = []
            for response in case["responses"]:
                response_id = str(response["response_id"])
                assessments = [
                    {
                        "reviewer_id": reviewer_id,
                        "ratings": dict(review_indices[reviewer_id][response_id]["ratings"]),
                        "reviewer_notes": str(
                            review_indices[reviewer_id][response_id]["reviewer_notes"]
                        ),
                    }
                    for reviewer_id in reviewer_ids
                ]
                disagreements = self._disagreements(assessments)
                if not disagreements:
                    continue
                response_packets.append(
                    {
                        "response_id": response_id,
                        "status": response["status"],
                        "response": response["response"],
                        "disagreements": disagreements,
                        "reviewer_assessments": assessments,
                        "adjudication": {
                            "status": "pending",
                            "consensus": {
                                disagreement["field"]: None for disagreement in disagreements
                            },
                            "rationale": "",
                        },
                    }
                )
            if response_packets:
                cases.append(
                    {
                        "case_id": case["case_id"],
                        "question": case["question"],
                        "evidence": case["evidence"],
                        "responses": response_packets,
                    }
                )
        return {
            "schema_version": 1,
            "split": blinded_manifest["split"],
            "packet_type": "condition-blinded-rubric-calibration",
            "reviewers": reviewer_ids,
            "ordinal_difference_threshold": self.ordinal_difference_threshold,
            "instructions": [
                "Discuss why the ratings differ while referring only to the raw evidence.",
                "Do not consult the condition key or infer model identity.",
                "Agree on rating anchors and the unsupported-claim decision rule.",
                "Record consensus only for calibration; do not use these cases as final evaluation.",
            ],
            "materially_disputed_cases": len(cases),
            "materially_disputed_responses": sum(len(case["responses"]) for case in cases),
            "cases": cases,
        }

    def _disagreements(
        self,
        assessments: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        disagreements = []
        for field in ORDINAL_RATING_FIELDS:
            values = {
                assessment["reviewer_id"]: int(assessment["ratings"][field])
                for assessment in assessments
            }
            difference = max(values.values()) - min(values.values())
            if difference >= self.ordinal_difference_threshold:
                disagreements.append(
                    {
                        "field": field,
                        "values": values,
                        "absolute_range": difference,
                    }
                )
        binary_values = {
            assessment["reviewer_id"]: bool(assessment["ratings"][BINARY_RATING_FIELD])
            for assessment in assessments
        }
        if len(set(binary_values.values())) > 1:
            disagreements.append(
                {
                    "field": BINARY_RATING_FIELD,
                    "values": binary_values,
                    "absolute_range": None,
                }
            )
        return disagreements

    @staticmethod
    def _response_ids(manifest: dict[str, Any]) -> set[str]:
        return {
            str(response["response_id"])
            for case in manifest["cases"]
            for response in case["responses"]
        }

    @staticmethod
    def _response_index(review: dict[str, Any]) -> dict[str, dict[str, Any]]:
        return {
            str(response["response_id"]): response
            for case in review["cases"]
            for response in case["responses"]
        }


def _load_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise TypeError(f"Expected a JSON object: {path}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--reviews", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ordinal-difference-threshold", type=int, default=2)
    args = parser.parse_args()

    packet = CalibrationPacketBuilder(
        ordinal_difference_threshold=args.ordinal_difference_threshold
    ).build(
        _load_object(args.manifest),
        [_load_object(path) for path in args.reviews],
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(packet, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
