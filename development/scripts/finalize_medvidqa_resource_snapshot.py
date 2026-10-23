#!/usr/bin/env python3
"""Freeze the final Week 1 MedVidQA resource inventory without network access."""

from __future__ import annotations

import hashlib
import json
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
WEEK1 = ROOT / "development/evaluation/results/week1"
ASR = WEEK1 / "2026-10-04-asr-v1"
SOL = WEEK1 / "2026-10-04-sol-resource-snapshot-v1/full-download-metadata"
OUTPUT = WEEK1 / "2026-10-04-final-resource-snapshot-v1"
CATALOG = ROOT / "data/medvidqa_video_catalog.json"
RETRIEVAL = WEEK1 / "2026-09-24-candidate-snapshot-v1/retrieval"

ORIGINAL_TRANSCRIPT_DIRS = (
    WEEK1 / "2026-09-24-full-corpus-v1/transcript_cache",
    WEEK1 / "2026-09-24-candidate-snapshot-v1/resources/transcript_cache",
    SOL / "transcript_cache",
)
MEDIA_RECORD_DIRS = (
    WEEK1 / "2026-09-24-full-corpus-v1/media_records",
    WEEK1 / "2026-10-01-full-download-v1/media_records",
    SOL / "media_records",
)
VIDEO_DIRS = (
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


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, ensure_ascii=False, sort_keys=True)
        stream.write("\n")


def validate_transcript(path: Path) -> tuple[bool, int, str | None]:
    try:
        cues = read_json(path)
        if not isinstance(cues, list) or not cues:
            return False, 0, "empty transcript"
        valid = 0
        for cue in cues:
            text = str(cue["text"]).strip()
            start = float(cue["start"])
            duration = float(cue["duration"])
            if start < 0 or duration < 0:
                return False, len(cues), "invalid timestamp"
            valid += bool(text)
        if not valid:
            return False, len(cues), "no nonblank transcript cues"
        return True, valid, None
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        return False, 0, f"{type(exc).__name__}: {exc}"


def transcript_sources() -> dict[str, tuple[str, Path]]:
    sources: dict[str, tuple[str, Path]] = {}
    for directory in ORIGINAL_TRANSCRIPT_DIRS:
        for path in sorted(directory.glob("*.json")):
            sources.setdefault(path.stem, ("source_or_downloaded_caption", path))
    for path in sorted((ASR / "transcript_cache_asr").glob("*.json")):
        if path.stem in sources:
            raise ValueError(f"ASR transcript collides with source transcript: {path.stem}")
        sources[path.stem] = ("whisper_asr", path)
    return sources


def load_media_records() -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for directory in MEDIA_RECORD_DIRS:
        for path in sorted(directory.glob("*.json")):
            record = read_json(path)
            video_id = str(record.get("video_id", path.stem))
            previous = records.get(video_id)
            if (
                previous is None
                or (
                    previous.get("local_media_status") != "usable"
                    and record.get("local_media_status") == "usable"
                )
                or (directory == SOL and record.get("local_media_status") != "usable")
            ):
                records[video_id] = record
    return records


def physical_media(video_id: str) -> Path | None:
    for directory in VIDEO_DIRS:
        for extension in VIDEO_EXTENSIONS:
            candidate = directory / f"{video_id}{extension}"
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
    return None


def failure_group(error: str | None) -> str:
    lower = (error or "unknown").lower()
    if "private video" in lower:
        return "private_video"
    if "sign in to confirm" in lower:
        return "youtube_bot_verification"
    if "removed for violating" in lower:
        return "removed_terms_of_service"
    if "video is unavailable" in lower or "video unavailable" in lower:
        return "video_unavailable"
    if "http error 403" in lower:
        return "http_403"
    if "requested format is not available" in lower:
        return "format_unavailable"
    if "no non-empty timestamped cues" in lower:
        return "no_recognizable_timestamped_speech"
    return "unknown_or_other"


