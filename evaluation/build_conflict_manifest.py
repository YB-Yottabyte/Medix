"""Build a review-required cross-modal evidence-conflict benchmark manifest."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any, ClassVar

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


class ConflictManifestValidator:
    """Validate benchmark structure without asserting unreviewed medical labels."""

    conflict_types: ClassVar[set[str]] = {
        "aligned",
        "visual_conflict",
        "ambiguous_visual_resolves",
    }
    dispositions: ClassVar[set[str]] = {"answer", "abstain"}
    review_statuses: ClassVar[set[str]] = {"pending", "approved", "rejected"}
    required_fields: ClassVar[set[str]] = {
        "case_id",
        "conflict_type",
        "question",
        "question_source_sample_id",
        "expected_video_id",
        "visual_source_sample_id",
        "visual_source_video_id",
        "visual_timestamp_seconds",
        "expected_disposition",
        "review_status",
    }

    def validate(self, cases: list[dict[str, Any]]) -> None:
        case_ids: set[str] = set()
        for case in cases:
            missing = self.required_fields - case.keys()
            if missing:
                raise ValueError(f"Conflict case is missing fields: {sorted(missing)}")
            case_id = str(case["case_id"])
            if case_id in case_ids:
                raise ValueError(f"Duplicate conflict case_id: {case_id}")
            case_ids.add(case_id)
            if case["conflict_type"] not in self.conflict_types:
                raise ValueError(f"Unsupported conflict_type in {case_id}")
            if case["expected_disposition"] not in self.dispositions:
                raise ValueError(f"Unsupported expected_disposition in {case_id}")
            if case["review_status"] not in self.review_statuses:
                raise ValueError(f"Unsupported review_status in {case_id}")
            if float(case["visual_timestamp_seconds"]) < 0:
                raise ValueError(f"Negative visual timestamp in {case_id}")


def build_conflict_manifest(
    records: list[dict[str, Any]],
    source_cases: int = 8,
) -> list[dict[str, Any]]:
    """Create aligned, conflicting, and visually resolved cases for later review."""

    if source_cases < 1:
        raise ValueError("source_cases must be positive")
    unique_records = _one_record_per_video(records)
    if len(unique_records) < 2:
        raise ValueError("At least two distinct videos are required")

    selected = unique_records[: min(source_cases, len(unique_records))]
    cases: list[dict[str, Any]] = []
    for index, source in enumerate(selected):
        distractor = unique_records[(index + 1) % len(unique_records)]
        cases.extend(
            (
                _make_case(source, source, "aligned", str(source["question"]), "answer"),
                _make_case(
                    source,
                    distractor,
                    "visual_conflict",
                    str(source["question"]),
                    "abstain",
                ),
                _make_case(
                    source,
                    source,
                    "ambiguous_visual_resolves",
                    "What should I do next?",
                    "answer",
                ),
            )
        )
    ConflictManifestValidator().validate(cases)
    return cases


def _one_record_per_video(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for record in records:
        unique.setdefault(str(record["video_id"]), record)
    return list(unique.values())


def _make_case(
    question_source: dict[str, Any],
    visual_source: dict[str, Any],
    conflict_type: str,
    question: str,
    expected_disposition: str,
) -> dict[str, Any]:
    question_sample = str(question_source["sample_id"])
    visual_sample = str(visual_source["sample_id"])
    visual_start = float(visual_source.get("answer_start_second", 0))
    visual_end = float(visual_source.get("answer_end_second", visual_start))
    return {
        "case_id": f"{conflict_type}-{question_sample}-{visual_sample}",
        "conflict_type": conflict_type,
        "question": question,
        "question_source_sample_id": question_sample,
        "expected_video_id": str(question_source["video_id"]),
        "visual_source_sample_id": visual_sample,
        "visual_source_video_id": str(visual_source["video_id"]),
        "visual_timestamp_seconds": (visual_start + visual_end) / 2,
        "expected_disposition": expected_disposition,
        "review_status": "pending",
        "review_notes": (
            "Generated structural case. Confirm that the referenced frame is visible, "
            "relevant, and medically appropriate before use."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=PROJECT_ROOT / "MedVidQA" / "cleaned" / "val.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "datasets" / "evidence_conflicts.json",
    )
    parser.add_argument("--source-cases", type=int, default=8)
    args = parser.parse_args()

    records = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise TypeError("Conflict-manifest input must be a JSON list")
    cases = build_conflict_manifest(records, source_cases=args.source_cases)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(cases, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Wrote %d pending-review conflict cases to %s", len(cases), args.output)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
