"""Create a blinded reviewer-specific rating file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from evaluation.generation_review import ReviewTemplateService


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--reviewer-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise TypeError("blinded review manifest must be a JSON object")
    review = ReviewTemplateService().prepare(
        manifest,
        reviewer_id=args.reviewer_id,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(review, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
