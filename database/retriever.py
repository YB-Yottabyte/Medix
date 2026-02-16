"""
Enhanced Retriever for searching medical procedures database
Supports smart semantic and cross-encoder re-ranking
"""
import numpy as np
from typing import List, Dict, Optional
from sentence_transformers import SentenceTransformer

class ProcedureRetriever:
    def __init__(self, config, db):
        """Initialize retriever with config and database (any type)"""
        self.config = config
        self.db = db
        self.top_k = config['database']['top_k']
        self.similarity_threshold = config['database']['similarity_threshold']
        self.transcript_fetcher = None  # Set externally after init
    
    def cosine_similarity(self, a, b):
        """Compute cosine similarity between two vectors"""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    
    def search(self, query: str) -> List[Dict]:
        """Search for relevant procedures using single query"""
        query_embedding = self.db.embedding_model.encode([query])[0]
        
        similarities = []
        for i, proc_embedding in enumerate(self.db.embeddings):
            sim = self.cosine_similarity(query_embedding, proc_embedding)
            similarities.append((i, sim))
        
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        results = []
        for idx, sim in similarities[:self.top_k]:
            if sim >= self.similarity_threshold:
                proc = self.db.procedures[idx].copy()
                proc['similarity_score'] = float(sim)
                results.append(proc)
        
        return results

    def multi_query_search(self, queries: List[str], weights: Optional[List[float]] = None) -> List[Dict]:
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
        
        n_procs = len(self.db.embeddings)
        if weights is None:
            weights = [1.0 / len(queries)] * len(queries)
        else:
            total = sum(weights)
            weights = [w / total for w in weights]
        
        fused_scores = np.zeros(n_procs)
        
        for query, weight in zip(queries, weights):
            q_emb = self.db.embedding_model.encode([query])[0]
            for i, proc_emb in enumerate(self.db.embeddings):
                sim = self.cosine_similarity(q_emb, proc_emb)
                fused_scores[i] += weight * sim
        
        ranked = np.argsort(fused_scores)[::-1][:self.top_k]
        
        results = []
        for idx in ranked:
            score = float(fused_scores[idx])
            if score >= self.similarity_threshold:
                proc = self.db.procedures[idx].copy()
                proc['similarity_score'] = score
                results.append(proc)
        
        return results
    
    def search_with_context(self, query: str, body_part: str = None,
                            condition: str = None) -> List[Dict]:
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
    
    def format_results_for_context(self, results: List[Dict]) -> str:
        """Format search results as context for AI model, including video transcripts"""
        if not results:
            return "No relevant procedures found in the database."
        
        # ---- PRIMARY PROCEDURE (best match — include transcript) ----
        top = results[0]
        context_parts = ["PRIMARY PROCEDURE (base your answer on THIS one only):\n"]
        context_parts.append(f"Title: {top['question']}")
        context_parts.append(f"Relevance Score: {top['similarity_score']:.2%}")
        
        video_id = top.get('video_id')
        answer_start = top.get('answer_start')
        answer_end = top.get('answer_end')
        
        if self.transcript_fetcher and video_id:
            transcript_text = self.transcript_fetcher.fetch(
                video_id, start=answer_start, end=answer_end
            )
            if transcript_text:
                context_parts.append(f"\nVideo Transcript (what the instructor actually says):")
                context_parts.append(transcript_text)
                if answer_start is not None and answer_end is not None:
                    mins_s, secs_s = divmod(int(answer_start), 60)
                    mins_e, secs_e = divmod(int(answer_end), 60)
                    context_parts.append(f"\nRelevant video segment: {mins_s}:{secs_s:02d} to {mins_e}:{secs_e:02d}")
        
        if top.get('steps'):
            for j, step in enumerate(top['steps']):
                if 'description' in step:
                    step_text = step['description']
                elif 'heading' in step:
                    step_text = step['heading']
                else:
                    step_text = f"Step {j+1}"
                if 'absolute_bounds' in step:
                    start = step['absolute_bounds'][0]
                    end = step['absolute_bounds'][1] if len(step['absolute_bounds']) > 1 else start
                    context_parts.append(f"\nTimestamp: {step_text}")
        
        if 'duration' in top:
            context_parts.append(f"\nTotal Video Duration: {top['duration']:.0f} seconds")
        
        # ---- RELATED PROCEDURES (titles only, no transcripts) ----
        if len(results) > 1:
            context_parts.append(f"\n\nRelated procedures (for reference only, do NOT base your answer on these):")
            for proc in results[1:]:
                context_parts.append(f"  - {proc['question']} (match: {proc['similarity_score']:.0%})")
        
        return "\n".join(context_parts)
    
    def get_procedure_summary(self, question: str) -> Dict:
        """Get summary of a specific procedure"""
        for proc in self.db.procedures:
            if proc['question'].lower() == question.lower():
                return proc
        return None

