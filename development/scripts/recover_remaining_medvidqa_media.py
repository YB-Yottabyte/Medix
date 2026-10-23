#!/usr/bin/env python3
"""Recover the 21 remaining Week 1 videos using the verified isolated yt-dlp stack."""

from __future__ import annotations

import json
import os
import subprocess
from collections import defaultdict
from datetime import datetime, timezone

from development.scripts.recover_medvidqa_videos import ROOT, probe_local_video, write_json_new

PHASE1 = ROOT / "development/evaluation/results/week1/2026-09-24"
PHASE2 = ROOT / "development/evaluation/results/week1/2026-09-24-phase2"
DIAGNOSTIC = ROOT / "development/evaluation/results/week1/2026-09-24-downloader-diagnostic"
STAGE = ROOT / "development/evaluation/results/week1/2026-09-24-remaining-media"
FORMAT = "bestvideo[height<=360]+bestaudio/best[height<=360]/worst"
UVX = ["uvx", "--from", "yt-dlp[default]==2026.08.19", "yt-dlp"]


def main() -> None:
    summary = json.loads((PHASE1 / "summary.json").read_text())
    targets = {
        video_id
        for video_id, row in summary["transcript_retries"].items()
        if row["status"] == "recovered"
    }
    prior = {p.stem for p in (PHASE2 / "video_cache").glob("*.mp4")}
    prior |= {p.stem for p in (DIAGNOSTIC / "videos").glob("*.mp4")}
    ids = sorted(targets - prior)
    assert len(targets) == 26 and len(prior) == 5 and len(ids) == 21
    intervals = defaultdict(list)
    for row in json.loads((ROOT / "MedVidQA/test.json").read_text()):
        if row["video_id"] in targets:
            intervals[row["video_id"]].append(
                {
                    "sample_id": str(row["sample_id"]),
                    "start_seconds": float(row["answer_start_second"]),
                    "end_seconds": float(row["answer_end_second"]),
                }
            )
    env = os.environ.copy()
    env["UV_CACHE_DIR"] = "/private/tmp/medix-week1-uv-cache"
    (STAGE / "records").mkdir(parents=True, exist_ok=True)
    (STAGE / "videos").mkdir(parents=True, exist_ok=True)
    for index, video_id in enumerate(ids, 1):
        record_path = STAGE / "records" / f"{video_id}.json"
        if record_path.exists():
            print(f"[{index}/21] {video_id}: existing record preserved", flush=True)
            continue
        url = f"https://www.youtube.com/watch?v={video_id}"
        command = [
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
            FORMAT,
            "--merge-output-format",
            "mp4",
            "--print",
            "before_dl:%(format_id)s",
            "--output",
            str(STAGE / "videos" / "%(id)s.%(ext)s"),
            url,
        ]
        started = datetime.now(timezone.utc).isoformat()
        try:
            run = subprocess.run(
                command, text=True, capture_output=True, timeout=900, env=env, check=False
            )
            rc, stdout, stderr, error = run.returncode, run.stdout, run.stderr, None
        except (OSError, subprocess.SubprocessError) as exc:
            rc, stdout, stderr, error = None, "", "", f"{type(exc).__name__}: {exc}"
        files = [
            p
            for ext in (".mp4", ".mkv", ".webm", ".mov")
            if (p := STAGE / "videos" / f"{video_id}{ext}").is_file()
        ]
        video = files[0] if len(files) == 1 else None
        selected = [line.strip() for line in stdout.splitlines() if line.strip()]
        validation = (
            probe_local_video(video, intervals[video_id], STAGE / "clips") if video else None
        )
        usable = bool(
            rc == 0
            and validation
            and validation["video_stream_present"]
            and validation["duration_reaches_all_annotated_intervals"]
            and validation["all_frames_decoded"]
            and validation["test_clip_success"]
        )
        record = {
            "video_id": video_id,
            "source_url": url,
            "acquired_at_utc": started,
            "method": "yt-dlp[default]==2026.08.19 with yt-dlp-ejs and Deno; no credentials, cookies, proxy, or impersonation",
            "format_selector": FORMAT,
            "selected_format_id": selected[0] if selected else None,
            "download_returncode": rc,
            "download_stdout": stdout,
            "download_stderr": stderr,
            "download_error": error or (stderr.strip() if rc != 0 else None),
            "download_success": rc == 0 and video is not None,
            "video_path": str(video.relative_to(ROOT)) if video else None,
            "file_size_bytes": video.stat().st_size if video else None,
            "annotated_intervals": intervals[video_id],
            "latest_annotated_end_seconds": max(x["end_seconds"] for x in intervals[video_id]),
            "local_validation": validation,
            "fully_usable": usable,
        }
        write_json_new(record_path, record)
        print(
            f"[{index}/21] {video_id}: download={record['download_success']} usable={usable} "
            f"format={record['selected_format_id']} error={record['download_error']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
