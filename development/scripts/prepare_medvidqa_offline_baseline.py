#!/usr/bin/env python3
"""Create a network-free media view for the frozen validation/test candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
WEEK1 = ROOT / "development/evaluation/results/week1"
DEFAULT_SNAPSHOT = WEEK1 / "2026-10-04-final-resource-snapshot-v1"
DEFAULT_RETRIEVAL = WEEK1 / "2026-09-24-candidate-snapshot-v1/retrieval"
DEFAULT_VIDEO_DIRS = (
    WEEK1 / "2026-09-24-full-corpus-v1/video_cache",
    WEEK1 / "2026-09-24-candidate-snapshot-v1/resources/video_cache",
    WEEK1 / "2026-10-01-full-download-v1/video_cache",
)
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def locate_media(video_id: str, directories: tuple[Path, ...]) -> Path | None:
    for directory in directories:
        for extension in VIDEO_EXTENSIONS:
            candidate = directory / f"{video_id}{extension}"
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate.resolve()
    return None


def build_offline_view(
    *,
    inventory_path: Path,
    transcript_cache: Path,
    retrieval_paths: tuple[Path, ...],
    video_directories: tuple[Path, ...],
    output_root: Path,
) -> dict[str, Any]:
    if output_root.exists():
        raise FileExistsError(f"Refusing to overwrite offline baseline view: {output_root}")

    inventory_rows = read_jsonl(inventory_path)
    inventory = {str(row["video_id"]): row for row in inventory_rows}
    if len(inventory) != 899:
        raise ValueError(f"Expected 899 inventory rows, found {len(inventory)}")

    retrieval_rows = [row for path in retrieval_paths for row in read_jsonl(path)]
    candidate_ids = {
        str(candidate["video_id"]) for row in retrieval_rows for candidate in row["retrieved"]
    }
    fully_usable = {
        video_id
        for video_id in candidate_ids
        if inventory.get(video_id, {}).get("final_status") == "fully_usable"
    }
    blocked = sorted(candidate_ids - fully_usable)

    resolved: dict[str, Path] = {}
    missing_media: list[str] = []
    missing_transcripts: list[str] = []
    hash_mismatches: list[str] = []
    for video_id in sorted(fully_usable):
        row = inventory[video_id]
        transcript = transcript_cache / f"{video_id}.json"
        if not transcript.is_file():
            missing_transcripts.append(video_id)
        elif sha256(transcript) != row["transcript"]["sha256"]:
            hash_mismatches.append(video_id)
        media = locate_media(video_id, video_directories)
        if media is None:
            missing_media.append(video_id)
        else:
            resolved[video_id] = media

    if missing_media or missing_transcripts or hash_mismatches:
        raise ValueError(
            "Offline baseline inputs are incomplete: "
            f"missing_media={len(missing_media)}, "
            f"missing_transcripts={len(missing_transcripts)}, "
            f"transcript_hash_mismatches={len(hash_mismatches)}; "
            f"media_ids={missing_media[:10]}, "
            f"transcript_ids={missing_transcripts[:10]}, "
            f"hash_ids={hash_mismatches[:10]}"
        )

    video_cache = output_root / "video_cache"
    video_cache.mkdir(parents=True)
    resource_rows = []
    for video_id, source in sorted(resolved.items()):
        link = video_cache / source.name
        os.symlink(source, link)
        row = inventory[video_id]
        resource_rows.append(
            {
                "video_id": video_id,
                "transcript_path": str((transcript_cache / f"{video_id}.json").resolve()),
                "transcript_sha256": row["transcript"]["sha256"],
                "media_source_path": str(source),
                "media_view_path": str(link.absolute()),
                "media_sha256": row["media"]["sha256"],
                "media_size_bytes": source.stat().st_size,
            }
        )

    manifest = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "network_acquisition": False,
        "inventory": {
            "path": str(inventory_path.resolve()),
            "sha256": sha256(inventory_path),
            "rows": len(inventory_rows),
        },
        "frozen_retrieval": [
            {"path": str(path.resolve()), "sha256": sha256(path)} for path in retrieval_paths
        ],
        "candidate_union": len(candidate_ids),
        "fully_usable_candidates": len(fully_usable),
        "resource_blocked_candidates": blocked,
        "transcript_cache": str(transcript_cache.resolve()),
        "video_cache": str(video_cache.resolve()),
        "video_seed_directories": [str(path.resolve()) for path in video_directories],
        "resources": resource_rows,
    }
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_root / "manifest.sha256").write_text(
        f"{sha256(manifest_path)}  manifest.json\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--inventory",
        type=Path,
        default=DEFAULT_SNAPSHOT / "video_inventory.jsonl",
    )
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=DEFAULT_SNAPSHOT / "transcript_cache",
    )
    parser.add_argument(
        "--frozen-retrieval",
        action="append",
        type=Path,
        default=[],
        help="Frozen retrieval JSONL; repeat for validation and test.",
    )
    parser.add_argument(
        "--video-seed-cache",
        action="append",
        type=Path,
        default=[],
        help="Directory containing validated media; repeat as needed.",
    )
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()

    retrieval_paths = tuple(args.frozen_retrieval) or (
        DEFAULT_RETRIEVAL / "validation.jsonl",
        DEFAULT_RETRIEVAL / "test.jsonl",
    )
    video_directories = tuple(args.video_seed_cache) or DEFAULT_VIDEO_DIRS
    manifest = build_offline_view(
        inventory_path=args.inventory,
        transcript_cache=args.transcript_cache,
        retrieval_paths=retrieval_paths,
        video_directories=video_directories,
        output_root=args.output_root,
    )
    print(
        json.dumps(
            {
                "candidate_union": manifest["candidate_union"],
                "fully_usable_candidates": manifest["fully_usable_candidates"],
                "resource_blocked_candidates": len(manifest["resource_blocked_candidates"]),
                "video_cache": manifest["video_cache"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
