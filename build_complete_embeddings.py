#!/usr/bin/env python3
"""
Build embeddings from the complete verified dataset (2,714 Q&A pairs from 784 videos)
"""
import json
import numpy as np
import pickle
from pathlib import Path
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

def build_embeddings_from_verified_dataset():
    """Build embeddings directly from verified_medvidqa_videos.json"""
    
    print("="*60)
    print("  BUILDING EMBEDDINGS FROM COMPLETE VERIFIED DATASET")
    print("="*60)
    
    # Load the complete verified dataset
    with open('data/verified_medvidqa_videos.json', 'r') as f:
        verified_data = json.load(f)
    
    print(f"✅ Loaded {len(verified_data)} verified Q&A pairs")
    
    # Count unique videos
    unique_videos = len(set(item['video_id'] for item in verified_data))
    print(f"✅ From {unique_videos} unique videos")
    
    # Prepare procedures data
    procedures = []
    questions = []
    
    for item in verified_data:
        procedure = {
            'id': item['sample_id'],
            'question': item['question'],
            'video_id': item['video_id'],
            'video_url': item['video_url'],
            'answer_start': item['answer_start'],
            'answer_end': item['answer_end'],
            'answer_start_second': item['answer_start_second'],
            'answer_end_second': item['answer_end_second'],
            'video_length': item['video_length']
        }
        procedures.append(procedure)
        questions.append(item['question'])
    
    print(f"\n🔧 Building embeddings for {len(questions)} questions...")
    
    # Load embedding model
    model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
    
    # Create embeddings
    embeddings = model.encode(questions, show_progress_bar=True)
    print(f"✅ Generated embeddings shape: {embeddings.shape}")
    
    # Save to cache
    cache_dir = Path('data/cache_medvidqa_verified')
    cache_dir.mkdir(exist_ok=True)
    
    # Save procedures
    with open(cache_dir / 'procedures.pkl', 'wb') as f:
        pickle.dump(procedures, f)
    
    # Save embeddings
    with open(cache_dir / 'embeddings.npy', 'wb') as f:
        np.save(f, embeddings)
    
    print(f"\n✅ COMPLETE! Saved to {cache_dir}")
    print(f"   📊 Procedures: {len(procedures)}")
    print(f"   📐 Embeddings: {embeddings.shape}")
    print(f"   🎯 Your system now has access to all {unique_videos} verified videos!")

if __name__ == "__main__":
    build_embeddings_from_verified_dataset()