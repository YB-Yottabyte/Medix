"""Evaluate evidence-constrained generation from persisted pipeline bundles."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from backend.evidence import EvidenceArtifactStore
from backend.generation import (
    EvidenceGroundedAnswerGenerator,
    ExtractiveEvidenceAnswerModel,
)
from backend.generation.grounded import GENERATION_ABSTENTION_MESSAGE

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records = []
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if line.strip():
                payload = json.loads(line)
                if not isinstance(payload, dict):
                    raise ValueError(f"Expected JSON object at {path}:{line_number}")
                records.append(payload)
    return records


def evaluate_grounded_generation(
    records: list[dict[str, Any]],
    *,
    store: EvidenceArtifactStore,
    generator: EvidenceGroundedAnswerGenerator,
) -> list[dict[str, Any]]:
    predictions = []
    for record in records:
        bundle_id = record.get("evidence_bundle_id")
        if not bundle_id:
            predictions.append(
                {
                    "sample_id": record["sample_id"],
                    "question": record["question"],
                    "expected_video_id": record.get("expected_video_id"),
                    "status": "abstained",
                    "response": GENERATION_ABSTENTION_MESSAGE,
                    "claims": [],
                    "citations": [],
                    "evidence_bundle_id": None,
                    "predicted_video_id": None,
                    "abstention_reason": record.get("abstention_reason")
                    or "Upstream pipeline produced no evidence bundle.",
                    "generation_model": generator.model.model_name,
                }
            )
            continue
        try:
            evidence = store.read_bundle(str(bundle_id))
            answer = generator.generate(evidence)
            prediction = answer.as_dict()
        except (FileNotFoundError, KeyError, TypeError, ValueError) as exc:
            prediction = {
                "status": "abstained",
                "response": GENERATION_ABSTENTION_MESSAGE,
                "claims": [],
                "citations": [],
                "evidence_bundle_id": str(bundle_id),
                "video_id": record.get("predicted_video_id"),
                "abstention_reason": f"Evidence generation failed: {exc}",
                "generation_model": generator.model.model_name,
            }
        predictions.append(
            {
                "sample_id": record["sample_id"],
                "expected_video_id": record.get("expected_video_id"),
                "predicted_video_id": prediction.get("video_id"),
                **prediction,
            }
        )
    return predictions


def grounded_generation_report(predictions: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(predictions)
    upstream_available = [
        prediction for prediction in predictions if prediction.get("evidence_bundle_id")
    ]
    answered = [prediction for prediction in predictions if prediction["status"] == "answered"]
    claims = [claim for prediction in answered for claim in prediction["claims"]]
    cited_claims = []
    extractive_claims = []
    for prediction in answered:
        citations = {citation["cue_id"]: citation for citation in prediction["citations"]}
        for claim in prediction["claims"]:
            if not claim["citation_ids"] or not all(
                cue_id in citations for cue_id in claim["citation_ids"]
            ):
                continue
            cited_claims.append(claim)
            if any(
                claim["text"].strip() == citations[cue_id]["text"].strip()
                for cue_id in claim["citation_ids"]
            ):
                extractive_claims.append(claim)
    correct_video = [
        prediction
        for prediction in answered
        if prediction.get("predicted_video_id") == prediction.get("expected_video_id")
    ]
    return {
        "samples": total,
        "upstream_evidence_available": len(upstream_available),
        "upstream_evidence_coverage": len(upstream_available) / total if total else 0.0,
        "generation_answered": len(answered),
        "overall_answer_coverage": len(answered) / total if total else 0.0,
        "conditional_generation_coverage": (
            len(answered) / len(upstream_available) if upstream_available else 0.0
        ),
        "selected_video_accuracy_of_generated_answers": (
            len(correct_video) / len(answered) if answered else 0.0
        ),
        "claims": len(claims),
        "mean_claims_per_answer": len(claims) / len(answered) if answered else 0.0,
        "valid_citation_claim_rate": len(cited_claims) / len(claims) if claims else 0.0,
        "verbatim_extractive_claim_rate": (len(extractive_claims) / len(claims) if claims else 0.0),
        "interpretation_boundary": (
            "MedVidQA supplies temporal segments but no reference answer text. These "
            "metrics verify provenance and extractiveness, not clinical correctness, "
            "semantic entailment, completeness, or usefulness."
        ),
    }


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--predictions",
        type=Path,
        default=(
            PROJECT_ROOT
            / "evaluation"
            / "results"
            / "end_to_end"
            / "validation"
            / "predictions.jsonl"
        ),
    )
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "artifacts" / "end_to_end",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "grounded_generation",
    )
    parser.add_argument("--split", choices=("validation", "test"), default="validation")
    parser.add_argument("--max-claims", type=int, default=3)
    args = parser.parse_args()

    generator = EvidenceGroundedAnswerGenerator(
        ExtractiveEvidenceAnswerModel(max_claims=args.max_claims)
    )
    predictions = evaluate_grounded_generation(
        load_jsonl(args.predictions),
        store=EvidenceArtifactStore(args.artifact_root),
        generator=generator,
    )
    output_dir = args.output_dir / args.split
    write_jsonl(output_dir / "predictions.jsonl", predictions)
    summary = {
        "split": args.split,
        "generation_model": generator.model.model_name,
        "max_claims": args.max_claims,
        **grounded_generation_report(predictions),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("Grounded-generation summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
