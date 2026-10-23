#!/usr/bin/env python3
"""Copy verified Week 1 resources into a new, hash-frozen evaluation cache."""

from __future__ import annotations

import hashlib
import json
import platform
import shutil
import subprocess
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from development.scripts.recover_medvidqa_videos import ROOT

if TYPE_CHECKING:
    from pathlib import Path

WEEK1 = ROOT / "development/evaluation/results/week1"
PHASE1 = WEEK1 / "2026-09-24"
PHASE2 = WEEK1 / "2026-09-24-phase2"
DIAGNOSTIC = WEEK1 / "2026-09-24-downloader-diagnostic"
REMAINING = WEEK1 / "2026-09-24-remaining-media"
MERGED = WEEK1 / "2026-09-24-merged-cache-v2"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def version(command: list[str]) -> str:
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    return (
        (result.stdout or result.stderr).splitlines()[0]
        if result.returncode == 0
        else f"unavailable: {result.stderr.strip()}"
    )


def add_file(source: Path, destination: Path, source_group: str, manifest: list[dict]) -> None:
    assert source.is_file(), source
    assert not destination.exists(), f"Duplicate destination: {destination}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_hash = sha256(source)
    with source.open("rb") as incoming, destination.open("xb") as outgoing:
        shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
    copied_hash = sha256(destination)
    assert source_hash == copied_hash, destination
    manifest.append(
        {
            "video_id": source.stem,
            "resource": destination.parent.name,
            "source_group": source_group,
            "source_path": str(source.relative_to(ROOT)),
            "merged_path": str(destination.relative_to(ROOT)),
            "size_bytes": destination.stat().st_size,
            "sha256": copied_hash,
        }
    )


