"""Build the locally supported MedVidQA evaluation collection."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from backend.transcripts import CachedTranscriptRepository
from backend.video_processing import LocalVideoRepository
from evaluation.medvidqa_dataset import OfficialMedVidQADataset
from evaluation.supported_collection import (
    FFprobeVideoProbe,
    SupportedCollectionBuilder,
    write_json,
)

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path, default=PROJECT_ROOT / "MedVidQA")
    parser.add_argument(
        "--catalog",
        type=Path,
        default=PROJECT_ROOT / "data" / "medvidqa_video_catalog.json",
    )
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "transcript_cache",
    )
    parser.add_argument(
        "--video-cache",
        type=Path,
        default=PROJECT_ROOT / "data" / "video_cache",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            PROJECT_ROOT / "evaluation" / "results" / "supported_collection" / "manifest.json"
        ),
    )
    parser.add_argument(
        "--runtime-video-manifest",
        type=Path,
        default=PROJECT_ROOT / "data" / "supported_video_collection.json",
    )
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    catalog_ids = {
        str(document["video_id"])
        for document in catalog.get("documents", [])
        if isinstance(document, dict) and document.get("video_id")
    }
    collection = SupportedCollectionBuilder(
        transcript_repository=CachedTranscriptRepository(args.transcript_cache),
        video_repository=LocalVideoRepository(args.video_cache),
        video_probe=FFprobeVideoProbe(),
        catalog_video_ids=catalog_ids,
        project_root=PROJECT_ROOT,
        transcript_cache=args.transcript_cache,
    ).build(OfficialMedVidQADataset.load(args.dataset_dir))
    write_json(args.output, collection.as_serializable())
    write_json(args.runtime_video_manifest, collection.supported_video_manifest())
    LOGGER.info(
        "Supported collection: %s",
        json.dumps(collection.as_serializable()["summary"], sort_keys=True),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
