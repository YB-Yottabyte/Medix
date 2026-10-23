#!/usr/bin/env python3
"""Generate timestamped MedVidQA transcripts from validated local media.

This is a resumable data-recovery utility. Original transcript caches and media
are read-only. ASR transcripts and immutable per-video records are written to a
separate versioned directory so benchmark provenance remains explicit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT / "development/evaluation/results/week1/2026-10-04-asr-v1"
ASR_CACHE = STAGE / "transcript_cache_asr"
RECORDS = STAGE / "asr_records"
MODEL_ID = "openai/whisper-large-v3-turbo"
MODEL_REVISION = "41f01f3fe87f28c78e2fbf8b568835947dd65ed9"
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".mov")

TRANSCRIPT_DIRS = (
    ROOT / "development/evaluation/results/week1/2026-09-24-full-corpus-v1/transcript_cache",
    ROOT
    / "development/evaluation/results/week1/2026-09-24-candidate-snapshot-v1/resources/transcript_cache",
    ROOT / "development/evaluation/results/week1/2026-10-01-full-download-v1/transcript_cache",
)
VIDEO_DIRS = (
    ROOT / "development/evaluation/results/week1/2026-09-24-full-corpus-v1/video_cache",
    ROOT
    / "development/evaluation/results/week1/2026-09-24-candidate-snapshot-v1/resources/video_cache",
    ROOT / "development/evaluation/results/week1/2026-10-01-full-download-v1/video_cache",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def original_ids() -> set[str]:
    result: set[str] = set()
    for split in ("train", "val", "test"):
        rows = json.loads((ROOT / "MedVidQA" / f"{split}.json").read_text(encoding="utf-8"))
        result.update(str(row["video_id"]) for row in rows)
    if len(result) != 899:
        raise ValueError(f"Expected 899 unique videos, found {len(result)}")
    return result


def original_transcript_exists(video_id: str) -> bool:
    return any((directory / f"{video_id}.json").is_file() for directory in TRANSCRIPT_DIRS)


def video_path(video_id: str) -> Path | None:
    for directory in VIDEO_DIRS:
        for extension in VIDEO_EXTENSIONS:
            candidate = directory / f"{video_id}{extension}"
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
    return None


def candidates() -> list[tuple[str, Path]]:
    return [
        (video_id, media)
        for video_id in sorted(original_ids())
        if not original_transcript_exists(video_id)
        and not (ASR_CACHE / f"{video_id}.json").is_file()
        and not (RECORDS / f"{video_id}.json").is_file()
        and (media := video_path(video_id)) is not None
    ]


def status() -> dict[str, Any]:
    ids = original_ids()
    original = {video_id for video_id in ids if original_transcript_exists(video_id)}
    media = {video_id for video_id in ids if video_path(video_id) is not None}
    asr = {path.stem for path in ASR_CACHE.glob("*.json")}
    records = list(RECORDS.glob("*.json"))
    failures = 0
    for path in records:
        try:
            failures += json.loads(path.read_text(encoding="utf-8")).get("status") != "recovered"
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            failures += 1
    return {
        "dataset_videos": len(ids),
        "media_available": len(media),
        "original_transcripts": len(original),
        "asr_transcripts": len(asr),
        "merged_transcripts": len(original | asr),
        "fully_resource_ready": len(media & (original | asr)),
        "asr_attempts": len(records),
        "asr_failures": failures,
        "pending_local_media_without_transcript": len(candidates()),
        "updated_at_utc": utc_now(),
    }


def initialize_manifest() -> None:
    ASR_CACHE.mkdir(parents=True, exist_ok=True)
    RECORDS.mkdir(parents=True, exist_ok=True)
    manifest = STAGE / "run_manifest.json"
    if not manifest.exists():
        write_json_atomic(
            manifest,
            {
                "created_at_utc": utc_now(),
                "dataset_video_count": 899,
                "purpose": "offline ASR recovery from validated local MedVidQA media",
                "model_id": MODEL_ID,
                "model_revision": MODEL_REVISION,
                "source_media_directories": [str(path.relative_to(ROOT)) for path in VIDEO_DIRS],
                "original_transcript_directories": [
                    str(path.relative_to(ROOT)) for path in TRANSCRIPT_DIRS
                ],
                "output_transcript_directory": str(ASR_CACHE.relative_to(ROOT)),
                "output_record_directory": str(RECORDS.relative_to(ROOT)),
                "parameters": {
                    "language": "english",
                    "task": "transcribe",
                    "chunk_length_s": 30,
                    "batch_size": 16,
                    "return_timestamps": True,
                },
                "python": platform.python_version(),
            },
        )


def load_pipeline() -> tuple[Any, str, str]:
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU is required for the corpus ASR job")
    device = "cuda:0"
    dtype = torch.float16
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        MODEL_ID,
        revision=MODEL_REVISION,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
        use_safetensors=True,
    ).to(device)
    processor = AutoProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    asr = pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        chunk_length_s=30,
        batch_size=16,
        torch_dtype=dtype,
        device=device,
    )
    return asr, torch.cuda.get_device_name(0), str(torch.__version__)


def transcribe_one(asr: Any, video_id: str, media: Path, gpu_name: str, torch_version: str) -> None:
    started = time.monotonic()
    record_path = RECORDS / f"{video_id}.json"
    try:
        result = asr(
            str(media),
            return_timestamps=True,
            generate_kwargs={"language": "english", "task": "transcribe"},
        )
        cues = []
        for chunk in result.get("chunks", []):
            timestamps = chunk.get("timestamp")
            text = str(chunk.get("text", "")).strip()
            if not text or not timestamps or timestamps[0] is None or timestamps[1] is None:
                continue
            start = max(0.0, float(timestamps[0]))
            end = float(timestamps[1])
            if end <= start:
                continue
            cues.append({"start": start, "duration": end - start, "text": text})
        _validate_cues(cues)
        output = ASR_CACHE / f"{video_id}.json"
        write_json_atomic(output, cues)
        record = {
            "video_id": video_id,
            "status": "recovered",
            "source_media_path": str(media.relative_to(ROOT)),
            "source_media_sha256": sha256(media),
            "source_media_size_bytes": media.stat().st_size,
            "transcript_path": str(output.relative_to(ROOT)),
            "transcript_sha256": sha256(output),
            "cue_count": len(cues),
            "model_id": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "gpu": gpu_name,
            "torch_version": torch_version,
            "parameters": {
                "language": "english",
                "task": "transcribe",
                "chunk_length_s": 30,
                "batch_size": 16,
                "return_timestamps": True,
            },
            "completed_at_utc": utc_now(),
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "final_error": None,
        }
    except Exception as exc:
        record = {
            "video_id": video_id,
            "status": "failed",
            "source_media_path": str(media.relative_to(ROOT)),
            "model_id": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "gpu": gpu_name,
            "torch_version": torch_version,
            "completed_at_utc": utc_now(),
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "final_error": f"{type(exc).__name__}: {exc}",
        }
    write_json_atomic(record_path, record)
    print(json.dumps({"video_id": video_id, **record}, sort_keys=True), flush=True)


def run(limit: int | None) -> None:
    pending = candidates()
    if limit is not None:
        pending = pending[:limit]
    print(
        f"ASR completion: {len(pending)} selected; {status()['pending_local_media_without_transcript']} total pending",
        flush=True,
    )
    if not pending:
        return
    asr, gpu_name, torch_version = load_pipeline()
    print(json.dumps({"gpu": gpu_name, "torch": torch_version, "model": MODEL_ID}), flush=True)
    for index, (video_id, media) in enumerate(pending, 1):
        transcribe_one(asr, video_id, media, gpu_name, torch_version)
        if index % 10 == 0 or index == len(pending):
            write_json_atomic(STAGE / "progress.json", status())
            print(json.dumps(status(), sort_keys=True), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("status", "run"))
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    initialize_manifest()
    if args.command == "status":
        print(json.dumps(status(), sort_keys=True))
    else:
        run(args.limit)


def _validate_cues(cues):
    if not cues:
        raise ValueError("ASR returned no non-empty timestamped cues")


if __name__ == "__main__":
    main()
