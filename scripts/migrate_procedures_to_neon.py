#!/usr/bin/env python3
"""
Migrate MedVidQA procedure metadata from cleaned JSON splits into Neon PostgreSQL.

This script only migrates procedure metadata.
Qdrant remains the local vector search engine.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_batch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = PROJECT_ROOT / "MedVidQA" / "cleaned"
SCHEMA_PATH = PROJECT_ROOT / "sql" / "procedures.sql"
SPLITS = ("train.json", "val.json", "test.json")
SOURCE_NAME = "MedVidQA Dataset (TREC 2024)"


def resolve_postgres_url() -> str:
    env_value = os.environ.get("POSTGRES_URL")
    if env_value:
        return env_value

    env_files = [
        PROJECT_ROOT / ".env.local",
        PROJECT_ROOT / "frontend" / ".env.local",
    ]
    for env_file in env_files:
        if not env_file.exists():
            continue
        for line in env_file.read_text().splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            if key.strip() == "POSTGRES_URL":
                return value.strip().strip("'").strip('"')

    msg = "POSTGRES_URL is not configured. Export it or add it to frontend/.env.local."
    raise RuntimeError(msg)


def load_records() -> list[tuple[str, str, str, str, int, int, int, str]]:
    records: list[tuple[str, str, str, str, int, int, int, str]] = []

    for split in SPLITS:
        split_path = DATASET_DIR / split
        if not split_path.exists():
            continue

        with split_path.open() as file:
            items = json.load(file)

        for item in items:
            records.append(
                (
                    str(item["sample_id"]),
                    item.get("question", ""),
                    item.get("video_id", ""),
                    item.get("video_url", ""),
                    int(item.get("answer_start_second") or 0),
                    int(item.get("answer_end_second") or 0),
                    int(item.get("answer_duration") or 0),
                    SOURCE_NAME,
                )
            )

    return records


def main() -> None:
    postgres_url = resolve_postgres_url()
    rows = load_records()
    if not rows:
        raise RuntimeError(f"No records found in {DATASET_DIR}")

    schema_sql = SCHEMA_PATH.read_text()
    insert_sql = """
        INSERT INTO procedures (
            sample_id,
            question,
            video_id,
            video_url,
            answer_start,
            answer_end,
            answer_duration,
            source
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (sample_id) DO NOTHING
    """

    with psycopg2.connect(postgres_url) as conn:
        with conn.cursor() as cur:
            cur.execute(schema_sql)
            execute_batch(cur, insert_sql, rows, page_size=500)
        conn.commit()

    print(f"Migrated {len(rows)} procedure rows into Neon PostgreSQL.")


if __name__ == "__main__":
    main()
