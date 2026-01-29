"""
Retriever for searching medical procedures database
"""
import numpy as np
from typing import List, Dict
from sentence_transformers import SentenceTransformer

class ProcedureRetriever:
    def __init__(self, config, db):
        """Initialize retriever with config and database (any type)"""
        self.config = config
        self.db = db
        self.top_k = config['database']['top_k']
        self.similarity_threshold = config['database']['similarity_threshold']
    
    def cosine_similarity(self, a, b):
        """Compute cosine similarity between two vectors"""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    
    def search(self, query: str) -> List[Dict]:
        """Search for relevant procedures"""
        # Encode query
        query_embedding = self.db.embedding_model.encode([query])[0]
        
        # Compute similarities
        similarities = []
        for i, proc_embedding in enumerate(self.db.embeddings):
            sim = self.cosine_similarity(query_embedding, proc_embedding)
            similarities.append((i, sim))
        
        # Sort by similarity
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        # Get top-k results above threshold
        results = []
        for idx, sim in similarities[:self.top_k]:
            if sim >= self.similarity_threshold:
                proc = self.db.procedures[idx].copy()
                proc['similarity_score'] = float(sim)
                results.append(proc)
        
        return results
    
    def format_results_for_context(self, results: List[Dict]) -> str:
        """Format search results as context for AI model"""
        if not results:
            return "No relevant procedures found in the database."
        
        context_parts = ["Here are the relevant medical procedures from the database:\n"]
        
        for i, proc in enumerate(results, 1):
            context_parts.append(f"\n{'='*60}")
            context_parts.append(f"Procedure {i}: {proc['procedure_name']}")
            context_parts.append(f"Relevance Score: {proc['similarity_score']:.2%}")
            context_parts.append(f"{'='*60}")
            
            if proc.get('steps'):
                context_parts.append("\nStep-by-Step Instructions:")
                for j, step in enumerate(proc['steps']):
                    # Handle both old format and HiREST format
                    if 'description' in step:
                        step_text = step['description']
                    elif 'heading' in step:
                        step_text = step['heading']
                    else:
                        step_text = f"Step {j+1}"
                    
                    # Handle timing info
                    if 'absolute_bounds' in step:
                        start = step['absolute_bounds'][0]
                        end = step['absolute_bounds'][1] if len(step['absolute_bounds']) > 1 else start
                        duration = end - start
                        context_parts.append(f"\nStep {j + 1}: {step_text}")
                        context_parts.append(f"  └─ Time: {start:.0f}s - {end:.0f}s ({duration:.0f}s)")
                    elif 'duration' in step:
                        context_parts.append(f"\nStep {j + 1}: {step['description']}")
                        context_parts.append(f"  └─ Duration: {step['duration']:.0f}s")
                    else:
                        context_parts.append(f"\nStep {j + 1}: {step_text}")
            
            # Handle duration
            if 'duration' in proc:
                context_parts.append(f"\nTotal Duration: {proc['duration']:.0f} seconds")
            elif 'v_duration' in proc:
                context_parts.append(f"\nVideo Duration: {proc['v_duration']:.0f} seconds")
        
        return "\n".join(context_parts)
    
    def get_procedure_summary(self, procedure_name: str) -> Dict:
        """Get summary of a specific procedure"""
        for proc in self.db.procedures:
            if proc['procedure_name'].lower() == procedure_name.lower():
                return proc
        return None
