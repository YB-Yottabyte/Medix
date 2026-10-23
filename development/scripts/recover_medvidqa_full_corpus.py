#!/usr/bin/env python3
"""Resumable, public-only Week 1 resource acquisition for all MedVidQA IDs.

Run phases in order: init, transcripts, media, finalize. A completed per-ID
record is immutable and reruns skip it. No production cache or benchmark file is
written. Network work uses two workers and a shared start-rate gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from development.scripts.recover_medvidqa_videos import probe_local_video

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "development/evaluation/results/week1/2026-09-24-merged-cache-v2"
STAGE = ROOT / "development/evaluation/results/week1/2026-09-24-full-corpus-v1"
SPLITS = ("train", "val", "test")
FORMAT = "bestvideo[height<=360]+bestaudio/best[height<=360]/worst"
UVX = ["uvx", "--from", "yt-dlp[default]==2026.08.19", "yt-dlp"]
ENV = dict(os.environ)
ENV.setdefault("UV_CACHE_DIR", str(ROOT / ".cache" / "uv"))
VIDEO_EXTS = (".mp4", ".webm", ".mkv", ".mov")
GATE = threading.Lock()
NEXT_REQUEST = [0.0]


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_new(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rate_gate(seconds: float) -> None:
    with GATE:
        now = time.monotonic()
        delay = max(0.0, NEXT_REQUEST[0] - now)
        NEXT_REQUEST[0] = max(now, NEXT_REQUEST[0]) + seconds
    if delay:
        time.sleep(delay)


def run(command: list[str], timeout: int, *, gate: float = 0.0) -> dict[str, Any]:
    if gate:
        rate_gate(gate)
    started = time.monotonic()
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, env=ENV, check=False
        )
        return {
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "error": None,
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }
    except (OSError, subprocess.SubprocessError) as exc:
        return {
            "returncode": None,
            "stdout": "",
            "stderr": "",
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }


def original_index() -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for split in SPLITS:
        rows = json.loads((ROOT / "MedVidQA" / f"{split}.json").read_text())
        for row in rows:
            video_id = str(row["video_id"])
            item = by_id.setdefault(
                video_id,
                {
                    "video_id": video_id,
                    "splits": set(),
                    "source_urls": set(),
                    "sample_ids": [],
                    "annotated_intervals": [],
                },
            )
            item["splits"].add(split)
            item["source_urls"].add(str(row["video_url"]))
            item["sample_ids"].append(str(row["sample_id"]))
            item["annotated_intervals"].append(
                {
                    "sample_id": str(row["sample_id"]),
                    "start_seconds": float(row["answer_start_second"]),
                    "end_seconds": float(row["answer_end_second"]),
                }
            )
    assert len(by_id) == 899
    catalog = json.loads((ROOT / "data/medvidqa_video_catalog.json").read_text())
    docs = {str(x["video_id"]): x for x in catalog["documents"]}
    assert len(docs) == 852
    for video_id, item in by_id.items():
        assert len(item["source_urls"]) == 1, video_id
        item["source_url"] = next(iter(item.pop("source_urls")))
        item["splits"] = sorted(item["splits"])
        item["latest_annotated_answer_end_seconds"] = max(
            x["end_seconds"] for x in item["annotated_intervals"]
        )
        doc = docs.get(video_id)
        item["catalog_metadata_status"] = "present" if doc else "missing"
        item["catalog_title"] = doc.get("title") if doc else None
        item["catalog_author"] = doc.get("author") if doc else None
    return dict(sorted(by_id.items()))


def init() -> None:
    if STAGE.exists():
        raise FileExistsError(f"Refusing to recreate existing stage: {STAGE}")
    index = original_index()
    STAGE.mkdir(parents=True)
    write_new(STAGE / "source_index.json", index)
    for kind in ("transcript_cache", "video_cache"):
        dest = STAGE / kind
        dest.mkdir()
        for source in sorted((SOURCE / kind).iterdir()):
            if not source.is_file():
                continue
            target = dest / source.name
            with source.open("rb") as incoming, target.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            assert sha256(source) == sha256(target)
    write_new(
        STAGE / "initial_resource_manifest.json",
        {
            "created_at_utc": utc(),
            "source_manifest_path": str((SOURCE / "manifest.json").relative_to(ROOT)),
            "source_manifest_sha256": sha256(SOURCE / "manifest.json"),
            "reused_transcripts": len(list((STAGE / "transcript_cache").glob("*.json"))),
            "reused_videos": len(
                [p for p in (STAGE / "video_cache").iterdir() if p.suffix in VIDEO_EXTS]
            ),
        },
    )
    print(f"Initialized {STAGE}: {len(index)} IDs, 87 transcripts, 77 videos", flush=True)


def validate_cues(cues: list[dict[str, Any]]) -> tuple[bool, str | None]:
    if not cues:
        return False, "empty transcript"
    for cue in cues:
        if not str(cue.get("text", "")).strip():
            return False, "blank transcript cue"
        try:
            start, duration = float(cue["start"]), float(cue["duration"])
        except (KeyError, TypeError, ValueError):
            return False, "invalid cue timestamp"
        if start < 0 or duration < 0:
            return False, "negative cue timestamp"
    return True, None


def transcript_one(video_id: str) -> tuple[str, dict[str, Any]]:
    from youtube_transcript_api import NoTranscriptFound, YouTubeTranscriptApi

    start = time.monotonic()
    attempts = []
    selected = None
    for attempt_number in (1, 2):
        rate_gate(1.5)
        try:
            fetched = YouTubeTranscriptApi().fetch(video_id)
            selected = fetched
            attempts.append({"attempt": attempt_number, "status": "success", "error": None})
            break
        except NoTranscriptFound as exc:
            attempts.append(
                {
                    "attempt": attempt_number,
                    "status": "english_unavailable",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
            rate_gate(1.5)
            try:
                options = list(YouTubeTranscriptApi().list(video_id))
                options.sort(
                    key=lambda x: (not x.is_generated, x.language_code.startswith("en")),
                    reverse=True,
                )
                if options:
                    selected = options[0].fetch()
                    attempts.append(
                        {
                            "attempt": attempt_number,
                            "status": "native_language_success",
                            "language_code": selected.language_code,
                            "error": None,
                        }
                    )
                else:
                    attempts.append(
                        {
                            "attempt": attempt_number,
                            "status": "native_language_failed",
                            "error": "no source-language transcripts advertised",
                        }
                    )
            except Exception as alt_exc:
                attempts.append(
                    {
                        "attempt": attempt_number,
                        "status": "native_language_failed",
                        "error": f"{type(alt_exc).__name__}: {alt_exc}",
                    }
                )
            break
        except Exception as exc:  # Upstream exceptions vary by response type.
            error = f"{type(exc).__name__}: {exc}"
            attempts.append({"attempt": attempt_number, "status": "failed", "error": error})
            # No retry for durable source states; retry only transport/server errors.
            if type(exc).__name__ not in ("RequestBlocked", "IpBlocked", "YouTubeRequestFailed"):
                break
            time.sleep(4.0 * attempt_number)
    cues = []
    language = getattr(selected, "language_code", None) if selected else None
    if selected:
        cues = [
            {"start": cue.start, "duration": cue.duration, "text": cue.text}
            for cue in selected.snippets
        ]
    valid, validation_error = validate_cues(cues)
    if valid:
        write_new(STAGE / "transcript_cache" / f"{video_id}.json", cues)
    result = {
        "video_id": video_id,
        "started_at_utc": utc(),
        "tool": "youtube-transcript-api 1.2.4",
        "language_code": language,
        "attempts": attempts,
        "retry_count": max(0, len(attempts) - 1),
        "cue_count": len(cues),
        "validated": valid,
        "status": "recovered" if valid else "failed",
        "final_error": None if valid else validation_error or attempts[-1]["error"],
        "elapsed_seconds": round(time.monotonic() - start, 3),
    }
    return video_id, result


def transcript_phase() -> None:
    index = json.loads((STAGE / "source_index.json").read_text())
    missing = [
        video_id
        for video_id in index
        if not (STAGE / "transcript_cache" / f"{video_id}.json").is_file()
    ]
    pending = [
        video_id
        for video_id in missing
        if not (STAGE / "transcript_records" / f"{video_id}.json").is_file()
    ]
    print(f"Transcript phase: {len(missing)} initially missing, {len(pending)} pending", flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {pool.submit(transcript_one, video_id): video_id for video_id in pending}
        for index_number, future in enumerate(as_completed(futures), 1):
            video_id = futures[future]
            try:
                _, record = future.result()
            except Exception as exc:
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
            write_new(STAGE / "transcript_records" / f"{video_id}.json", record)
            if index_number % 25 == 0 or index_number == len(pending):
                print(
                    f"Transcript {index_number}/{len(pending)}: {video_id} {record['status']}",
                    flush=True,
                )


def selected_format(stdout: str) -> dict[str, Any] | None:
    for line in stdout.splitlines():
        if line.startswith("medix|"):
            pieces = line.split("|", 4)
            if len(pieces) == 5:
                return {
                    "video_id": pieces[1],
                    "availability": pieces[2],
                    "source_duration": pieces[3],
                    "format_id": pieces[4],
                }
    return None


def download_command(video_id: str, output_dir: Path, selector: str) -> list[str]:
    return [
        *UVX,
        "--ignore-config",
        "--no-cache-dir",
        "--no-playlist",
        "--socket-timeout",
        "15",
        "--retries",
        "1",
        "--fragment-retries",
        "1",
        "--no-progress",
        "--no-overwrites",
        "--no-continue",
        "--no-part",
        "--format",
        selector,
        "--merge-output-format",
        "mp4",
        "--print",
        "before_dl:medix|%(id)s|%(availability)s|%(duration)s|%(format_id)s",
        "--output",
        str(output_dir / "%(id)s.%(ext)s"),
        f"https://www.youtube.com/watch?v={video_id}",
    ]


def find_video(output_dir: Path, video_id: str) -> Path | None:
    files = [p for ext in VIDEO_EXTS if (p := output_dir / f"{video_id}{ext}").is_file()]
    return files[0] if len(files) == 1 else None


def advertised_alternative(
    video_id: str, primary_format: str | None
) -> tuple[str | None, dict[str, Any]]:
    command = [
        *UVX,
        "--ignore-config",
        "--no-cache-dir",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        "--no-warnings",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    probe = run(command, 120, gate=2.0)
    formats = []
    if probe["returncode"] == 0:
        try:
            raw = json.loads(probe["stdout"])
            formats = [
                {
                    key: item.get(key)
                    for key in (
                        "format_id",
                        "ext",
                        "height",
                        "vcodec",
                        "acodec",
                        "language",
                        "protocol",
                    )
                }
                for item in raw.get("formats", [])
            ]
        except (TypeError, ValueError):
            pass
    public = [x for x in formats if "http" in str(x["protocol"])]
    videos = [
        x
        for x in public
        if x["ext"] == "mp4"
        and x["height"]
        and x["height"] <= 360
        and x["vcodec"] not in (None, "none")
        and x["acodec"] == "none"
    ]
    audios = [
        x
        for x in public
        if x["ext"] == "m4a" and x["vcodec"] == "none" and x["acodec"] not in (None, "none")
    ]
    videos.sort(key=lambda x: (x["height"], str(x["format_id"]) == "134"), reverse=True)
    audios.sort(
        key=lambda x: (str(x["language"]).startswith("en"), str(x["format_id"]).startswith("140")),
        reverse=True,
    )
    alternative = next(
        (
            f"{v['format_id']}+{a['format_id']}"
            for v in videos
            for a in audios
            if f"{v['format_id']}+{a['format_id']}" != primary_format
        ),
        None,
    )
    return alternative, {
        "returncode": probe["returncode"],
        "error": probe["error"] or (probe["stderr"].strip() if probe["returncode"] != 0 else None),
        "advertised_format_ids": [x["format_id"] for x in formats],
        "selected_alternative": alternative,
        "elapsed_seconds": probe["elapsed_seconds"],
    }


def media_one(video_id: str, item: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    started = time.monotonic()
    attempts = []
    source_probe = None
    alternative_probe = None
    selected = None
    video = None
    if shutil.disk_usage(STAGE).free < 5 * 1024**3:
        return video_id, {
            "video_id": video_id,
            "source_url": item["source_url"],
            "acquired_at_utc": utc(),
            "source_probe": None,
            "alternative_format_probe": None,
            "attempts": [],
            "retry_count": 0,
            "selected_format_id": None,
            "file_size_bytes": None,
            "duration_seconds": None,
            "latest_annotated_answer_end_seconds": item["latest_annotated_answer_end_seconds"],
            "video_validation": None,
            "local_media_status": "failed",
            "final_error": "local storage reserve below 5 GiB; acquisition not attempted",
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }
    for attempt_number, selector in enumerate((FORMAT, "ALTERNATIVE"), 1):
        if attempt_number == 2:
            first = attempts[0]
            if "HTTP Error 403" not in first["error"]:
                break
            selector, alternative_probe = advertised_alternative(
                video_id, first["selected_format_id"]
            )
            source_probe = source_probe or alternative_probe
            if not selector:
                break
        # Leave failed attempts isolated; publish only a validated file to cache.
        output_dir = STAGE / "download_attempts" / video_id / f"attempt-{attempt_number}"
        output_dir.mkdir(parents=True, exist_ok=True)
        result = run(download_command(video_id, output_dir, selector), 900, gate=2.0)
        details = selected_format(result["stdout"])
        if details:
            source_probe = source_probe or {"success": True, **details}
        selected = details["format_id"] if details else None
        video = find_video(output_dir, video_id)
        error = result["error"] or (result["stderr"].strip() if result["returncode"] != 0 else None)
        attempts.append(
            {
                "attempt": attempt_number,
                "format_selector": selector,
                "selected_format_id": selected,
                "returncode": result["returncode"],
                "error": error,
                "elapsed_seconds": result["elapsed_seconds"],
                "downloaded_file": str(video.relative_to(ROOT)) if video else None,
                "downloaded_bytes": video.stat().st_size if video else None,
            }
        )
        if result["returncode"] == 0 and video and video.stat().st_size > 0:
            break
        video = None
    validation = None
    usable = False
    final_path = None
    if video:
        validation = probe_local_video(video, item["annotated_intervals"], STAGE / "test_clips")
        usable = bool(
            validation["duration_seconds"]
            and validation["duration_seconds"] > 0
            and validation["video_stream_present"]
            and validation["duration_reaches_all_annotated_intervals"]
            and validation["all_frames_decoded"]
            and validation["test_clip_success"]
        )
        if usable:
            final_path = STAGE / "video_cache" / video.name
            with video.open("rb") as incoming, final_path.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            assert sha256(video) == sha256(final_path)
            video.unlink()  # Retain the immutable record; drop only this duplicate staged file.
    if source_probe is None:
        source_probe = {
            "success": False,
            "error": attempts[-1]["error"] if attempts else "no attempt",
        }
    elif "success" not in source_probe:
        source_probe["success"] = source_probe.get("returncode") == 0
    final_error = (
        None
        if usable
        else (
            "media validation failed: " + json.dumps(validation, ensure_ascii=False)
            if validation
            else (attempts[-1]["error"] if attempts else "no advertised alternative")
        )
    )
    record = {
        "video_id": video_id,
        "source_url": item["source_url"],
        "acquired_at_utc": utc(),
        "tool": "yt-dlp 2026.08.19 / yt-dlp-ejs 0.8.0 / Deno 2.7.5",
        "source_probe": source_probe,
        "alternative_format_probe": alternative_probe,
        "attempts": attempts,
        "retry_count": max(0, len(attempts) - 1),
        "selected_format_id": attempts[-1]["selected_format_id"] if attempts else None,
        "file_size_bytes": final_path.stat().st_size if final_path else None,
        "duration_seconds": validation["duration_seconds"] if validation else None,
        "latest_annotated_answer_end_seconds": item["latest_annotated_answer_end_seconds"],
        "video_validation": validation,
        "local_media_status": "usable" if usable else "failed",
        "final_error": final_error,
        "elapsed_seconds": round(time.monotonic() - started, 3),
    }
    return video_id, record


def media_phase() -> None:
    raise RuntimeError(
        "Full-corpus bulk media acquisition is disabled. Use the storage-bounded "
        "on-demand cache in development.evaluation.run_end_to_end_pipeline."
    )
    index = json.loads((STAGE / "source_index.json").read_text())
    missing = [
        video_id
        for video_id in index
        if not any((STAGE / "video_cache" / f"{video_id}{ext}").is_file() for ext in VIDEO_EXTS)
    ]
    pending = [
        video_id
        for video_id in missing
        if not (STAGE / "media_records" / f"{video_id}.json").is_file()
    ]
    print(f"Media phase: {len(missing)} missing, {len(pending)} pending", flush=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(media_one, video_id, index[video_id]): video_id for video_id in pending
        }
        for index_number, future in enumerate(as_completed(futures), 1):
            video_id = futures[future]
            try:
                _, record = future.result()
            except Exception as exc:
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
            write_new(STAGE / "media_records" / f"{video_id}.json", record)
            if index_number % 25 == 0 or index_number == len(pending):
                successes = sum(
                    1
                    for p in (STAGE / "media_records").glob("*.json")
                    if json.loads(p.read_text()).get("local_media_status") == "usable"
                )
                print(
                    f"Media {index_number}/{len(pending)}: successes={successes} last={video_id} {record['local_media_status']}",
                    flush=True,
                )


def finalize() -> None:
    index = json.loads((STAGE / "source_index.json").read_text())
    old = json.loads((SOURCE / "manifest.json").read_text())
    old_transcript_ids = {
        x["video_id"] for x in old["files"] if x["resource"] == "transcript_cache"
    }
    old_video_ids = {x["video_id"] for x in old["files"] if x["resource"] == "video_cache"}
    prior_inventory = {
        x["video_id"]: x
        for x in (
            json.loads(line)
            for line in (
                ROOT / "development/evaluation/results/week1/2026-09-24/video_inventory.jsonl"
            )
            .read_text()
            .splitlines()
        )
    }

    def original_duration(path: Path) -> float | None:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        try:
            return float(result.stdout.strip()) if result.returncode == 0 else None
        except ValueError:
            return None

    rows = []
    for video_id, item in index.items():
        transcript_path = STAGE / "transcript_cache" / f"{video_id}.json"
        transcript_record_path = STAGE / "transcript_records" / f"{video_id}.json"
        media_record_path = STAGE / "media_records" / f"{video_id}.json"
        if video_id not in old_transcript_ids and not transcript_record_path.is_file():
            raise RuntimeError(f"Transcript attempt missing for {video_id}")
        if video_id not in old_video_ids and not media_record_path.is_file():
            raise RuntimeError(f"Media attempt missing for {video_id}")
        transcript_record = (
            json.loads(transcript_record_path.read_text())
            if transcript_record_path.is_file()
            else None
        )
        media_record = (
            json.loads(media_record_path.read_text()) if media_record_path.is_file() else None
        )
        transcript_valid = False
        transcript_error = None
        cue_count = 0
        if transcript_path.is_file():
            try:
                cues = json.loads(transcript_path.read_text())
                transcript_valid, transcript_error = validate_cues(cues)
                cue_count = len(cues)
            except (OSError, ValueError, TypeError) as exc:
                transcript_error = f"{type(exc).__name__}: {exc}"
        video = next(
            (
                p
                for ext in VIDEO_EXTS
                if (p := STAGE / "video_cache" / f"{video_id}{ext}").is_file()
            ),
            None,
        )
        media_valid = bool(
            video
            and (
                video_id in old_video_ids
                or (media_record and media_record["local_media_status"] == "usable")
            )
        )
        prior_validation = next(
            (x for x in old["target_coverage"] if x["video_id"] == video_id), None
        )
        if video_id in old_video_ids and not prior_validation:
            prior_validation = {
                "duration_seconds": original_duration(video),
                "latest_annotated_end_seconds": item["latest_annotated_answer_end_seconds"],
                "frame_decode_success": prior_inventory[video_id]["frame_decode_success"],
                "duration_reaches_all_annotated_intervals": prior_inventory[video_id][
                    "clip_source_plausible"
                ],
                "validation_source": "original Week 1 inventory",
            }
        if transcript_valid and media_valid:
            status = "fully_usable"
        elif transcript_valid:
            status = "transcript_only"
        elif media_valid:
            status = "media_only"
        elif item["catalog_metadata_status"] == "present":
            status = "metadata_only"
        else:
            status = "unavailable_or_unresolved"
        row = {
            "splits": item["splits"],
            "video_id": video_id,
            "source_url": item["source_url"],
            "catalog_metadata_status": item["catalog_metadata_status"],
            "catalog_title": item["catalog_title"],
            "catalog_author": item["catalog_author"],
            "transcript_status": "available" if transcript_valid else "failed",
            "transcript_validation": {
                "valid": transcript_valid,
                "cue_count": cue_count,
                "error": transcript_error,
            },
            "transcript_language": transcript_record.get("language_code")
            if transcript_record
            else None,
            "local_media_status": "available" if media_valid else "failed",
            "video_validation": media_record.get("video_validation")
            if media_record
            else prior_validation,
            "selected_format_id": media_record.get("selected_format_id") if media_record else None,
            "file_size_bytes": video.stat().st_size
            if video
            else (
                media_record["attempts"][-1].get("downloaded_bytes")
                if media_record and media_record.get("attempts")
                else None
            ),
            "duration_seconds": media_record.get("duration_seconds")
            if media_record
            else (prior_validation.get("duration_seconds") if prior_validation else None),
            "latest_annotated_answer_end_seconds": item["latest_annotated_answer_end_seconds"],
            "source_probe_result": media_record.get("source_probe")
            if media_record
            else "previously_validated_local_resource",
            "download_attempts": media_record.get("attempts") if media_record else [],
            "transcript_attempts": transcript_record.get("attempts") if transcript_record else [],
            "transcript_retry_count": transcript_record.get("retry_count", 0)
            if transcript_record
            else 0,
            "media_retry_count": media_record.get("retry_count", 0) if media_record else 0,
            "transcript_acquisition_seconds": transcript_record.get("elapsed_seconds")
            if transcript_record
            else 0,
            "media_acquisition_seconds": media_record.get("elapsed_seconds") if media_record else 0,
            "exact_final_error": {
                "transcript": None
                if transcript_valid
                else (
                    transcript_record["attempts"][-1]["error"]
                    if transcript_record
                    and transcript_record.get("attempts")
                    and transcript_record["attempts"][-1].get("error")
                    else (
                        transcript_record.get("final_error")
                        if transcript_record
                        else transcript_error
                    )
                ),
                "media": None
                if media_valid
                else (media_record.get("final_error") if media_record else "no media"),
            },
            "final_status": status,
        }
        rows.append(row)
    assert len(rows) == 899
    inventory = STAGE / "inventory.jsonl"
    with inventory.open("x", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    files = []
    for kind in ("transcript_cache", "video_cache"):
        for path in sorted((STAGE / kind).iterdir()):
            if path.is_file():
                files.append(
                    {
                        "video_id": path.stem,
                        "resource": kind,
                        "path": str(path.relative_to(ROOT)),
                        "size_bytes": path.stat().st_size,
                        "sha256": sha256(path),
                        "provenance": "reused_merged_v2"
                        if path.stem
                        in (old_transcript_ids if kind == "transcript_cache" else old_video_ids)
                        else "recovered_full_corpus",
                    }
                )
    input_files = [ROOT / "MedVidQA" / f"{split}.json" for split in SPLITS]
    input_files += [
        ROOT / "data/medvidqa_video_catalog.json",
        SOURCE / "manifest.json",
        ROOT / "development/scripts/recover_medvidqa_full_corpus.py",
        STAGE / "source_index.json",
        STAGE / "initial_resource_manifest.json",
        inventory,
    ]
    input_files += sorted((STAGE / "transcript_records").glob("*.json"))
    input_files += sorted((STAGE / "media_records").glob("*.json"))

    def ver(command: list[str]) -> str:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        return (result.stdout or result.stderr).splitlines()[0]

    summary = {"overall": {}, "by_split": {}}

    def count(group: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "total_videos": len(group),
            "catalog_metadata": sum(x["catalog_metadata_status"] == "present" for x in group),
            "transcripts": sum(x["transcript_status"] == "available" for x in group),
            "local_media": sum(x["local_media_status"] == "available" for x in group),
            "fully_usable": sum(x["final_status"] == "fully_usable" for x in group),
        }

    summary["overall"] = count(rows)
    summary["by_split"] = {
        split: count([x for x in rows if split in x["splits"]]) for split in SPLITS
    }
    summary["new_transcripts"] = sum(
        x["resource"] == "transcript_cache" and x["provenance"] == "recovered_full_corpus"
        for x in files
    )
    summary["new_videos"] = sum(
        x["resource"] == "video_cache" and x["provenance"] == "recovered_full_corpus" for x in files
    )
    summary["status_counts"] = dict(Counter(x["final_status"] for x in rows))

    def reason_group(error: str) -> str:
        if "HTTP Error 429" in error:
            return "HTTP Error 429: Too Many Requests"
        if "HTTP Error 403" in error:
            return "HTTP Error 403: Forbidden"
        if ":" in error:
            return error.split(":", 1)[0]
        return error.splitlines()[0][:160]

    summary["failure_reasons"] = {
        kind: dict(
            Counter(
                reason_group(x["exact_final_error"][kind])
                for x in rows
                if x["exact_final_error"][kind]
            )
        )
        for kind in ("transcript", "media")
    }
    summary["cache_storage_bytes"] = sum(x["size_bytes"] for x in files)
    summary["transcript_retry_count"] = sum(x["transcript_retry_count"] for x in rows)
    summary["media_retry_count"] = sum(x["media_retry_count"] for x in rows)
    summary["total_recorded_acquisition_seconds"] = round(
        sum(
            (x["transcript_acquisition_seconds"] or 0) + (x["media_acquisition_seconds"] or 0)
            for x in rows
        ),
        3,
    )
    manifest = {
        "created_at_utc": utc(),
        "source_ids": list(index),
        "method": "public-only, 2 transcript workers / 4 media workers, 1.5 s transcript and 2 s media request start gate; no cookies, credentials, proxies or impersonation",
        "tool_versions": {
            "python": platform.python_version(),
            "youtube_transcript_api": "1.2.4",
            "yt_dlp": "2026.08.19",
            "yt_dlp_ejs": "0.8.0",
            "deno": ver(["deno", "--version"]),
            "ffmpeg": ver(["ffmpeg", "-version"]),
            "ffprobe": ver(["ffprobe", "-version"]),
        },
        "input_hashes": [
            {"path": str(p.relative_to(ROOT)), "sha256": sha256(p)} for p in input_files
        ],
        "files": files,
        "summary": summary,
    }
    write_new(STAGE / "manifest.json", manifest)
    print(json.dumps(summary, indent=2), flush=True)
    print(f"Manifest SHA256 {sha256(STAGE / 'manifest.json')}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("init", "transcripts", "media", "finalize"))
    args = parser.parse_args()
    {"init": init, "transcripts": transcript_phase, "media": media_phase, "finalize": finalize}[
        args.phase
    ]()


if __name__ == "__main__":
    main()
