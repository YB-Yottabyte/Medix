#!/usr/bin/env python3
"""Cache low-resolution MedVidQA videos for offline frame extraction."""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
from pathlib import Path

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def _requested_video_ids(
    dataset_dir: Path,
    transcript_cache: Path,
    splits: list[str],
) -> tuple[str, ...]:
    transcript_ids = {path.stem for path in transcript_cache.glob("*.json")}
    ids = set()
    for split in splits:
        records = json.loads((dataset_dir / f"{split}.json").read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise TypeError(f"{split}.json must contain a JSON list")
        ids.update(
            str(record["video_id"])
            for record in records
            if str(record["video_id"]) in transcript_ids
        )
    return tuple(sorted(ids))


def _retrieved_video_ids(prediction_paths: list[Path]) -> tuple[str, ...]:
    ids = set()
    for path in prediction_paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            ids.update(str(candidate["video_id"]) for candidate in record.get("retrieved", []))
    return tuple(sorted(ids))


def _already_cached(output_dir: Path, video_id: str) -> bool:
    return any(
        (output_dir / f"{video_id}{extension}").is_file()
        for extension in (".mp4", ".webm", ".mkv", ".mov")
    )


def _download(video_id: str, output_dir: Path, yt_dlp_binary: str) -> str | None:
    if not _VIDEO_ID.fullmatch(video_id):
        raise ValueError(f"Unsupported video ID: {video_id}")
    if _already_cached(output_dir, video_id):
        return "cached"
    command = [
        yt_dlp_binary,
        "--no-playlist",
        "--no-progress",
        "--quiet",
        "--format",
        "bestvideo[height<=360]+bestaudio/best[height<=360]/worst",
        "--merge-output-format",
        "mp4",
        "--output",
        str(output_dir / "%(id)s.%(ext)s"),
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    try:
        subprocess.run(command, check=True, timeout=300)
    except (OSError, subprocess.SubprocessError):
        return None
    return "downloaded" if _already_cached(output_dir, video_id) else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "data" / "video_cache",
    )
    parser.add_argument(
        "--splits",
        nargs="+",
        choices=("train", "val", "test"),
        default=("val", "test"),
    )
    parser.add_argument("--yt-dlp-binary", default="yt-dlp")
    parser.add_argument("--retrieval-predictions", nargs="+", type=Path, default=())
    parser.add_argument("--candidate-only", action="store_true")
    parser.add_argument(
        "--report",
        type=Path,
        default=PROJECT_ROOT / "evaluation" / "results" / "video_cache_report.json",
    )
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    transcript_ids = {path.stem for path in args.transcript_cache.glob("*.json")}
    retrieved_ids = set(_retrieved_video_ids(list(args.retrieval_predictions)))
    if args.candidate_only:
        if not retrieved_ids:
            raise ValueError("candidate-only requires retrieval prediction files")
        requested = tuple(sorted(retrieved_ids & transcript_ids))
    else:
        requested = tuple(
            sorted(
                set(
                    _requested_video_ids(
                        args.dataset_dir,
                        args.transcript_cache,
                        list(args.splits),
                    )
                )
                | (retrieved_ids & transcript_ids)
            )
        )
    downloaded = []
    cached = []
    unavailable = []
    for index, video_id in enumerate(requested, 1):
        status = _download(video_id, args.output_dir, args.yt_dlp_binary)
        if status == "downloaded":
            downloaded.append(video_id)
        elif status == "cached":
            cached.append(video_id)
        else:
            unavailable.append(video_id)
        LOGGER.info("Processed %d/%d videos: %s", index, len(requested), status or "unavailable")

    report = {
        "splits": list(args.splits),
        "candidate_only": args.candidate_only,
        "retrieval_prediction_files": [str(path) for path in args.retrieval_predictions],
        "requested_videos": len(requested),
        "downloaded_videos": len(downloaded),
        "already_cached_videos": len(cached),
        "unavailable_videos": len(unavailable),
        "downloaded_video_ids": downloaded,
        "already_cached_video_ids": cached,
        "unavailable_video_ids": unavailable,
        "maximum_requested_height": 360,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Video cache report: %s", json.dumps(report))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
