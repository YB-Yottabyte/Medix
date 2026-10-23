#!/usr/bin/env python3
"""Resume public-only MedVidQA resource acquisition without duplicating seeds.

The completion stage treats the September full-corpus and candidate caches as
read-only seeds. New resources and per-video attempt records are written to a
new dated directory. Each phase is resumable and skips every locally available
or previously attempted resource.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from development.scripts import recover_medvidqa_full_corpus as recovery

ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT / "development/evaluation/results/week1/2026-10-01-full-download-v1"
FULL_SEED = ROOT / "development/evaluation/results/week1/2026-09-24-full-corpus-v1"
CANDIDATE_SEED = (
    ROOT / "development/evaluation/results/week1/2026-09-24-candidate-snapshot-v1/resources"
)
TRANSCRIPT_SEEDS = (FULL_SEED / "transcript_cache", CANDIDATE_SEED / "transcript_cache")
MEDIA_SEEDS = (FULL_SEED / "video_cache", CANDIDATE_SEED / "video_cache")
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json_new(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2, sort_keys=True)
        stream.write("\n")


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(temporary, path)


def initialize() -> dict[str, dict[str, Any]]:
    STAGE.mkdir(parents=True, exist_ok=True)
    for name in (
        "transcript_cache",
        "transcript_records",
        "video_cache",
        "media_records",
        "download_attempts",
        "test_clips",
    ):
        (STAGE / name).mkdir(exist_ok=True)
    source_index = STAGE / "source_index.json"
    if not source_index.exists():
        write_json_new(source_index, recovery.original_index())
    run_manifest = STAGE / "run_manifest.json"
    if not run_manifest.exists():
        write_json_new(
            run_manifest,
            {
                "created_at_utc": utc_now(),
                "dataset_video_count": 899,
                "policy": "public-only; no cookies, credentials, proxies, or impersonation",
                "transcript_workers": 1,
                "media_workers": 2,
                "transcript_seed_directories": [
                    str(path.relative_to(ROOT)) for path in TRANSCRIPT_SEEDS
                ],
                "media_seed_directories": [str(path.relative_to(ROOT)) for path in MEDIA_SEEDS],
                "new_resource_directory": str(STAGE.relative_to(ROOT)),
                "media_format_policy": recovery.FORMAT,
                "storage_reserve_bytes": 5 * 1024**3,
            },
        )
    recovery.STAGE = STAGE
    return json.loads(source_index.read_text(encoding="utf-8"))


def transcript_available(video_id: str) -> bool:
    return any(
        (directory / f"{video_id}.json").is_file()
        for directory in (*TRANSCRIPT_SEEDS, STAGE / "transcript_cache")
    )


def media_path(video_id: str) -> Path | None:
    for directory in (*MEDIA_SEEDS, STAGE / "video_cache"):
        for extension in VIDEO_EXTENSIONS:
            candidate = directory / f"{video_id}{extension}"
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
    return None


def status_payload(index: dict[str, dict[str, Any]]) -> dict[str, Any]:
    ids = set(index)
    transcript_ids = {video_id for video_id in ids if transcript_available(video_id)}
    media_ids = {video_id for video_id in ids if media_path(video_id) is not None}
    transcript_records = list((STAGE / "transcript_records").glob("*.json"))
    media_records = list((STAGE / "media_records").glob("*.json"))
    transcript_failures = sum(
        not json.loads(path.read_text(encoding="utf-8")).get("validated", False)
        for path in transcript_records
    )
    media_failures = sum(
        json.loads(path.read_text(encoding="utf-8")).get("local_media_status") != "usable"
        for path in media_records
    )
    return {
        "updated_at_utc": utc_now(),
        "dataset_videos": len(ids),
        "transcripts_available": len(transcript_ids),
        "transcripts_remaining": len(ids - transcript_ids),
        "media_available": len(media_ids),
        "media_remaining": len(ids - media_ids),
        "fully_local_resource_ready": len(transcript_ids & media_ids),
        "new_transcript_attempts": len(transcript_records),
        "new_transcript_failures": transcript_failures,
        "new_media_attempts": len(media_records),
        "new_media_failures": media_failures,
        "free_bytes": os.statvfs(STAGE).f_bavail * os.statvfs(STAGE).f_frsize,
    }


def checkpoint(index: dict[str, dict[str, Any]]) -> None:
    payload = status_payload(index)
    write_json_atomic(STAGE / "progress.json", payload)
    print(json.dumps(payload, sort_keys=True), flush=True)


def transcripts(index: dict[str, dict[str, Any]]) -> None:
    pending = [
        video_id
        for video_id in sorted(index)
        if not transcript_available(video_id)
        and not (STAGE / "transcript_records" / f"{video_id}.json").exists()
    ]
    print(f"Transcript completion: {len(pending)} pending", flush=True)
    with ThreadPoolExecutor(max_workers=1) as pool:
        futures = {pool.submit(recovery.transcript_one, video_id): video_id for video_id in pending}
        for number, future in enumerate(as_completed(futures), 1):
            video_id = futures[future]
            try:
                _, record = future.result()
            except Exception as exc:  # Preserve a durable checkpoint for unexpected worker errors.
                record = {
                    "video_id": video_id,
                    "status": "failed",
                    "validated": False,
                    "attempts": [],
                    "retry_count": 0,
                    "cue_count": 0,
                    "final_error": f"worker {type(exc).__name__}: {exc}",
                    "elapsed_seconds": None,
                }
            write_json_new(STAGE / "transcript_records" / f"{video_id}.json", record)
            if number % 25 == 0 or number == len(pending):
                checkpoint(index)


def media(index: dict[str, dict[str, Any]]) -> None:
    pending = [
        video_id
        for video_id in sorted(index)
        if media_path(video_id) is None
        and not (STAGE / "media_records" / f"{video_id}.json").exists()
    ]
    print(f"Media completion: {len(pending)} pending", flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {
            pool.submit(recovery.media_one, video_id, index[video_id]): video_id
            for video_id in pending
        }
        for number, future in enumerate(as_completed(futures), 1):
            video_id = futures[future]
            try:
                _, record = future.result()
            except Exception as exc:  # Preserve a durable checkpoint for unexpected worker errors.
                record = {
                    "video_id": video_id,
                    "local_media_status": "failed",
                    "source_probe": None,
                    "attempts": [],
                    "retry_count": 0,
                    "selected_format_id": None,
                    "file_size_bytes": None,
                    "duration_seconds": None,
                    "video_validation": None,
                    "final_error": f"worker {type(exc).__name__}: {exc}",
                    "elapsed_seconds": None,
                }
            write_json_new(STAGE / "media_records" / f"{video_id}.json", record)
            if number % 25 == 0 or number == len(pending):
                checkpoint(index)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("all", "transcripts", "media", "status"))
    args = parser.parse_args()
    index = initialize()
    lock_path = STAGE / "acquisition.lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SystemExit("A MedVidQA completion process is already running") from exc
        if args.phase in ("all", "transcripts"):
            transcripts(index)
        if args.phase in ("all", "media"):
            media(index)
        checkpoint(index)


if __name__ == "__main__":
    main()
