#!/usr/bin/env python3
"""Inventory original MedVidQA resources and retry only known Week 1 failures.

Outputs use exclusive creation so an audit cannot overwrite prior results or caches.
The retry scope is the 47 catalog failures and the 26 target videos behind the
59 transcript-blocked test questions. It never reads answer intervals for fetching.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from youtube_transcript_api import YouTubeTranscriptApi

ROOT = Path(__file__).resolve().parents[2]
SPLITS = ("train", "val", "test")
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_new(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_jsonl_new(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def local_video_status(video_id: str, latest_gold_end: float) -> dict[str, Any]:
    path = next(
        (
            ROOT / "data" / "video_cache" / f"{video_id}{ext}"
            for ext in VIDEO_EXTENSIONS
            if (ROOT / "data" / "video_cache" / f"{video_id}{ext}").is_file()
        ),
        None,
    )
    if path is None:
        return {
            "local_video_present": False,
            "local_video_path": None,
            "frame_decode_checked": False,
            "frame_decode_success": False,
            "clip_source_plausible": False,
            "video_probe_error": None,
        }
    try:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        details = json.loads(probe.stdout)
        duration = float(details["format"]["duration"])
        stream = any(item.get("codec_type") == "video" for item in details.get("streams", []))
        frame = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                str(min(1.0, duration / 2)),
                "-i",
                str(path),
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "pipe:1",
            ],
            check=False,
            capture_output=True,
            timeout=20,
        )
        frame_ok = frame.returncode == 0 and bool(frame.stdout)
        return {
            "local_video_present": True,
            "local_video_path": str(path.relative_to(ROOT)),
            "video_duration_seconds": duration,
            "frame_decode_checked": True,
            "frame_decode_success": frame_ok,
            "clip_source_plausible": stream and frame_ok and duration >= latest_gold_end,
            "video_probe_error": None,
        }
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        return {
            "local_video_present": True,
            "local_video_path": str(path.relative_to(ROOT)),
            "frame_decode_checked": False,
            "frame_decode_success": False,
            "clip_source_plausible": False,
            "video_probe_error": f"{type(exc).__name__}: {exc}",
        }


def retry_metadata(video_id: str) -> dict[str, Any]:
    try:
        response = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        title = str(payload["title"]).strip()
        if not title:
            return {
                "status": "failed",
                "http_status": response.status_code,
                "title": None,
                "author_name": None,
                "error_type": "ValueError",
                "error": "empty title",
            }
        return {
            "status": "recovered",
            "http_status": response.status_code,
            "title": title,
            "author_name": str(payload.get("author_name", "")),
            "error_type": None,
            "error": None,
        }
    except (requests.RequestException, ValueError, KeyError) as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        return {
            "status": "failed",
            "http_status": status,
            "title": None,
            "author_name": None,
            "error_type": type(exc).__name__,
            "error": str(exc),
        }


def retry_transcript(video_id: str, staged_cache: Path) -> dict[str, Any]:
    try:
        transcript = YouTubeTranscriptApi().fetch(video_id)
        cues = [
            {"start": cue.start, "duration": cue.duration, "text": cue.text}
            for cue in transcript.snippets
        ]
        if not cues:
            return {
                "status": "failed",
                "cue_count": 0,
                "language_code": None,
                "error_type": "ValueError",
                "error": "empty transcript",
            }
        write_json_new(staged_cache / f"{video_id}.json", cues)
        return {
            "status": "recovered",
            "cue_count": len(cues),
            "language_code": getattr(transcript, "language_code", None),
            "error_type": None,
            "error": None,
        }
    except Exception as exc:  # The upstream package uses several distinct exception classes.
        return {
            "status": "failed",
            "cue_count": 0,
            "language_code": None,
            "error_type": type(exc).__name__,
            "error": str(exc),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise FileExistsError(f"Audit output directory is not empty: {args.output_dir}")

    source_paths = {split: ROOT / "MedVidQA" / f"{split}.json" for split in SPLITS}
    sources = {split: load_json(path) for split, path in source_paths.items()}
    records: dict[str, dict[str, Any]] = {}
    for split, items in sources.items():
        for item in items:
            video_id = str(item["video_id"])
            row = records.setdefault(
                video_id,
                {
                    "video_id": video_id,
                    "splits": set(),
                    "sample_ids": [],
                    "source_urls": set(),
                    "source_durations": set(),
                    "latest_gold_end": 0.0,
                },
            )
            row["splits"].add(split)
            row["sample_ids"].append(str(item["sample_id"]))
            row["source_urls"].add(str(item["video_url"]))
            row["source_durations"].add(float(item["video_length"]))
            row["latest_gold_end"] = max(row["latest_gold_end"], float(item["answer_end_second"]))

    catalog = load_json(ROOT / "data" / "medvidqa_video_catalog.json")
    documents = {entry["video_id"]: entry for entry in catalog["documents"]}
    unavailable_ids = set(catalog["unavailable_video_ids"])
    candidate_failures = set(
        load_json(
            ROOT
            / "development"
            / "evaluation"
            / "results"
            / "candidate_transcript_cache_report.json"
        )["unavailable_video_ids"]
    )
    predictions = [
        json.loads(line)
        for line in (
            ROOT
            / "development"
            / "evaluation"
            / "results"
            / "end_to_end"
            / "test"
            / "predictions.jsonl"
        )
        .read_text(encoding="utf-8")
        .splitlines()
        if line
    ]
    affected_questions: dict[str, list[str]] = defaultdict(list)
    for prediction in predictions:
        target = next(
            (
                item
                for item in prediction["retrieved"]
                if item["video_id"] == prediction["expected_video_id"]
            ),
            None,
        )
        if target and str(target.get("failure_reason") or "").startswith(
            "TranscriptUnavailableError"
        ):
            affected_questions[prediction["expected_video_id"]].append(str(prediction["sample_id"]))

    timestamp = datetime.now(timezone.utc).isoformat()
    metadata_retries = {}
    transcript_retries = {}
    if args.retry:
        for video_id in sorted(unavailable_ids):
            metadata_retries[video_id] = retry_metadata(video_id)
        for video_id in sorted(affected_questions):
            if video_id not in candidate_failures:
                raise ValueError(f"Target was not in prior failed transcript report: {video_id}")
            transcript_retries[video_id] = retry_transcript(
                video_id, args.output_dir / "recovered_transcripts"
            )

    inventory = []
    transcript_dir = ROOT / "data" / "transcript_cache"
    for video_id in sorted(records):
        original = records[video_id]
        document = documents.get(video_id)
        transcript_path = transcript_dir / f"{video_id}.json"
        cues = load_json(transcript_path) if transcript_path.is_file() else None
        media = local_video_status(video_id, original["latest_gold_end"])
        inventory.append(
            {
                "video_id": video_id,
                "splits": sorted(original["splits"]),
                "question_count": len(original["sample_ids"]),
                "sample_ids": sorted(original["sample_ids"], key=int),
                "source_url": next(iter(original["source_urls"])),
                "source_url_consistent": len(original["source_urls"]) == 1,
                "annotation_duration_consistent": len(original["source_durations"]) == 1,
                "catalog_present": document is not None,
                "catalog_title": document.get("title") if document else None,
                "catalog_author": document.get("author_name") if document else None,
                "catalog_url_present": bool(document and document.get("source_uri")),
                "catalog_originally_unavailable": video_id in unavailable_ids,
                "metadata_retry": metadata_retries.get(video_id),
                "transcript_cached": cues is not None,
                "transcript_cue_count": len(cues) if cues is not None else None,
                "candidate_transcript_attempt_failed": video_id in candidate_failures,
                "affected_test_question_ids": affected_questions.get(video_id, []),
                "transcript_retry": transcript_retries.get(video_id),
                "source_currently_available": None,
                "source_availability_note": "No direct video availability check; oEmbed is metadata only",
                **media,
            }
        )

    if len(inventory) != 899 or len(predictions) != 155:
        raise ValueError("Unexpected original dataset or test prediction size")
    summary = {
        "created_utc": timestamp,
        "input_sha256": {
            str(path.relative_to(ROOT)): sha256(path)
            for path in [
                *source_paths.values(),
                ROOT / "data" / "medvidqa_video_catalog.json",
                ROOT
                / "development"
                / "evaluation"
                / "results"
                / "candidate_transcript_cache_report.json",
            ]
        },
        "unique_videos": len(inventory),
        "catalog_present": sum(r["catalog_present"] for r in inventory),
        "catalog_missing": len(unavailable_ids),
        "transcripts_cached": sum(r["transcript_cached"] for r in inventory),
        "local_videos": sum(r["local_video_present"] for r in inventory),
        "frame_decode_success": sum(r["frame_decode_success"] for r in inventory),
        "clip_source_plausible": sum(r["clip_source_plausible"] for r in inventory),
        "affected_test_questions": sum(map(len, affected_questions.values())),
        "affected_test_videos": len(affected_questions),
        "metadata_retry_counts": dict(Counter(r["status"] for r in metadata_retries.values())),
        "metadata_retry_error_types": dict(
            Counter(r["error_type"] for r in metadata_retries.values() if r["error_type"])
        ),
        "transcript_retry_counts": dict(Counter(r["status"] for r in transcript_retries.values())),
        "transcript_retry_error_types": dict(
            Counter(r["error_type"] for r in transcript_retries.values() if r["error_type"])
        ),
        "metadata_retries": metadata_retries,
        "transcript_retries": transcript_retries,
    }
    write_jsonl_new(args.output_dir / "video_inventory.jsonl", inventory)
    write_json_new(args.output_dir / "summary.json", summary)
    print(
        json.dumps(
            {
                key: value
                for key, value in summary.items()
                if key not in {"metadata_retries", "transcript_retries"}
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
