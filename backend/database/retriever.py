"""
Enhanced Retriever for searching medical procedures database
Supports smart semantic and cross-encoder re-ranking
"""

import re

from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue


class ProcedureRetriever:
    def __init__(self, config, db):
        """Initialize retriever with config and database (any type)"""
        self.config = config
        self.db = db
        self.top_k = config["database"]["top_k"]
        self.similarity_threshold = config["database"]["similarity_threshold"]
        self.lexical_weight = config.get("database", {}).get("lexical_weight", 0.15)
        self.transcript_fetcher = None  # Set externally after init
        self.qdrant_url = config.get("database", {}).get("qdrant_url", "http://localhost:6333")
        self.collection_name = config.get("database", {}).get(
            "qdrant_collection", "medical_video_transcripts"
        )
        self.qdrant_client = QdrantClient(url=self.qdrant_url)

    def _tokenize(self, text: str) -> set:
        """Tokenize text into normalized word tokens."""
        if not text:
            return set()
        return set(re.findall(r"[a-zA-Z0-9]+", text.lower()))

    def _lexical_overlap_score(self, query: str, procedure: dict) -> float:
        """Compute lexical overlap to boost exact medical term matches."""
        query_tokens = self._tokenize(query)
        if not query_tokens:
            return 0.0

        proc_text_parts = [procedure.get("question", "")]
        if procedure.get("answer"):
            proc_text_parts.append(procedure.get("answer", ""))

        proc_tokens = self._tokenize(" ".join(proc_text_parts))
        if not proc_tokens:
            return 0.0

        overlap = query_tokens & proc_tokens
        return len(overlap) / len(query_tokens)

    def _search_qdrant(
        self,
        query_embedding: list[float] | tuple[float, ...],
        limit: int,
        source_filter: str | None = None,
    ) -> list[dict]:
        """Fetch top semantic matches from Qdrant with metadata payloads."""
        query_filter = None
        if source_filter:
            query_filter = Filter(
                must=[FieldCondition(key="source", match=MatchValue(value=source_filter))]
            )

        points = self.qdrant_client.query_points(
            collection_name=self.collection_name,
            query=list(query_embedding),
            query_filter=query_filter,
            with_payload=True,
            limit=limit,
        ).points

        semantic_results = []
        for point in points:
            payload = dict(point.payload or {})
            payload["semantic_score"] = float(point.score)
            semantic_results.append(payload)

        return self._merge_procedure_metadata(semantic_results)

    def _merge_procedure_metadata(self, semantic_matches: list[dict]) -> list[dict]:
        """
        Keep Qdrant as the similarity engine, then enrich the results with
        full procedure metadata from Neon PostgreSQL.
        """
        video_ids = [match.get("video_id") for match in semantic_matches if match.get("video_id")]
        procedures_by_video = self.db.get_procedures_by_video_ids(video_ids)

        merged_results = []
        for match in semantic_matches:
            metadata = procedures_by_video.get(
                match.get("video_id")
            ) or self.db.get_procedure_by_question(match.get("question", ""))
            procedure = metadata.copy() if metadata else {}
            procedure.update(match)
            merged_results.append(procedure)

        return merged_results

    def _rank_results(self, query: str, semantic_matches: list[dict]) -> list[dict]:
        """Blend Qdrant semantic scores with the existing lexical boost."""
        ranked = []
        for procedure in semantic_matches:
            semantic = procedure["semantic_score"]
            lexical = self._lexical_overlap_score(query, procedure)
            score = (1.0 - self.lexical_weight) * semantic + self.lexical_weight * lexical
            if score >= self.similarity_threshold:
                result = procedure.copy()
                result["similarity_score"] = float(score)
                ranked.append(result)

        ranked.sort(key=lambda item: item["similarity_score"], reverse=True)
        return ranked[: self.top_k]

    def search(self, query: str) -> list[dict]:
        """Search for relevant procedures using single query"""
        query_embedding = self.db.embedding_model.encode([query])[0]
        semantic_matches = self._search_qdrant(query_embedding, limit=max(self.top_k * 3, 10))
        return self._rank_results(query, semantic_matches)

    def multi_query_search(
        self, queries: list[str], weights: list[float] | None = None
    ) -> list[dict]:
        """
        Enhanced search: fuse results from multiple query variants.
        This improves recall — important when the user's phrasing
        doesn't exactly match the procedure title.

        Args:
            queries: list of query strings (e.g. original + paraphrase)
            weights: optional per-query weights (default: equal)
        Returns:
            Ranked list of procedures
        """
        if not queries:
            return []

        if weights is None:
            weights = [1.0 / len(queries)] * len(queries)
        else:
            total = sum(weights)
            weights = [w / total for w in weights]

        fused_results = {}
        for query, weight in zip(queries, weights, strict=False):
            q_emb = self.db.embedding_model.encode([query])[0]
            semantic_matches = self._search_qdrant(q_emb, limit=max(self.top_k * 3, 10))
            ranked_matches = self._rank_results(query, semantic_matches)

            for procedure in ranked_matches:
                key = procedure.get("question", "").lower()
                if key not in fused_results:
                    fused_results[key] = procedure.copy()
                    fused_results[key]["similarity_score"] = 0.0
                fused_results[key]["similarity_score"] += weight * procedure["similarity_score"]

        ranked = sorted(
            fused_results.values(),
            key=lambda item: item["similarity_score"],
            reverse=True,
        )
        return [
            procedure
            for procedure in ranked[: self.top_k]
            if procedure["similarity_score"] >= self.similarity_threshold
        ]

    def search_with_context(
        self, query: str, body_part: str | None = None, condition: str | None = None
    ) -> list[dict]:
        """
        Context-aware search: generates multiple query variants from
        structured context (body part, condition) and fuses results.
        Designed for the image-recognition → text-search pipeline.
        """
        queries = [query]
        weights = [0.5]

        if body_part and condition:
            queries.append(f"How to treat {condition} on the {body_part}")
            weights.append(0.3)
            queries.append(f"{condition} {body_part} first aid")
            weights.append(0.2)

        return self.multi_query_search(queries, weights)

    def format_results_for_context(self, results: list[dict]) -> str:
        """Format search results as context for AI model, including video transcripts"""
        if not results:
            return "No relevant procedures found in the database."

        # ---- PRIMARY PROCEDURE (best match — include transcript) ----
        top = results[0]
        context_parts = ["PRIMARY PROCEDURE (base your answer on THIS one only):\n"]
        context_parts.append(f"Title: {top['question']}")
        context_parts.append(f"Relevance Score: {top['similarity_score']:.2%}")

        video_id = top.get("video_id")
        answer_start = top.get("answer_start")
        answer_end = top.get("answer_end")

        if self.transcript_fetcher and video_id:
            transcript_text = self.transcript_fetcher.fetch(
                video_id, start=answer_start, end=answer_end
            )
            if transcript_text:
                # Cap transcript to keep total prompt under Groq's per-request token window.
                max_transcript_chars = 3500
                if len(transcript_text) > max_transcript_chars:
                    transcript_text = (
                        transcript_text[:max_transcript_chars].rstrip() + " ...[truncated]"
                    )
                context_parts.append("\nVideo Transcript (what the instructor actually says):")
                context_parts.append(transcript_text)
                if answer_start is not None and answer_end is not None:
                    mins_s, secs_s = divmod(int(answer_start), 60)
                    mins_e, secs_e = divmod(int(answer_end), 60)
                    context_parts.append(
                        f"\nRelevant video segment: {mins_s}:{secs_s:02d} to {mins_e}:{secs_e:02d}"
                    )

        if top.get("steps"):
            for j, step in enumerate(top["steps"]):
                if "description" in step:
                    step_text = step["description"]
                elif "heading" in step:
                    step_text = step["heading"]
                else:
                    step_text = f"Step {j+1}"
                if "absolute_bounds" in step:
                    start = step["absolute_bounds"][0]
                    _end = step["absolute_bounds"][1] if len(step["absolute_bounds"]) > 1 else start
                    context_parts.append(f"\nTimestamp: {step_text}")

        if "duration" in top:
            context_parts.append(f"\nTotal Video Duration: {top['duration']:.0f} seconds")

        # ---- RELATED PROCEDURES (titles only, no transcripts) ----
        if len(results) > 1:
            context_parts.append(
                "\n\nRelated procedures (for reference only, do NOT base your answer on these):"
            )
            for proc in results[1:]:
                context_parts.append(
                    f"  - {proc['question']} (match: {proc['similarity_score']:.0%})"
                )

        full_context = "\n".join(context_parts)
        # Final safety cap: keep total context under Groq's per-request token window
        # regardless of which endpoint built it.
        max_total_context_chars = 5000
        if len(full_context) > max_total_context_chars:
            full_context = full_context[:max_total_context_chars].rstrip() + " ...[truncated]"
        return full_context

    def get_procedure_summary(self, question: str) -> dict:
        """Get summary of a specific procedure"""
        return self.db.get_procedure_by_question(question)
