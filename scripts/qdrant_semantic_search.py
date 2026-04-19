#!/usr/bin/env python3
"""
Simple Qdrant semantic search example using the live local collection.

This script:
1. Connects to a local Qdrant container
2. Reads the existing `medical_video_transcripts` collection
3. Encodes a sample text query
4. Runs similarity search with an optional metadata filter

Run Qdrant first:
docker run -d --name qdrant \
  -p 6333:6333 -p 6334:6334 \
  -v "$(pwd)/qdrant_storage:/qdrant/storage:z" \
  qdrant/qdrant
"""

from __future__ import annotations

from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue
from sentence_transformers import SentenceTransformer

QDRANT_URL = "http://localhost:6333"
COLLECTION_NAME = "medical_video_transcripts"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


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
    client = QdrantClient(url=QDRANT_URL)
    model = SentenceTransformer(EMBEDDING_MODEL)

    example_query = "How to perform epley maneuver for vertigo?"
    query_vector = model.encode([example_query])[0].tolist()

    print(f"Connected to Qdrant at {QDRANT_URL}")
    print(f"Collection: {COLLECTION_NAME}")
    print("\nExample search:")
    print(f"Query question: {example_query}")

    results = search_similar(
        client=client,
        collection_name=COLLECTION_NAME,
        query_vector=query_vector,
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
