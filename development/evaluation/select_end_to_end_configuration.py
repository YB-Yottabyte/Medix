"""Select an end-to-end score weight using validation summaries only."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def select_validation_configuration(
    summaries: list[dict[str, Any]],
) -> dict[str, Any]:
    if not summaries:
        raise ValueError("at least one validation summary is required")
    if any(summary.get("split") != "validation" for summary in summaries):
        raise ValueError("configuration selection accepts validation summaries only")
    selected = max(
        summaries,
        key=lambda summary: (
            summary["end_to_end_localization"]["mean_iou"],
            summary["end_to_end_localization"]["r_at_1_iou_0.5"],
            summary["selected_video_accuracy"],
        ),
    )
    return {
        "selection_split": "validation",
        "selection_metric": "mean_iou",
        "selected_retrieval_weight": selected["retrieval_weight"],
        "selected_localization_weight": selected["localization_weight"],
        "selected_summary": selected,
        "candidates": [
            {
                "retrieval_weight": summary["retrieval_weight"],
                "localization_weight": summary["localization_weight"],
                "mean_iou": summary["end_to_end_localization"]["mean_iou"],
                "r_at_1_iou_0.5": summary["end_to_end_localization"]["r_at_1_iou_0.5"],
                "selected_video_accuracy": summary["selected_video_accuracy"],
            }
            for summary in sorted(
                summaries,
                key=lambda item: item["retrieval_weight"],
            )
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("summaries", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    summaries = [json.loads(path.read_text(encoding="utf-8")) for path in args.summaries]
    selection = select_validation_configuration(summaries)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(selection, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