def main() -> None:
    if MERGED.exists():
        raise FileExistsError(f"Refusing to overwrite merged cache: {MERGED}")
    summary = json.loads((PHASE1 / "summary.json").read_text())
    target_ids = sorted(
        video_id
        for video_id, row in summary["transcript_retries"].items()
        if row["status"] == "recovered"
    )
    assert len(target_ids) == 26
    remaining_ids = sorted(
        set(target_ids)
        - {p.stem for p in (PHASE2 / "video_cache").glob("*.mp4")}
        - {p.stem for p in (DIAGNOSTIC / "videos").glob("*.mp4")}
    )
    assert len(remaining_ids) == 21
    remaining_records = {
        video_id: json.loads((REMAINING / "records" / f"{video_id}.json").read_text())
        for video_id in remaining_ids
    }
    retry_records = {
        path.stem: json.loads(path.read_text()) for path in (REMAINING / "retry").glob("*.json")
    }
    assert set(retry_records).issubset(remaining_ids)
    assert len(list((ROOT / "data/transcript_cache").glob("*.json"))) == 61
    assert len(list((ROOT / "data/video_cache").glob("*.mp4"))) == 51
    phase2_records = {
        video_id: json.loads((PHASE2 / "records" / f"{video_id}.json").read_text())
        for video_id in target_ids
        if (PHASE2 / "video_cache" / f"{video_id}.mp4").is_file()
    }
    diagnostic_records = {
        video_id: json.loads((DIAGNOSTIC / f"{video_id}.json").read_text())
        for video_id in target_ids
        if (DIAGNOSTIC / "videos" / f"{video_id}.mp4").is_file()
    }
    for row in list(phase2_records.values()) + list(diagnostic_records.values()):
        assert row["fully_usable"]
    merged_files: list[dict] = []
    for source in sorted((ROOT / "data/transcript_cache").glob("*.json")):
        add_file(source, MERGED / "transcript_cache" / source.name, "original", merged_files)
    for video_id in target_ids:
        source = PHASE1 / "recovered_transcripts" / f"{video_id}.json"
        add_file(
            source, MERGED / "transcript_cache" / source.name, "phase1_recovered", merged_files
        )
    for source in sorted((ROOT / "data/video_cache").glob("*")):
        if source.is_file() and source.suffix.lower() in (".mp4", ".webm", ".mkv", ".mov"):
            add_file(source, MERGED / "video_cache" / source.name, "original", merged_files)
    for video_id in target_ids:
        if video_id in phase2_records:
            source, group = PHASE2 / "video_cache" / f"{video_id}.mp4", "phase2_recovered"
        elif video_id in diagnostic_records:
            source, group = DIAGNOSTIC / "videos" / f"{video_id}.mp4", "diagnostic_recovered"
        elif video_id in retry_records and retry_records[video_id]["fully_usable"]:
            source = ROOT / retry_records[video_id]["video_path"]
            group = "remaining_retry_recovered"
        elif remaining_records[video_id]["fully_usable"]:
            source = ROOT / remaining_records[video_id]["video_path"]
            group = "remaining_recovered"
        else:
            continue
        add_file(source, MERGED / "video_cache" / source.name, group, merged_files)
    inventory = [
        json.loads(line) for line in (PHASE1 / "video_inventory.jsonl").read_text().splitlines()
    ]
    affected = {
        row["video_id"]: row["affected_test_question_ids"]
        for row in inventory
        if row["video_id"] in target_ids
    }
    assert sum(map(len, affected.values())) == 59
    videos = {item["video_id"] for item in merged_files if item["resource"] == "video_cache"}
    transcripts = {
        item["video_id"] for item in merged_files if item["resource"] == "transcript_cache"
    }
    target_coverage = []
    for video_id in target_ids:
        if video_id in phase2_records:
            record = phase2_records[video_id]
            validation = record["local_validation"]
            acquisition = record["acquisition"]
            selected_format = None
            error = acquisition["error"] or acquisition["stderr"]
            source_group = "phase2_recovered"
        elif video_id in diagnostic_records:
            record = diagnostic_records[video_id]
            validation = record["local_validation"]
            selected_format = None
            error = record["download_error"] or record["download_stderr"]
            source_group = "diagnostic_recovered"
        elif video_id in retry_records and retry_records[video_id]["fully_usable"]:
            record = retry_records[video_id]
            validation = record["local_validation"]
            selected_format = record["selected_format_id"]
            error = record["download_error"]
            source_group = "remaining_retry_recovered"
        else:
            record = remaining_records[video_id]
            validation = record["local_validation"]
            selected_format = record["selected_format_id"]
            error = record["download_error"]
            source_group = "remaining_recovered"
        target_coverage.append(
            {
                "video_id": video_id,
                "source_group": source_group,
                "transcript_available": video_id in transcripts,
                "video_available": video_id in videos,
                "fully_usable": bool(
                    record["fully_usable"] and video_id in videos and video_id in transcripts
                ),
                "selected_format_id": selected_format,
                "file_size_bytes": next(
                    (
                        x["size_bytes"]
                        for x in merged_files
                        if x["resource"] == "video_cache" and x["video_id"] == video_id
                    ),
                    None,
                ),
                "duration_seconds": validation["duration_seconds"] if validation else None,
                "latest_annotated_end_seconds": max(
                    float(x["answer_end_second"])
                    for x in json.loads((ROOT / "MedVidQA/test.json").read_text())
                    if x["video_id"] == video_id
                ),
                "frame_decode_success": validation["all_frames_decoded"] if validation else False,
                "clip_extraction_success": validation["test_clip_success"] if validation else False,
                "failure_reason": None if record["fully_usable"] else error,
                "affected_test_question_ids": affected[video_id],
            }
        )
    inputs = [ROOT / "MedVidQA" / f"{split}.json" for split in ("train", "val", "test")]
    inputs += [
        ROOT / "data/medvidqa_video_catalog.json",
        PHASE1 / "summary.json",
        PHASE1 / "video_inventory.jsonl",
        ROOT / "development/scripts/recover_remaining_medvidqa_media.py",
        ROOT / "development/scripts/freeze_medvidqa_staging_cache.py",
    ]
    inputs += sorted((REMAINING / "records").glob("*.json"))
    inputs += sorted((REMAINING / "retry").glob("*.json"))
    inputs += [PHASE2 / "records" / f"{video_id}.json" for video_id in sorted(phase2_records)]
    inputs += [DIAGNOSTIC / f"{video_id}.json" for video_id in sorted(diagnostic_records)]
    manifest = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "policy": "Frozen copy of original valid resources plus verified staged recoveries; no original cache altered",
        "acquisition_command": "python3 -m development.scripts.recover_remaining_medvidqa_media",
        "freeze_command": "python3 -m development.scripts.freeze_medvidqa_staging_cache",
        "versions": {
            "python": platform.python_version(),
            "yt_dlp": "2026.08.19",
            "yt_dlp_ejs": "0.8.0",
            "deno": version(["deno", "--version"]),
            "ffmpeg": version(["ffmpeg", "-version"]),
            "ffprobe": version(["ffprobe", "-version"]),
        },
        "inputs": [
            {"path": str(path.relative_to(ROOT)), "sha256": sha256(path)} for path in inputs
        ],
        "source_ids": target_ids,
        "files": merged_files,
        "target_coverage": target_coverage,
        "summary": {
            "transcript_files": sum(
                item["resource"] == "transcript_cache" for item in merged_files
            ),
            "video_files": sum(item["resource"] == "video_cache" for item in merged_files),
            "target_transcripts_available": sum(
                item["transcript_available"] for item in target_coverage
            ),
            "target_videos_available": sum(item["video_available"] for item in target_coverage),
            "target_fully_usable": sum(item["fully_usable"] for item in target_coverage),
            "affected_test_questions": 59,
            "affected_questions_resource_ready": sum(
                len(item["affected_test_question_ids"])
                for item in target_coverage
                if item["fully_usable"]
            ),
        },
    }
    manifest_path = MERGED / "manifest.json"
    with manifest_path.open("x") as stream:
        json.dump(manifest, stream, indent=2)
        stream.write("\n")
    print(json.dumps(manifest["summary"], indent=2))
    print(f"manifest: {manifest_path} sha256={sha256(manifest_path)}")


if __name__ == "__main__":
    main()
