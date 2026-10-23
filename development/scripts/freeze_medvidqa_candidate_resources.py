#!/usr/bin/env python3
"""Freeze validation/test Top-5 candidates and their offline resources."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import shutil
import subprocess
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.video_processing import OnDemandVideoRepository, VideoUnavailableError

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "development/evaluation/results/week1/2026-09-24-candidate-snapshot-v1"
RETRIEVAL = SNAPSHOT / "retrieval"
FULL_CORPUS = ROOT / "development/evaluation/results/week1/2026-09-24-full-corpus-v1"
CATALOG = ROOT / "data/medvidqa_video_catalog.json"
SPLITS = {"validation": ROOT / "MedVidQA/val.json", "test": ROOT / "MedVidQA/test.json"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_new(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, ensure_ascii=False, sort_keys=True)
        stream.write("\n")


def retrieval_rows() -> dict[str, list[dict[str, Any]]]:
    rows = {
        split: [
            json.loads(line) for line in (RETRIEVAL / f"{split}.jsonl").read_text().splitlines()
        ]
        for split in SPLITS
    }
    assert len(rows["validation"]) == 145
    assert len(rows["test"]) == 155
    assert all(len(row["retrieved"]) == 5 for split_rows in rows.values() for row in split_rows)
    return rows


def candidate_ids(rows: dict[str, list[dict[str, Any]]]) -> set[str]:
    return {
        str(candidate["video_id"])
        for split_rows in rows.values()
        for row in split_rows
        for candidate in row["retrieved"]
    }


def freeze() -> None:
    rows = retrieval_rows()
    usage = Counter(
        str(candidate["video_id"])
        for split_rows in rows.values()
        for row in split_rows
        for candidate in row["retrieved"]
    )
    by_split = {
        split: sorted(
            {str(candidate["video_id"]) for row in split_rows for candidate in row["retrieved"]}
        )
        for split, split_rows in rows.items()
    }
    payload = {
        "frozen_at_utc": utc_now(),
        "rule": "Rankings and scores are immutable after this freeze.",
        "top_k": 5,
        "lexical_weight": 0.15,
        "catalog_videos": 852,
        "retrieval_model": rows["validation"][0]["retrieval_model"],
        "catalog": {"path": str(CATALOG.relative_to(ROOT)), "sha256": sha256(CATALOG)},
        "splits": {
            split: {
                "path": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
                "questions": len(rows[split]),
                "candidate_slots": sum(len(row["retrieved"]) for row in rows[split]),
                "unique_candidate_ids": by_split[split],
                "retrieval_path": str((RETRIEVAL / f"{split}.jsonl").relative_to(ROOT)),
                "retrieval_sha256": sha256(RETRIEVAL / f"{split}.jsonl"),
                "summary_sha256": sha256(RETRIEVAL / f"{split}.summary.json"),
            }
            for split, path in SPLITS.items()
        },
        "unique_candidate_union": sorted(usage),
        "candidate_usage_counts": dict(sorted(usage.items())),
    }
    write_new(SNAPSHOT / "retrieval_freeze.json", payload)
    print(
        json.dumps(
            {
                "validation_unique": len(by_split["validation"]),
                "test_unique": len(by_split["test"]),
                "union": len(usage),
            },
            indent=2,
        )
    )


def _validate_transcript(path: Path) -> tuple[bool, int, str | None]:
    try:
        cues = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(cues, list) or not cues:
            return False, 0, "empty transcript"
        valid_cues = 0
        for cue in cues:
            if not str(cue["text"]).strip():
                continue
            if float(cue["start"]) < 0 or float(cue["duration"]) < 0:
                return False, len(cues), "invalid timestamp"
            valid_cues += 1
        if not valid_cues:
            return False, len(cues), "no nonblank transcript cues"
        return True, valid_cues, None
    except (OSError, KeyError, TypeError, ValueError) as exc:
        return False, 0, f"{type(exc).__name__}: {exc}"


def prepare_transcripts() -> None:
    rows = retrieval_rows()
    ids = sorted(candidate_ids(rows))
    destination = SNAPSHOT / "resources/transcript_cache"
    records = SNAPSHOT / "resources/transcript_records"
    destination.mkdir(parents=True, exist_ok=True)
    source = FULL_CORPUS / "transcript_cache"
    reused = 0
    missing = []
    for video_id in ids:
        source_path = source / f"{video_id}.json"
        record_path = records / f"{video_id}.json"
        if record_path.is_file():
            continue
        if source_path.is_file():
            target = destination / source_path.name
            if not target.exists():
                shutil.copyfile(source_path, target)
            valid, count, error = _validate_transcript(target)
            write_new(
                record_path,
                {
                    "video_id": video_id,
                    "status": "reused" if valid else "invalid",
                    "validated": valid,
                    "cue_count": count,
                    "sha256": sha256(target) if valid else None,
                    "source_path": str(source_path.relative_to(ROOT)),
                    "error": error,
                },
            )
            reused += int(valid)
        else:
            missing.append(video_id)

    block = {
        "observed_at_utc": utc_now(),
        "missing_candidate_transcripts": len(missing),
        "youtube_transcript_api_probe": {
            "video_id": "-2u9hOvt1GY",
            "result": "IpBlocked",
        },
        "yt_dlp_caption_probe": {
            "video_id": "-2u9hOvt1GY",
            "result": "HTTP Error 429: Too Many Requests",
        },
        "policy": (
            "Circuit breaker opened after both public transcript paths returned source-wide "
            "blocking. Remaining IDs were not hammered and may be retried in a later bounded pass."
        ),
    }
    block_path = SNAPSHOT / "resources/transcript-source-block.json"
    if not block_path.exists():
        write_new(block_path, block)
    for video_id in missing:
        record_path = records / f"{video_id}.json"
        if record_path.exists():
            continue
        write_new(
            record_path,
            {
                "video_id": video_id,
                "status": "source_blocked_not_attempted",
                "validated": False,
                "cue_count": 0,
                "sha256": None,
                "source_path": None,
                "error": (
                    "Transcript source circuit breaker: youtube-transcript-api IpBlocked; "
                    "yt-dlp public captions HTTP 429"
                ),
            },
        )
    print(json.dumps({"reused": reused, "source_blocked": len(missing)}, indent=2))


def acquire_media() -> None:
    rows = retrieval_rows()
    ids = sorted(candidate_ids(rows))
    result_dir = SNAPSHOT / "resources/media_results"
    result_dir.mkdir(parents=True, exist_ok=True)
    repository = OnDemandVideoRepository(
        SNAPSHOT / "resources/video_cache",
        source_index=FULL_CORPUS / "source_index.json",
        metadata_dir=SNAPSHOT / "resources/media_metadata",
        max_cache_bytes=20 * 1024**3,
        seed_dirs=(FULL_CORPUS / "video_cache",),
    )
    pending = [video_id for video_id in ids if not (result_dir / f"{video_id}.json").is_file()]
    print(f"Candidate media: {len(ids)} total, {len(pending)} pending", flush=True)

    def resolve(video_id: str) -> dict[str, Any]:
        started = time.monotonic()
        try:
            path = repository.resolve(video_id)
            status = (
                "reused"
                if path.parent.resolve() == (FULL_CORPUS / "video_cache").resolve()
                else "acquired"
            )
            return {
                "video_id": video_id,
                "status": status,
                "path": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
                "size_bytes": path.stat().st_size,
                "error": None,
                "elapsed_seconds": round(time.monotonic() - started, 3),
            }
        except (OSError, VideoUnavailableError) as exc:
            return {
                "video_id": video_id,
                "status": "failed",
                "path": None,
                "sha256": None,
                "size_bytes": None,
                "error": f"{type(exc).__name__}: {exc}",
                "elapsed_seconds": round(time.monotonic() - started, 3),
            }

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(resolve, video_id): video_id for video_id in pending}
        for number, future in enumerate(as_completed(futures), 1):
            result = future.result()
            write_new(result_dir / f"{result['video_id']}.json", result)
            if number % 25 == 0 or number == len(pending):
                print(
                    f"Media {number}/{len(pending)}: {result['video_id']} {result['status']}",
                    flush=True,
                )


def _tool_versions() -> dict[str, str]:
    def first(command: list[str]) -> str:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        return (result.stdout or result.stderr).splitlines()[0]

    return {
        "python": platform.python_version(),
        "youtube_transcript_api": importlib.metadata.version("youtube-transcript-api"),
        "yt_dlp": "2026.08.19",
        "yt_dlp_ejs": "0.8.0",
        "deno": first(["deno", "--version"]),
        "ffmpeg": first(["ffmpeg", "-version"]),
        "ffprobe": first(["ffprobe", "-version"]),
    }


def finalize() -> None:
    freeze_payload = json.loads((SNAPSHOT / "retrieval_freeze.json").read_text())
    rows = retrieval_rows()
    usage = freeze_payload["candidate_usage_counts"]
    source_index = json.loads((FULL_CORPUS / "source_index.json").read_text())
    entries = []
    for video_id in freeze_payload["unique_candidate_union"]:
        transcript = json.loads(
            (SNAPSHOT / "resources/transcript_records" / f"{video_id}.json").read_text()
        )
        media = json.loads((SNAPSHOT / "resources/media_results" / f"{video_id}.json").read_text())
        media_events = []
        journal = SNAPSHOT / "resources/media_metadata/media-cache-events.jsonl"
        if journal.is_file():
            media_events = [
                event
                for event in (json.loads(line) for line in journal.read_text().splitlines())
                if event.get("video_id") == video_id
            ]
        entries.append(
            {
                "video_id": video_id,
                "source_url": source_index[video_id]["source_url"],
                "candidate_usage_count": int(usage[video_id]),
                "transcript_status": transcript["status"],
                "transcript_validated": transcript["validated"],
                "transcript_sha256": transcript["sha256"],
                "transcript_error": transcript["error"],
                "media_status": media["status"],
                "media_validated": media["status"] in ("reused", "acquired"),
                "media_sha256": media["sha256"],
                "media_size_bytes": media["size_bytes"],
                "media_error": media["error"],
                "media_acquisition_events": media_events,
                "fully_usable": bool(
                    transcript["validated"] and media["status"] in ("reused", "acquired")
                ),
            }
        )
    by_id = {entry["video_id"]: entry for entry in entries}
    question_coverage = {}
    for split, split_rows in rows.items():
        all_ready = []
        target_ready = []
        blocked = []
        for row in split_rows:
            candidate_video_ids = [str(item["video_id"]) for item in row["retrieved"]]
            candidates_ready = all(
                by_id[video_id]["fully_usable"] for video_id in candidate_video_ids
            )
            target = by_id.get(str(row["expected_video_id"]))
            is_target_ready = bool(target and target["fully_usable"])
            if candidates_ready:
                all_ready.append(str(row["sample_id"]))
            if is_target_ready:
                target_ready.append(str(row["sample_id"]))
            if not candidates_ready or not is_target_ready:
                blocked.append(
                    {
                        "sample_id": str(row["sample_id"]),
                        "expected_video_id": str(row["expected_video_id"]),
                        "all_top5_resource_ready": candidates_ready,
                        "correct_target_resource_ready": is_target_ready,
                        "blocked_candidate_ids": [
                            video_id
                            for video_id in candidate_video_ids
                            if not by_id[video_id]["fully_usable"]
                        ],
                    }
                )
        question_coverage[split] = {
            "questions": len(split_rows),
            "all_top5_resource_ready": len(all_ready),
            "all_top5_resource_ready_sample_ids": all_ready,
            "correct_target_resource_ready": len(target_ready),
            "correct_target_resource_ready_sample_ids": target_ready,
            "resource_blocked_questions": blocked,
        }

    catalog_payload = json.loads(CATALOG.read_text())
    catalog_ids = {str(item["video_id"]) for item in catalog_payload["documents"]}
    missing_catalog = {}
    for split, path in SPLITS.items():
        split_rows = json.loads(path.read_text())
        affected = [row for row in split_rows if str(row["video_id"]) not in catalog_ids]
        missing_catalog[split] = {
            "question_count": len(affected),
            "target_video_ids": sorted({str(row["video_id"]) for row in affected}),
            "sample_ids": [str(row["sample_id"]) for row in affected],
        }
    manifest = {
        "created_at_utc": utc_now(),
        "retrieval_freeze_sha256": sha256(SNAPSHOT / "retrieval_freeze.json"),
        "catalog_sha256": sha256(CATALOG),
        "tool_versions": _tool_versions(),
        "candidate_count": len(entries),
        "transcript_coverage": sum(entry["transcript_validated"] for entry in entries),
        "media_coverage": sum(entry["media_validated"] for entry in entries),
        "fully_usable_coverage": sum(entry["fully_usable"] for entry in entries),
        "question_coverage": question_coverage,
        "unchanged_catalog_omissions": {
            "omitted_video_count": int(catalog_payload["unavailable_video_count"]),
            "omitted_video_ids": sorted(catalog_payload["unavailable_video_ids"]),
            "split_effect": missing_catalog,
        },
        "resources": entries,
    }
    write_new(SNAPSHOT / "candidate_resource_manifest.json", manifest)
    print(
        json.dumps(
            {
                key: manifest[key]
                for key in (
                    "candidate_count",
                    "transcript_coverage",
                    "media_coverage",
                    "fully_usable_coverage",
                )
            },
            indent=2,
        )
    )
    print(f"manifest_sha256={sha256(SNAPSHOT / 'candidate_resource_manifest.json')}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("freeze", "transcripts", "media", "finalize"))
    args = parser.parse_args()
    {
        "freeze": freeze,
        "transcripts": prepare_transcripts,
        "media": acquire_media,
        "finalize": finalize,
    }[args.phase]()


if __name__ == "__main__":
    main()