def split_annotations() -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    index = read_json(SOL / "source_index.json")
    rows = {
        split: read_json(ROOT / "MedVidQA" / f"{split}.json") for split in ("train", "val", "test")
    }
    if len(index) != 899:
        raise ValueError(f"Expected 899 source rows, found {len(index)}")
    return index, rows


def catalog_rows() -> tuple[dict[str, dict[str, Any]], set[str]]:
    payload = read_json(CATALOG)
    documents = {str(row["video_id"]): row for row in payload["documents"]}
    missing = {str(video_id) for video_id in payload["unavailable_video_ids"]}
    if len(documents) != 852 or len(missing) != 47:
        raise ValueError("Unexpected frozen catalog cardinality")
    return documents, missing


def retrieval_coverage(fully_usable: set[str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    union: set[str] = set()
    for split in ("validation", "test"):
        rows = [
            json.loads(line) for line in (RETRIEVAL / f"{split}.jsonl").read_text().splitlines()
        ]
        candidates = {str(candidate["video_id"]) for row in rows for candidate in row["retrieved"]}
        union.update(candidates)
        result[split] = {
            "questions": len(rows),
            "candidate_slots": sum(len(row["retrieved"]) for row in rows),
            "unique_candidates": len(candidates),
            "fully_usable_candidates": len(candidates & fully_usable),
            "questions_all_top5_fully_usable": sum(
                all(str(candidate["video_id"]) in fully_usable for candidate in row["retrieved"])
                for row in rows
            ),
            "questions_correct_target_in_top5": sum(
                str(row["expected_video_id"])
                in {str(candidate["video_id"]) for candidate in row["retrieved"]}
                for row in rows
            ),
            "questions_correct_target_fully_usable": sum(
                str(row["expected_video_id"]) in fully_usable for row in rows
            ),
            "questions_correct_target_in_top5_and_fully_usable": sum(
                str(row["expected_video_id"]) in fully_usable
                and str(row["expected_video_id"])
                in {str(candidate["video_id"]) for candidate in row["retrieved"]}
                for row in rows
            ),
        }
    result["union"] = {
        "unique_candidates": len(union),
        "fully_usable_candidates": len(union & fully_usable),
    }
    return result


def main() -> None:
    if OUTPUT.exists():
        raise FileExistsError(f"Refusing to overwrite frozen output: {OUTPUT}")

    index, question_rows = split_annotations()
    catalog, catalog_missing = catalog_rows()
    transcripts = transcript_sources()
    media_records = load_media_records()
    asr_records = {path.stem: read_json(path) for path in (ASR / "asr_records").glob("*.json")}
    asr_attempt_ids = set(asr_records)
    original_transcript_ids = {
        video_id
        for video_id, (kind, _) in transcripts.items()
        if kind == "source_or_downloaded_caption"
    }
    asr_success_ids = {
        video_id for video_id, record in asr_records.items() if record.get("status") == "recovered"
    }

    if len(original_transcript_ids) != 167:
        raise ValueError(f"Expected 167 source captions, found {len(original_transcript_ids)}")
    if len(asr_attempt_ids) != 676 or len(asr_success_ids) != 673:
        raise ValueError("Unexpected ASR result cardinality")

    # The ASR job attempted every local video lacking a source caption. The
    # pre-ASR status recorded all 167 source-caption videos as fully ready.
    media_ids = original_transcript_ids | asr_attempt_ids
    transcript_ids = set(transcripts)
    fully_usable = media_ids & transcript_ids
    if (len(media_ids), len(transcript_ids), len(fully_usable)) != (843, 840, 840):
        raise ValueError("Final resource cardinality disagrees with frozen Sol progress")

    output_cache = OUTPUT / "transcript_cache"
    output_cache.mkdir(parents=True)
    transcript_details: dict[str, dict[str, Any]] = {}
    for video_id, (kind, source) in sorted(transcripts.items()):
        valid, cue_count, error = validate_transcript(source)
        if not valid:
            raise ValueError(f"Invalid frozen transcript {source}: {error}")
        destination = output_cache / f"{video_id}.json"
        shutil.copyfile(source, destination)
        if sha256(source) != sha256(destination):
            raise ValueError(f"Hash mismatch copying {video_id}")
        transcript_details[video_id] = {
            "status": kind,
            "validated": True,
            "cue_count": cue_count,
            "source_path": str(source.relative_to(ROOT)),
            "snapshot_path": str(destination.relative_to(ROOT)),
            "sha256": sha256(destination),
            "error": None,
        }

    inventory: list[dict[str, Any]] = []
    for video_id in sorted(index):
        source = index[video_id]
        transcript = transcript_details.get(video_id)
        asr_record = asr_records.get(video_id)
        media_record = media_records.get(video_id, {})
        media_available = video_id in media_ids
        media_file = physical_media(video_id)
        media_hash = None
        media_size = None
        media_path = None
        if asr_record:
            media_hash = asr_record.get("source_media_sha256")
            media_size = asr_record.get("source_media_size_bytes")
            media_path = asr_record.get("source_media_path")
        if media_hash is None and media_file:
            media_hash = sha256(media_file)
        if media_size is None and media_file:
            media_size = media_file.stat().st_size
        if media_path is None and media_file:
            media_path = str(media_file.relative_to(ROOT))
        if media_size is None:
            media_size = media_record.get("file_size_bytes")

        validation = media_record.get("video_validation") or {}
        if video_id in fully_usable:
            final_status = "fully_usable"
        elif video_id in transcript_ids:
            final_status = "transcript_only"
        elif video_id in media_ids:
            final_status = "media_only"
        elif video_id in catalog:
            final_status = "metadata_only"
        else:
            final_status = "unavailable_or_unresolved"

        final_error = media_record.get("final_error")
        if asr_record and asr_record.get("status") != "recovered":
            final_error = asr_record.get("final_error")
        row = {
            "video_id": video_id,
            "splits": source["splits"],
            "sample_ids": source["sample_ids"],
            "question_count": len(source["sample_ids"]),
            "source_url": source["source_url"],
            "latest_annotated_answer_end_seconds": source["latest_annotated_answer_end_seconds"],
            "catalog_metadata": {
                "status": "present" if video_id in catalog else "missing_from_frozen_catalog",
                "title": catalog.get(video_id, {}).get("title"),
                "author": catalog.get(video_id, {}).get("author_name"),
                "source_uri": catalog.get(video_id, {}).get("source_uri"),
            },
            "transcript": transcript
            or {
                "status": "asr_failed" if video_id in asr_attempt_ids else "unavailable",
                "validated": False,
                "cue_count": 0,
                "source_path": None,
                "snapshot_path": None,
                "sha256": None,
                "error": asr_record.get("final_error") if asr_record else None,
            },
            "media": {
                "status": "usable" if media_available else "unavailable",
                "recorded_path": media_path,
                "sha256": media_hash,
                "file_size_bytes": media_size,
                "duration_seconds": media_record.get("duration_seconds"),
                "duration_reaches_latest_annotation": validation.get(
                    "duration_reaches_all_annotated_intervals"
                ),
                "frame_decode_validated": validation.get("all_frames_decoded"),
                "clip_extraction_validated": validation.get("test_clip_success"),
                "selected_format": media_record.get("selected_format_id"),
                "source_probe": media_record.get("source_probe"),
                "download_attempts": media_record.get("attempts", []),
                "validation_basis": (
                    "acquisition_record"
                    if validation
                    else "ASR source hash and frozen Sol completion status"
                    if asr_record
                    else "frozen pre-ASR fully-ready status"
                    if media_available
                    else None
                ),
                "final_error": media_record.get("final_error") if not media_available else None,
            },
            "failure_group": failure_group(final_error) if final_status != "fully_usable" else None,
            "final_status": final_status,
        }
        inventory.append(row)

    inventory_path = OUTPUT / "video_inventory.jsonl"
    with inventory_path.open("x", encoding="utf-8") as stream:
        for row in inventory:
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    split_summary: dict[str, Any] = {}
    for split, rows in question_rows.items():
        video_ids = {str(row["video_id"]) for row in rows}
        split_summary[split] = {
            "questions": len(rows),
            "unique_videos": len(video_ids),
            "catalog_metadata": len(video_ids & set(catalog)),
            "transcripts": len(video_ids & transcript_ids),
            "media": len(video_ids & media_ids),
            "fully_usable_videos": len(video_ids & fully_usable),
            "fully_usable_questions": sum(str(row["video_id"]) in fully_usable for row in rows),
        }

    final_counts = Counter(row["final_status"] for row in inventory)
    media_failures = Counter(
        row["failure_group"] for row in inventory if row["media"]["status"] == "unavailable"
    )
    asr_failures = Counter(
        row["failure_group"] for row in inventory if row["final_status"] == "media_only"
    )
    missing_test = [
        {
            "video_id": video_id,
            "sample_ids": index[video_id]["sample_ids"],
            "question_count": len(index[video_id]["sample_ids"]),
        }
        for video_id in sorted(catalog_missing)
        if "test" in index[video_id]["splits"]
    ]
    summary = {
        "snapshot_time_utc": read_json(ASR / "progress.json")["updated_at_utc"],
        "dataset_videos": 899,
        "catalog_metadata": len(catalog),
        "transcripts": len(transcript_ids),
        "source_or_downloaded_captions": len(original_transcript_ids),
        "asr_transcripts": len(asr_success_ids),
        "media": len(media_ids),
        "fully_usable": len(fully_usable),
        "final_status_counts": dict(sorted(final_counts.items())),
        "remaining_media_failure_groups": dict(sorted(media_failures.items())),
        "remaining_asr_failure_groups": dict(sorted(asr_failures.items())),
        "split_coverage": split_summary,
        "frozen_retrieval_candidate_coverage": retrieval_coverage(fully_usable),
        "frozen_catalog_missing": {
            "videos": len(catalog_missing),
            "test_targets": missing_test,
            "test_questions_affected": sum(row["question_count"] for row in missing_test),
        },
    }
    summary_path = OUTPUT / "summary.json"
    write_json(summary_path, summary)

    inputs = [
        ROOT / "MedVidQA/train.json",
        ROOT / "MedVidQA/val.json",
        ROOT / "MedVidQA/test.json",
        CATALOG,
        SOL / "source_index.json",
        SOL / "progress.json",
        SOL / "run_manifest.json",
        ASR / "progress.json",
        ASR / "run_manifest.json",
        ASR / "SHA256SUMS",
        RETRIEVAL / "validation.jsonl",
        RETRIEVAL / "test.jsonl",
        ROOT / "development/scripts/finalize_medvidqa_resource_snapshot.py",
    ]
    manifest = {
        "snapshot_time_utc": summary["snapshot_time_utc"],
        "policy": (
            "Offline frozen resource snapshot; original annotations, catalog, retrieval rankings, "
            "models, thresholds, and evaluation logic unchanged"
        ),
        "inputs": [
            {"path": str(path.relative_to(ROOT)), "sha256": sha256(path)} for path in inputs
        ],
        "outputs": [
            {
                "path": str(inventory_path.relative_to(ROOT)),
                "sha256": sha256(inventory_path),
                "rows": 899,
            },
            {
                "path": str(summary_path.relative_to(ROOT)),
                "sha256": sha256(summary_path),
            },
        ],
        "transcript_files": [
            {
                "video_id": video_id,
                "path": details["snapshot_path"],
                "sha256": details["sha256"],
                "source_type": details["status"],
            }
            for video_id, details in sorted(transcript_details.items())
        ],
    }
    manifest_path = OUTPUT / "manifest.json"
    write_json(manifest_path, manifest)
    (OUTPUT / "manifest.sha256").write_text(
        f"{sha256(manifest_path)}  manifest.json\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    print(f"manifest_sha256={sha256(manifest_path)}")


if __name__ == "__main__":
    main()
