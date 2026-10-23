"""Build live resource coverage from catalog/media only; never load QA splits."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from backend.video_processing import LocalVideoRepository, VideoUnavailableError
from development.evaluation.supported_collection import FFprobeVideoProbe


def build_runtime_manifest(catalog: Path, transcripts, videos, probe) -> dict:
    documents = json.loads(catalog.read_text())["documents"]
    available = []
    rejected = {}
    for document in documents:
        video_id = document["video_id"]
        try:
            transcripts.load(video_id)
            probe.duration_seconds(videos.resolve(video_id))
        except (ValueError, TranscriptUnavailableError, VideoUnavailableError) as error:
            rejected[video_id] = type(error).__name__
            continue
        available.append(video_id)
    return {
        "schema_version": 1,
        "definition": "Live catalog videos with validated local media and transcript; no QA labels used.",
        "video_count": len(available),
        "video_ids": sorted(set(available)),
        "catalog_video_count": len(documents),
        "unavailable": rejected,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--transcript-cache", required=True, type=Path)
    parser.add_argument("--video-cache", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = build_runtime_manifest(
        args.catalog,
        CachedTranscriptRepository(args.transcript_cache),
        LocalVideoRepository(args.video_cache),
        FFprobeVideoProbe(),
    )
    if not result["video_ids"]:
        raise ValueError("No usable videos found; refusing to launch an empty live collection")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(
        f"Live evidence collection: {result['video_count']}/{result['catalog_video_count']} catalog videos usable"
    )


if __name__ == "__main__":
    main()
