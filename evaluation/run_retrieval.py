"""Run the configured Medix retriever against a frozen evaluation manifest."""

from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path
from typing import Any

from backend.config import AppSettings, ProjectPaths
from backend.container import ServiceFactory

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "datasets" / "medvidqa_test.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "retrieval.jsonl",
    )
    parser.add_argument("--config", type=Path, default=PROJECT_ROOT / "config.yaml")
    args = parser.parse_args()

    paths = ProjectPaths.discover()
    settings = AppSettings.load(args.config)
    services = ServiceFactory(settings, paths).build()
    if not services.ready or services.qa is None:
        raise RuntimeError(services.startup_error or "Medix services are unavailable")

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(manifest, list):
        raise TypeError("Evaluation manifest must contain a JSON list")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as output:
        for sample in manifest:
            output.write(json.dumps(_run_sample(sample, services.qa.retriever)) + "\n")
    LOGGER.info("Wrote %d predictions to %s", len(manifest), args.output)


def _run_sample(sample: dict[str, Any], retriever: Any) -> dict[str, Any]:
    started = time.monotonic()
    sample_id = str(sample["sample_id"])
    retrieved = [
        item
        for item in retriever.search(str(sample["question"]))
        if str(item.get("sample_id", "")) != sample_id
    ]
    return {
        **sample,
        "evaluation_protocol": "leave-one-question-out",
        "retrieval_ms": int((time.monotonic() - started) * 1000),
        "retrieved": [
            {
                "rank": rank,
                "video_id": item.get("video_id"),
                "question": item.get("question"),
                "answer_start": item.get("answer_start"),
                "answer_end": item.get("answer_end"),
                "similarity_score": item.get("similarity_score"),
                "semantic_score": item.get("semantic_score"),
                "lexical_score": item.get("lexical_score"),
            }
            for rank, item in enumerate(retrieved, 1)
        ],
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
