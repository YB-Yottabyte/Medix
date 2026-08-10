"""Create a stable evaluation manifest from an official MedVidQA split."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

from evaluation.medvidqa_dataset import timestamp_seconds

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / "MedVidQA" / "test.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "evaluation" / "datasets" / "medvidqa_test.json"


def build_manifest(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "sample_id": str(record["sample_id"]),
            "question": str(record["question"]),
            "expected_video_id": str(record["video_id"]),
            "expected_start": timestamp_seconds(
                record,
                "answer_start_second",
                "answer_start",
            ),
            "expected_end": timestamp_seconds(
                record,
                "answer_end_second",
                "answer_end",
            ),
        }
        for record in records
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    source = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(source, list):
        raise TypeError("MedVidQA split must contain a JSON list")

    manifest = build_manifest(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("Wrote %d evaluation samples to %s", len(manifest), args.output)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
