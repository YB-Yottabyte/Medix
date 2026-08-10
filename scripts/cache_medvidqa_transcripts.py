#!/usr/bin/env python3
"""Populate the local transcript cache without reading answer annotations."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from backend.adapters.transcript import TranscriptFetcher

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _video_ids(dataset_dir: Path, splits: list[str]) -> tuple[str, ...]:
    ids = set()
    for split in splits:
        path = dataset_dir / f"{split}.json"
        records = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise TypeError(f"{path} must contain a JSON list")
        ids.update(str(record["video_id"]) for record in records)
    return tuple(sorted(ids))


def _retrieved_video_ids(prediction_paths: list[Path]) -> tuple[str, ...]:
    ids = set()
    for path in prediction_paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            ids.update(str(candidate["video_id"]) for candidate in record.get("retrieved", []))
    return tuple(sorted(ids))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument(
        "--splits",
        nargs="+",
        choices=("train", "val", "test"),
        default=("val", "test"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "transcript_cache_report.json",
    )
    parser.add_argument("--retrieval-predictions", nargs="+", type=Path, default=())
    parser.add_argument("--candidate-only", action="store_true")
    args = parser.parse_args()

    fetcher = TranscriptFetcher(args.cache_dir)
    retrieved_ids = _retrieved_video_ids(list(args.retrieval_predictions))
    if args.candidate_only:
        if not retrieved_ids:
            raise ValueError("candidate-only requires retrieval prediction files")
        requested = retrieved_ids
    else:
        requested = tuple(
            sorted(set(_video_ids(args.dataset_dir, list(args.splits))) | set(retrieved_ids))
        )
    available = []
    unavailable = []
    for index, video_id in enumerate(requested, 1):
        cues = fetcher.fetch_cues(video_id)
        if cues:
            available.append(video_id)
        else:
            unavailable.append(video_id)
        if index % 10 == 0:
            LOGGER.info("Processed %d/%d videos", index, len(requested))

    report = {
        "splits": list(args.splits),
        "candidate_only": args.candidate_only,
        "retrieval_prediction_files": [str(path) for path in args.retrieval_predictions],
        "requested_videos": len(requested),
        "available_videos": len(available),
        "unavailable_videos": len(unavailable),
        "available_video_ids": available,
        "unavailable_video_ids": unavailable,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Transcript cache report: %s", json.dumps(report))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
