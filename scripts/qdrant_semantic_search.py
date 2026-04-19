#!/usr/bin/env python3
"""
Simple Qdrant semantic search example for transcript-style embeddings.

This script:
1. Connects to a local Qdrant container
2. Creates a collection
3. Loads existing embeddings and metadata from the local cache
4. Inserts points with payload metadata
5. Runs similarity search with an optional metadata filter

Run Qdrant first:
docker run -d --name qdrant \
  -p 6333:6333 -p 6334:6334 \
  -v "$(pwd)/qdrant_storage:/qdrant/storage:z" \
  qdrant/qdrant

Install dependency:
pip install qdrant-client
"""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import Any

import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)


QDRANT_URL = "http://localhost:6333"
COLLECTION_NAME = "medical_video_transcripts"
CACHE_DIR = Path("data/cache_medvidqa_verified")


def load_cached_records(cache_dir: Path) -> list[dict[str, Any]]:
    """Load transcript metadata and embeddings built by the local pipeline."""
    procedures_path = cache_dir / "procedures.pkl"
    embeddings_path = cache_dir / "embeddings.npy"

    if not procedures_path.exists() or not embeddings_path.exists():
        msg = (
            f"Missing cached data in {cache_dir}. "
            "Run scripts/build_database.py first so procedures.pkl and embeddings.npy exist."
        )
        raise FileNotFoundError(msg)

    with procedures_path.open("rb") as file:
        procedures = pickle.load(file)  # noqa: S301 - trusted local cache created by this project

    embeddings = np.load(embeddings_path)

    if len(procedures) != len(embeddings):
        msg = "procedures.pkl and embeddings.npy must have the same number of items."
        raise ValueError(msg)

    records = []
    for idx, (procedure, embedding) in enumerate(zip(procedures, embeddings, strict=True), start=1):
        payload = {
            "question": procedure["question"],
            "video_id": procedure.get("video_id"),
            "youtube_url": procedure.get("youtube_url"),
            "youtube_embed": procedure.get("youtube_embed"),
            "answer_start": procedure.get("answer_start"),
            "answer_end": procedure.get("answer_end"),
            "duration": procedure.get("duration"),
            "source": procedure.get("source"),
        }
        records.append({"id": idx, "vector": embedding.tolist(), "payload": payload})

    return records


def create_collection(client: QdrantClient, collection_name: str, vector_size: int) -> None:
    """Create the collection once and add payload indexes for common filters."""
    if not client.collection_exists(collection_name):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )

    client.create_payload_index(
        collection_name=collection_name,
        field_name="video_id",
        field_schema=PayloadSchemaType.KEYWORD,
    )
    client.create_payload_index(
        collection_name=collection_name,
        field_name="source",
        field_schema=PayloadSchemaType.KEYWORD,
    )


def upsert_records(
    client: QdrantClient, collection_name: str, records: list[dict[str, Any]], batch_size: int = 256
) -> None:
    """Insert embeddings and metadata in small batches."""
    for start in range(0, len(records), batch_size):
        batch = records[start : start + batch_size]
        points = [
            PointStruct(id=record["id"], vector=record["vector"], payload=record["payload"])
            for record in batch
        ]
        client.upsert(collection_name=collection_name, wait=True, points=points)


def search_similar(
    client: QdrantClient,
    collection_name: str,
    query_vector: list[float],
    limit: int = 3,
    source_filter: str | None = None,
):
    """Run vector search with an optional metadata filter."""
    query_filter = None
    if source_filter:
        query_filter = Filter(
            must=[FieldCondition(key="source", match=MatchValue(value=source_filter))]
        )

    return client.query_points(
        collection_name=collection_name,
        query=query_vector,
        query_filter=query_filter,
        with_payload=True,
        limit=limit,
    ).points


def main() -> None:
    records = load_cached_records(CACHE_DIR)
    client = QdrantClient(url=QDRANT_URL)

    vector_size = len(records[0]["vector"])
    create_collection(client, COLLECTION_NAME, vector_size)
    upsert_records(client, COLLECTION_NAME, records)

    print(f"Connected to Qdrant at {QDRANT_URL}")
    print(f"Collection: {COLLECTION_NAME}")
    print(f"Inserted {len(records)} transcript embeddings")

    example_query = records[0]
    print("\nExample search:")
    print(f"Query question: {example_query['payload']['question']}")

    results = search_similar(
        client=client,
        collection_name=COLLECTION_NAME,
        query_vector=example_query["vector"],
        limit=3,
        source_filter="MedVidQA Dataset (TREC 2024)",
    )

    print("\nTop matches:")
    for point in results:
        print(
            {
                "id": point.id,
                "score": round(point.score, 4),
                "question": point.payload.get("question"),
                "video_id": point.payload.get("video_id"),
                "source": point.payload.get("source"),
            }
        )


if __name__ == "__main__":
    main()
