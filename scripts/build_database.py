#!/usr/bin/env python3
"""Build the local procedure cache from the already verified MedVidQA manifest."""

from __future__ import annotations

import argparse
import json
import logging
import pickle
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from sentence_transformers import SentenceTransformer

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


@dataclass(frozen=True)
class ProcedureCacheBuilder:
    """Create reproducible procedure metadata and dense embeddings."""

    model_name: str = DEFAULT_MODEL
    model_revision: str = DEFAULT_REVISION

    def build(self, records: list[dict[str, Any]], output_dir: Path) -> int:
        procedures = self._procedures(records)
        if not procedures:
            raise ValueError("The verified manifest did not contain any procedures")

        model = SentenceTransformer(self.model_name, revision=self.model_revision)
        embeddings = model.encode(
            [procedure["question"] for procedure in procedures],
            batch_size=64,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=True,
        ).astype(np.float32)

        output_dir.mkdir(parents=True, exist_ok=True)
        with (output_dir / "procedures.pkl").open("wb") as output:
            pickle.dump(procedures, output)
        with (output_dir / "embeddings.npy").open("wb") as output:
            np.save(output, embeddings)
        (output_dir / "build_metadata.json").write_text(
            json.dumps(
                {
                    "source_records": len(records),
                    "procedures": len(procedures),
                    "embedding_dimensions": int(embeddings.shape[1]),
                    "model": self.model_name,
                    "model_revision": self.model_revision,
                    "normalized_embeddings": True,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return len(procedures)

    @staticmethod
    def _procedures(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        procedures = []
        seen_questions: set[str] = set()
        for item in records:
            question = str(item["question"]).strip()
            normalized_question = " ".join(question.lower().split())
            if normalized_question in seen_questions:
                continue
            seen_questions.add(normalized_question)

            video_id = str(item["video_id"])
            answer_start = float(item.get("answer_start_second", 0))
            answer_end = float(item.get("answer_end_second", answer_start))
            procedures.append(
                {
                    "question": question,
                    "video_id": video_id,
                    "youtube_url": item.get("video_url")
                    or f"https://www.youtube.com/watch?v={video_id}",
                    "youtube_embed": (
                        f"https://www.youtube.com/embed/{video_id}?start={int(answer_start)}"
                    ),
                    "duration": float(item.get("video_length", 0)),
                    "answer_start": answer_start,
                    "answer_end": answer_end,
                    "steps": [
                        {
                            "index": 0,
                            "heading": "Watch the annotated procedure segment",
                            "absolute_bounds": [answer_start, answer_end],
                        }
                    ],
                    "sample_id": str(item.get("sample_id", "")),
                    "source": "MedVidQA verified manifest",
                }
            )
        return procedures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=PROJECT_ROOT / "data" / "verified_medvidqa_videos.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "data" / "cache_medvidqa_verified",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    args = parser.parse_args()

    records = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise TypeError("The verified manifest must contain a JSON list")
    count = ProcedureCacheBuilder(args.model, args.revision).build(records, args.output)
    LOGGER.info("Built %d verified procedure embeddings in %s", count, args.output)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
