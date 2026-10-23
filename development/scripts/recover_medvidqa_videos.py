#!/usr/bin/env python3
"""Acquire and validate only the 26 Week 1 transcript-recovered test videos.

All output is staged under a new directory. Existing video caches, annotations,
catalogs, and evaluation results are never read-modified or overwritten.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov")


def write_json_new(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def run_text(command: list[str], timeout: int) -> dict[str, Any]:
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, check=False
        )
        return {
            "returncode": result.returncode,
            "stderr": result.stderr,
            "stdout": result.stdout,
            "error_type": None,
            "error": None,
        }
    except (OSError, subprocess.SubprocessError) as exc:
        return {
            "returncode": None,
            "stderr": None,
            "stdout": None,
            "error_type": type(exc).__name__,
            "error": str(exc),
        }


def probe_source(video_id: str) -> dict[str, Any]:
    command = [
        "yt-dlp",
        "--skip-download",
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout",
        "15",
        "--retries",
        "1",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    result = run_text(command, timeout=90)
    payload = None
    if result["returncode"] == 0:
        try:
            payload = json.loads(result["stdout"])
        except (TypeError, ValueError) as exc:
            result["error_type"] = type(exc).__name__
            result["error"] = str(exc)
    return {
        "success": payload is not None,
        "returncode": result["returncode"],
        "stderr": result["stderr"],
        "error_type": result["error_type"],
        "error": result["error"],
        "source_id": payload.get("id") if payload else None,
        "source_title": payload.get("title") if payload else None,
        "source_duration_seconds": payload.get("duration") if payload else None,
        "source_availability": payload.get("availability") if payload else None,
    }


def acquire_video(video_id: str, video_dir: Path) -> dict[str, Any]:
    video_dir.mkdir(parents=True, exist_ok=True)
    command = [
        "yt-dlp",
        "--no-playlist",
        "--no-progress",
        "--no-warnings",
        "--no-overwrites",
        "--no-continue",
        "--no-part",
        "--socket-timeout",
        "15",
        "--retries",
        "2",
        "--fragment-retries",
        "2",
        "--format",
        "bestvideo[height<=360]+bestaudio/best[height<=360]/worst",
        "--merge-output-format",
        "mp4",
        "--output",
        str(video_dir / "%(id)s.%(ext)s"),
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    result = run_text(command, timeout=600)
    files = [video_dir / f"{video_id}{extension}" for extension in VIDEO_EXTENSIONS]
    video = next((path for path in files if path.is_file()), None)
    return {
        "success": result["returncode"] == 0 and video is not None,
        "returncode": result["returncode"],
        "stderr": result["stderr"],
        "error_type": result["error_type"],
        "error": result["error"],
        "video_path": str(video.relative_to(ROOT)) if video else None,
        "file_size_bytes": video.stat().st_size if video else None,
    }


def probe_local_video(
    video_path: Path, intervals: list[dict[str, Any]], clip_dir: Path
) -> dict[str, Any]:
    probe = run_text(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "json",
            str(video_path),
        ],
        timeout=30,
    )
    duration = None
    video_stream = False
    if probe["returncode"] == 0:
        try:
            payload = json.loads(probe["stdout"])
            duration = float(payload["format"]["duration"])
            video_stream = any(
                stream.get("codec_type") == "video" for stream in payload.get("streams", [])
            )
        except (TypeError, ValueError, KeyError) as exc:
            probe["error_type"] = type(exc).__name__
            probe["error"] = str(exc)
    latest_interval = max(intervals, key=lambda item: item["end_seconds"])
    latest_end = latest_interval["end_seconds"]
    reaches_all = duration is not None and duration + 0.1 >= latest_end

    checks = []
    first_interval = intervals[0]
    timestamps = (
        1.0,
        (first_interval["start_seconds"] + first_interval["end_seconds"]) / 2,
        max(0.0, latest_end - 1.0),
    )
    for timestamp in timestamps:
        try:
            result = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-ss",
                    f"{timestamp:.3f}",
                    "-i",
                    str(video_path),
                    "-frames:v",
                    "1",
                    "-f",
                    "image2pipe",
                    "-vcodec",
                    "mjpeg",
                    "pipe:1",
                ],
                capture_output=True,
                timeout=45,
                check=False,
            )
            checks.append(
                {
                    "timestamp_seconds": timestamp,
                    "success": result.returncode == 0 and bool(result.stdout),
                    "returncode": result.returncode,
                    "stderr": result.stderr.decode("utf-8", errors="replace"),
                    "jpeg_bytes": len(result.stdout),
                    "error_type": None,
                    "error": None,
                }
            )
        except (OSError, subprocess.SubprocessError) as exc:
            checks.append(
                {
                    "timestamp_seconds": timestamp,
                    "success": False,
                    "returncode": None,
                    "stderr": None,
                    "jpeg_bytes": 0,
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                }
            )

    clip_dir.mkdir(parents=True, exist_ok=True)
    clip_start = max(latest_interval["start_seconds"], latest_end - 3.0)
    clip_path = clip_dir / f"{video_path.stem}.mp4"
    clip = run_text(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            "-i",
            str(video_path),
            "-ss",
            f"{clip_start:.3f}",
            "-t",
            f"{latest_end - clip_start:.3f}",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "25",
            "-c:a",
            "aac",
            str(clip_path),
        ],
        timeout=180,
    )
    clip_size = clip_path.stat().st_size if clip_path.is_file() else 0
    return {
        "duration_seconds": duration,
        "video_stream_present": video_stream,
        "ffprobe_returncode": probe["returncode"],
        "ffprobe_stderr": probe["stderr"],
        "ffprobe_error_type": probe["error_type"],
        "ffprobe_error": probe["error"],
        "latest_annotated_end_seconds": latest_end,
        "duration_reaches_all_annotated_intervals": reaches_all,
        "frame_checks": checks,
        "all_frames_decoded": all(item["success"] for item in checks),
        "test_clip_start_seconds": clip_start,
        "test_clip_end_seconds": latest_end,
        "test_clip_success": clip["returncode"] == 0 and clip_size > 0,
        "test_clip_size_bytes": clip_size,
        "test_clip_returncode": clip["returncode"],
        "test_clip_stderr": clip["stderr"],
        "test_clip_error_type": clip["error_type"],
        "test_clip_error": clip["error"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase1-summary", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.phase1_summary = args.phase1_summary.resolve()
    args.output_dir = args.output_dir.resolve()
    if args.output_dir.resolve() == (ROOT / "data" / "video_cache").resolve():
        raise ValueError("Output must not be the existing production video cache")
    summary = json.loads(args.phase1_summary.read_text(encoding="utf-8"))
    ids = sorted(
        video_id
        for video_id, result in summary["transcript_retries"].items()
        if result["status"] == "recovered"
    )
    if len(ids) != 26:
        raise ValueError(f"Expected 26 staged transcript IDs, got {len(ids)}")
    annotations = json.loads((ROOT / "MedVidQA" / "test.json").read_text(encoding="utf-8"))
    intervals: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in annotations:
        if item["video_id"] in ids:
            intervals[item["video_id"]].append(
                {
                    "sample_id": str(item["sample_id"]),
                    "start_seconds": float(item["answer_start_second"]),
                    "end_seconds": float(item["answer_end_second"]),
                }
            )
    records_dir = args.output_dir / "records"
    records_dir.mkdir(parents=True, exist_ok=True)
    for index, video_id in enumerate(ids, 1):
        record_path = records_dir / f"{video_id}.json"
        if record_path.is_file():
            print(f"[{index}/26] {video_id}: prior phase-2 record preserved", flush=True)
            continue
        source = probe_source(video_id)
        acquisition = acquire_video(video_id, args.output_dir / "video_cache")
        local = None
        if acquisition["video_path"]:
            local = probe_local_video(
                ROOT / acquisition["video_path"],
                intervals[video_id],
                args.output_dir / "test_clips",
            )
        usable = bool(
            acquisition["success"]
            and local
            and local["video_stream_present"]
            and local["duration_reaches_all_annotated_intervals"]
            and local["all_frames_decoded"]
            and local["test_clip_success"]
        )
        row = {
            "video_id": video_id,
            "transcript_staged": True,
            "annotated_intervals": intervals[video_id],
            "source_probe": source,
            "acquisition": acquisition,
            "local_validation": local,
            "fully_usable": usable,
        }
        write_json_new(record_path, row)
        print(
            f"[{index}/26] {video_id}: source={source['success']} "
            f"download={acquisition['success']} usable={usable}",
            flush=True,
        )

    records = [
        json.loads((records_dir / f"{video_id}.json").read_text(encoding="utf-8"))
        for video_id in ids
    ]
    affected_ids = {
        video_id: result
        for video_id, result in summary["transcript_retries"].items()
        if result["status"] == "recovered"
    }
    prior_inventory = [
        json.loads(line)
        for line in (args.phase1_summary.parent / "video_inventory.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line
    ]
    affected_questions = {
        row["video_id"]: len(row["affected_test_question_ids"])
        for row in prior_inventory
        if row["video_id"] in affected_ids
    }
    report = {
        "requested_videos": len(ids),
        "source_probe_success": sum(row["source_probe"]["success"] for row in records),
        "download_success": sum(row["acquisition"]["success"] for row in records),
        "fully_usable_videos": sum(row["fully_usable"] for row in records),
        "affected_test_questions": sum(affected_questions.values()),
        "affected_questions_with_transcript_and_usable_media": sum(
            affected_questions[row["video_id"]] for row in records if row["fully_usable"]
        ),
        "source_probe_error_counts": dict(
            Counter(
                row["source_probe"]["error_type"] or row["source_probe"]["stderr"]
                for row in records
                if not row["source_probe"]["success"]
            )
        ),
        "download_error_counts": dict(
            Counter(
                row["acquisition"]["error_type"] or row["acquisition"]["stderr"]
                for row in records
                if not row["acquisition"]["success"]
            )
        ),
        "per_video_records": [
            str((records_dir / f"{video_id}.json").relative_to(ROOT)) for video_id in ids
        ],
    }
    write_json_new(args.output_dir / "summary.json", report)
    print(
        json.dumps(
            {key: value for key, value in report.items() if key != "per_video_records"}, indent=2
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
