"""Summarize a retrieval JSONL result file."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from evaluation.metrics import summarize_predictions

LOGGER = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", type=Path, required=True)
    args = parser.parse_args()

    records = [
        json.loads(line)
        for line in args.predictions.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    LOGGER.info("%s", json.dumps(summarize_predictions(records), indent=2))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
