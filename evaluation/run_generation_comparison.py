"""Run paired grounded-generation conditions and build blinded review files."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from backend.adapters.grounded_generation import (
    GroqFreeformEvidenceAnswerModel,
    GroqStructuredEvidenceAnswerModel,
    OllamaStructuredEvidenceAnswerModel,
)
from backend.evidence import EvidenceArtifactStore
from backend.generation import (
    EvidenceGroundedAnswerGenerator,
    ExtractiveEvidenceAnswerModel,
    InvalidGroundedAnswerError,
    build_evidence_generation_request,
)
from evaluation.run_grounded_generation import load_jsonl, write_jsonl

if TYPE_CHECKING:
    from backend.domain import EvidenceBundle
    from backend.generation import FreeformEvidenceAnswerModel

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
RATING_FIELDS = (
    "evidence_support",
    "answer_relevance",
    "completeness",
    "coherence",
    "unsafe_or_unsupported_claim",
)


class GenerationCondition(Protocol):
    name: str
    model_name: str

    def generate(self, evidence: EvidenceBundle) -> dict[str, Any]: ...


@dataclass(frozen=True)
class GroundedGenerationCondition:
    name: str
    generator: EvidenceGroundedAnswerGenerator

    @property
    def model_name(self) -> str:
        return self.generator.model.model_name

    def generate(self, evidence: EvidenceBundle) -> dict[str, Any]:
        try:
            answer = self.generator.generate(evidence)
        except InvalidGroundedAnswerError as exc:
            answer = self.generator.abstain(
                evidence,
                f"Generated claims failed grounding validation: {exc}",
            )
        return answer.as_dict()


@dataclass(frozen=True)
class FreeformGenerationCondition:
    name: str
    model: FreeformEvidenceAnswerModel

    @property
    def model_name(self) -> str:
        return self.model.model_name

    def generate(self, evidence: EvidenceBundle) -> dict[str, Any]:
        response = self.model.generate(build_evidence_generation_request(evidence))
        return {
            "question": evidence.question,
            "status": "answered",
            "response": response,
            "claims": [],
            "citations": [],
            "evidence_bundle_id": evidence.bundle_id,
            "video_id": evidence.video_id,
            "source_uri": evidence.source_uri,
            "clip_start_seconds": evidence.predicted_start_seconds,
            "clip_end_seconds": evidence.predicted_end_seconds,
            "clip_artifact_path": evidence.clip.artifact_path,
            "generation_model": self.model_name,
            "abstention_reason": None,
        }


class GenerationComparisonExperiment:
    """Evaluate multiple generators over the exact same persisted bundles."""

    def __init__(
        self,
        *,
        store: EvidenceArtifactStore,
        conditions: tuple[GenerationCondition, ...],
    ):
        if not conditions:
            raise ValueError("at least one generation condition is required")
        names = [condition.name for condition in conditions]
        if len(set(names)) != len(names):
            raise ValueError("generation condition names must be unique")
        self.store = store
        self.conditions = conditions

    def run(
        self,
        records: list[dict[str, Any]],
        *,
        existing_outputs: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        completed = {
            (
                str(output["sample_id"]),
                str(output["condition"]),
                str(output["condition_model"]),
            ): output
            for output in (existing_outputs or [])
            if output.get("execution_status") == "completed"
        }
        outputs = []
        for record in records:
            bundle_id = record.get("evidence_bundle_id")
            if not bundle_id:
                continue
            try:
                evidence = self.store.read_bundle(str(bundle_id))
            except (FileNotFoundError, KeyError, TypeError, ValueError) as exc:
                LOGGER.warning("Skipping unavailable bundle %s: %s", bundle_id, exc)
                continue
            for condition in self.conditions:
                cache_key = (
                    str(record["sample_id"]),
                    condition.name,
                    condition.model_name,
                )
                if cache_key in completed:
                    outputs.append(completed[cache_key])
                    continue
                started = time.monotonic()
                try:
                    answer = condition.generate(evidence)
                    execution_status = "completed"
                    error = None
                except Exception as exc:  # provider failures must remain in the audit record
                    answer = {
                        "status": "failed",
                        "response": "",
                        "claims": [],
                        "citations": [],
                        "abstention_reason": None,
                    }
                    execution_status = "failed"
                    error = f"{type(exc).__name__}: {exc}"
                outputs.append(
                    {
                        "sample_id": record["sample_id"],
                        "expected_video_id": record.get("expected_video_id"),
                        "condition": condition.name,
                        "condition_model": condition.model_name,
                        "execution_status": execution_status,
                        "generation_error": error,
                        "generation_ms": int((time.monotonic() - started) * 1000),
                        **answer,
                    }
                )
        return outputs


def comparison_report(
    outputs: list[dict[str, Any]],
    *,
    expected_conditions: tuple[str, ...],
) -> dict[str, Any]:
    by_condition = {}
    for condition in expected_conditions:
        records = [output for output in outputs if output["condition"] == condition]
        completed = [record for record in records if record["execution_status"] == "completed"]
        answered = [record for record in completed if record["status"] == "answered"]
        claims = [claim for record in answered for claim in record["claims"]]
        cited = [claim for claim in claims if claim.get("citation_ids")]
        latencies = [record["generation_ms"] for record in completed]
        by_condition[condition] = {
            "attempted": len(records),
            "completed": len(completed),
            "failed": len(records) - len(completed),
            "answered": len(answered),
            "answer_coverage": len(answered) / len(completed) if completed else 0.0,
            "claims": len(claims),
            "citation_bearing_claim_rate": len(cited) / len(claims) if claims else None,
            "mean_response_words": (
                sum(len(record["response"].split()) for record in answered) / len(answered)
                if answered
                else 0.0
            ),
            "mean_generation_ms": sum(latencies) / len(latencies) if latencies else None,
        }
    sample_conditions: dict[str, set[str]] = {}
    for output in outputs:
        if output["execution_status"] == "completed":
            sample_conditions.setdefault(str(output["sample_id"]), set()).add(
                str(output["condition"])
            )
    expected = set(expected_conditions)
    return {
        "conditions": by_condition,
        "paired_completed_samples": sum(
            completed_conditions == expected for completed_conditions in sample_conditions.values()
        ),
        "automatic_metric_boundary": (
            "Coverage, response length, latency, and citation structure do not measure "
            "medical correctness or semantic faithfulness. Use the blinded review rubric."
        ),
    }


class BlindedReviewManifestBuilder:
    """Create randomized response orders and a separately stored condition key."""

    def __init__(self, *, seed: int = 20260724):
        self.seed = seed

    def build(
        self,
        outputs: list[dict[str, Any]],
        *,
        store: EvidenceArtifactStore,
        expected_conditions: tuple[str, ...],
        split: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for output in outputs:
            if output["execution_status"] == "completed":
                grouped.setdefault(str(output["sample_id"]), []).append(output)

        cases = []
        mappings = []
        expected = set(expected_conditions)
        for sample_id, sample_outputs in sorted(grouped.items()):
            if {str(output["condition"]) for output in sample_outputs} != expected:
                continue
            evidence = store.read_bundle(str(sample_outputs[0]["evidence_bundle_id"]))
            randomized = sorted(
                sample_outputs,
                key=lambda output: hashlib.sha256(
                    f"{self.seed}:{sample_id}:{output['condition']}".encode()
                ).digest(),
            )
            responses = []
            for output in randomized:
                response_id = self._response_id(sample_id, str(output["condition"]))
                responses.append(
                    {
                        "response_id": response_id,
                        "status": output["status"],
                        "response": output["response"],
                        "ratings": {field: None for field in RATING_FIELDS},
                        "reviewer_notes": "",
                    }
                )
                mappings.append(
                    {
                        "case_id": sample_id,
                        "response_id": response_id,
                        "condition": output["condition"],
                        "condition_model": output["condition_model"],
                    }
                )
            cases.append(
                {
                    "case_id": sample_id,
                    "question": evidence.question,
                    "evidence": {
                        "video_id": evidence.video_id,
                        "clip_start_seconds": evidence.predicted_start_seconds,
                        "clip_end_seconds": evidence.predicted_end_seconds,
                        "clip_artifact_path": evidence.clip.artifact_path,
                        "transcript": [
                            {
                                "start_seconds": cue.start_seconds,
                                "end_seconds": cue.end_seconds,
                                "text": cue.text,
                            }
                            for cue in evidence.transcript
                        ],
                    },
                    "responses": responses,
                }
            )
        manifest = {
            "schema_version": 1,
            "split": split,
            "blinding_seed": self.seed,
            "rubric": {
                "evidence_support": "1 (unsupported) to 5 (fully supported)",
                "answer_relevance": "1 (irrelevant) to 5 (directly answers)",
                "completeness": "1 (critical omissions) to 5 (complete for evidence)",
                "coherence": "1 (unreadable) to 5 (clear and coherent)",
                "unsafe_or_unsupported_claim": "true or false",
            },
            "cases": cases,
        }
        key = {
            "schema_version": 1,
            "split": split,
            "condition_key": mappings,
        }
        return manifest, key

    def _response_id(self, sample_id: str, condition: str) -> str:
        identity = f"{self.seed}:{sample_id}:{condition}".encode()
        return f"R-{hashlib.sha256(identity).hexdigest()[:12]}"


def build_conditions(
    names: tuple[str, ...],
    *,
    allow_api: bool,
    groq_model: str,
    groq_api_key: str | None = None,
    ollama_base_url: str = "http://localhost:11434",
    ollama_model: str = "qwen3.5:9b-q4_K_M",
) -> tuple[GenerationCondition, ...]:
    if not names or len(set(names)) != len(names):
        raise ValueError("generation condition names must be non-empty and unique")
    supported = {
        "extractive",
        "structured-groq",
        "structured-ollama",
        "freeform-groq",
    }
    unknown = set(names) - supported
    if unknown:
        raise ValueError(f"Unknown generation conditions: {sorted(unknown)}")
    conditions: list[GenerationCondition] = []
    if "extractive" in names:
        conditions.append(
            GroundedGenerationCondition(
                name="extractive",
                generator=EvidenceGroundedAnswerGenerator(
                    ExtractiveEvidenceAnswerModel(max_claims=3)
                ),
            )
        )
    if "structured-ollama" in names:
        conditions.append(
            GroundedGenerationCondition(
                name="structured-ollama",
                generator=EvidenceGroundedAnswerGenerator(
                    OllamaStructuredEvidenceAnswerModel(
                        base_url=ollama_base_url,
                        model=ollama_model,
                    )
                ),
            )
        )
    remote = {"structured-groq", "freeform-groq"} & set(names)
    if remote:
        if not allow_api:
            raise ValueError("Groq conditions require explicit --allow-api authorization")
        api_key = (
            groq_api_key or os.environ.get("GROQ_CHAT_API_KEY") or os.environ.get("GROQ_API_KEY")
        )
        if not api_key:
            raise ValueError("GROQ_CHAT_API_KEY or GROQ_API_KEY is required")
        from groq import Groq

        client = Groq(api_key=api_key)
        if "structured-groq" in names:
            conditions.append(
                GroundedGenerationCondition(
                    name="structured-groq",
                    generator=EvidenceGroundedAnswerGenerator(
                        GroqStructuredEvidenceAnswerModel(client, model=groq_model)
                    ),
                )
            )
        if "freeform-groq" in names:
            conditions.append(
                FreeformGenerationCondition(
                    name="freeform-groq",
                    model=GroqFreeformEvidenceAnswerModel(client, model=groq_model),
                )
            )
    order = {name: index for index, name in enumerate(names)}
    return tuple(sorted(conditions, key=lambda condition: order[condition.name]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "artifacts" / "end_to_end",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "generation_comparison",
    )
    parser.add_argument("--split", choices=("validation", "test"), default="validation")
    parser.add_argument("--conditions", default="extractive")
    parser.add_argument("--groq-model", default="openai/gpt-oss-20b")
    parser.add_argument("--ollama-base-url", default="http://localhost:11434")
    parser.add_argument("--ollama-model", default="qwen3.5:9b-q4_K_M")
    parser.add_argument("--config", type=Path, default=PROJECT_ROOT / "config.yaml")
    parser.add_argument("--allow-api", action="store_true")
    parser.add_argument("--allow-test", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--blinding-seed", type=int, default=20260724)
    args = parser.parse_args()

    condition_names = tuple(name.strip() for name in args.conditions.split(",") if name.strip())
    remote_requested = bool({"structured-groq", "freeform-groq"} & set(condition_names))
    if remote_requested and args.limit is None:
        raise ValueError("Remote conditions require --limit to bound API requests")
    if args.split == "test" and remote_requested and not args.allow_test:
        raise ValueError(
            "Remote test generation requires --allow-test after validation decisions are frozen"
        )
    records = load_jsonl(args.predictions)
    records = [record for record in records if record.get("evidence_bundle_id")]
    if args.limit is not None:
        if args.limit < 1:
            raise ValueError("limit must be positive")
        records = records[: args.limit]
    configured_api_key = None
    if remote_requested and args.config.is_file():
        from backend.adapters.language_model import get_groq_chat_api_key
        from backend.config import AppSettings

        settings = AppSettings.load(args.config)
        configured_api_key = get_groq_chat_api_key(settings.as_legacy_dict())
    conditions = build_conditions(
        condition_names,
        allow_api=args.allow_api,
        groq_model=args.groq_model,
        groq_api_key=configured_api_key,
        ollama_base_url=args.ollama_base_url,
        ollama_model=args.ollama_model,
    )
    store = EvidenceArtifactStore(args.artifact_root)
    output_dir = args.output_dir / args.split
    prediction_path = output_dir / "predictions.jsonl"
    existing_outputs = (
        load_jsonl(prediction_path) if args.resume and prediction_path.is_file() else None
    )
    outputs = GenerationComparisonExperiment(store=store, conditions=conditions).run(
        records,
        existing_outputs=existing_outputs,
    )
    write_jsonl(prediction_path, outputs)
    summary = {
        "split": args.split,
        "requested_conditions": list(condition_names),
        **comparison_report(outputs, expected_conditions=condition_names),
    }
    review, key = BlindedReviewManifestBuilder(seed=args.blinding_seed).build(
        outputs,
        store=store,
        expected_conditions=condition_names,
        split=args.split,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, payload in (
        ("summary.json", summary),
        ("blinded_review.json", review),
        ("condition_key.json", key),
    ):
        (output_dir / filename).write_text(
            json.dumps(payload, indent=2) + "\n",
            encoding="utf-8",
        )
    LOGGER.info("Generation comparison summary: %s", json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
