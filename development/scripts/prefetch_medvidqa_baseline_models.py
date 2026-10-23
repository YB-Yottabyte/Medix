#!/usr/bin/env python3
"""Stage and verify the pinned Medix baseline models before an offline run."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from huggingface_hub import snapshot_download

from backend.research_pipeline import (
    TEXT_MODEL,
    TEXT_REVISION,
    VISUAL_MODEL,
    VISUAL_REVISION,
)

MODELS = (
    ("text_embedding", TEXT_MODEL, TEXT_REVISION),
    ("visual_similarity", VISUAL_MODEL, VISUAL_REVISION),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Require both pinned snapshots to already exist in the Hugging Face cache.",
    )
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()

    snapshots = []
    for role, model, revision in MODELS:
        snapshot_path = Path(
            snapshot_download(
                repo_id=model,
                revision=revision,
                local_files_only=args.offline,
            )
        )
        snapshots.append(
            {
                "role": role,
                "model": model,
                "revision": revision,
                "snapshot_path": str(snapshot_path.resolve()),
            }
        )

    manifest = {
        "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "offline_verification": args.offline,
        "snapshots": snapshots,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, sort_keys=True))


if __name__ == "__main__":
    main()
