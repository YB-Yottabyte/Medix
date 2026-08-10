#!/usr/bin/env python3
"""Fetch public YouTube metadata for a leakage-free MedVidQA video catalog."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import requests

from evaluation.video_catalog import VideoCatalogBuilder

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


class YouTubeOEmbedMetadataFetcher:
    """Use YouTube's public oEmbed endpoint; no API key is required."""

    endpoint = "https://www.youtube.com/oembed"

    def __init__(self, *, timeout_seconds: float = 10):
        self.timeout_seconds = timeout_seconds

    def fetch(self, video_id: str) -> dict[str, str]:
        try:
            response = requests.get(
                self.endpoint,
                params={
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "format": "json",
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise RuntimeError(f"metadata unavailable for {video_id}") from exc
        return {
            "title": str(payload["title"]),
            "author_name": str(payload.get("author_name", "")),
        }


def _load_dataset_records(dataset_dir: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for filename in ("train.json", "val.json", "test.json"):
        payload = json.loads((dataset_dir / filename).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise TypeError(f"{filename} must contain a JSON list")
        records.extend(payload)
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "data" / "medvidqa_video_catalog.json",
    )
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    records = _load_dataset_records(args.dataset_dir)
    result = VideoCatalogBuilder(
        YouTubeOEmbedMetadataFetcher(timeout_seconds=args.timeout),
        workers=args.workers,
    ).build(records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result.as_serializable(), indent=2) + "\n",
        encoding="utf-8",
    )
    LOGGER.info(
        "Wrote %d video documents; %d videos unavailable",
        len(result.documents),
        len(result.unavailable_video_ids),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
