#!/usr/bin/env python3
"""
Build database from VERIFIED MedVidQA Dataset Videos
Uses only videos confirmed to be publicly available
"""
import json
import pickle
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer
import urllib.request

def verify_video(vid_id):
    """Check if YouTube video is available"""
    try:
        url = f'https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req, timeout=3)
        size = len(response.read())
        return size > 2000
    except:
        return False

def build_verified_medvidqa_database():
    print("="*70)
    print("  Building Database from VERIFIED MedVidQA Videos")
    print("="*70)
    
    # Load all MedVidQA data
    all_data = []
    for split in ['train.json', 'val.json', 'test.json']:
        path = f'MedVidQA/{split}'
        if Path(path).exists():
            with open(path, 'r') as f:
                data = json.load(f)
                all_data.extend(data)
                print(f"✓ Loaded {len(data)} samples from {split}")
    
    print(f"\nTotal samples: {len(all_data)}")
    
    # Get unique videos and verify availability
    print("\n🔍 Verifying video availability (testing first 100 unique videos)...")
    
    seen_videos = set()
    verified_data = []
    tested = 0
    
    for item in all_data:
        vid_id = item['video_id']
        
        if vid_id in seen_videos:
            if any(v['video_id'] == vid_id for v in verified_data):
                verified_data.append(item)
            continue
        
        seen_videos.add(vid_id)
        tested += 1
        
        if tested <= 100:
            if verify_video(vid_id):
                verified_data.append(item)
                print(f"{vid_id}: {item['question'][:40]}...")
            else:
                print(f"{vid_id}: unavailable")
        
        if tested >= 100:
            break
    
    print(f"\n📊 Verified {len(verified_data)} samples from available videos")
    
    # Create procedures
    procedures = []
    seen_questions = set()
    
    for item in verified_data:
        question = item['question']
        
        if question.lower() in seen_questions:
            continue
        seen_questions.add(question.lower())
        
        proc = {
            'question': question,
            'video_id': item['video_id'],
            'youtube_url': item['video_url'],
            'youtube_embed': f"https://www.youtube.com/embed/{item['video_id']}?start={item['answer_start_second']}",
            'duration': item.get('video_length', 0),
            'answer_start': item.get('answer_start_second', 0),
            'answer_end': item.get('answer_end_second', 0),
            'steps': [
                {
                    'index': 0,
                    'heading': f"Watch from {item['answer_start']} to {item['answer_end']}",
                    'absolute_bounds': [item['answer_start_second'], item['answer_end_second']]
                }
            ],
            'sample_id': item.get('sample_id', 0),
            'source': 'MedVidQA Dataset (TREC 2024)'
        }
        procedures.append(proc)
    
    print(f"✓ Created {len(procedures)} unique verified procedures")
    
    # Build embeddings
    print("\n🔧 Building embeddings...")
    embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    
    texts = [proc['question'] for proc in procedures]
    embeddings = embedding_model.encode(texts, show_progress_bar=True, convert_to_numpy=True)
    
    # Save to cache
    cache_dir = Path('data/cache_medvidqa_verified')
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    with open(cache_dir / 'procedures.pkl', 'wb') as f:
        pickle.dump(procedures, f)
    
    with open(cache_dir / 'embeddings.npy', 'wb') as f:
        np.save(f, embeddings)
    
    print(f"\nDatabase saved to {cache_dir}")
    
    # Show sample procedures
    print("\n" + "="*70)
    print("Sample Verified MedVidQA Procedures:")
    print("="*70)
    for i, proc in enumerate(procedures[:10], 1):
        print(f"\n{i}. {proc['question']}")
        print(f"Video: {proc['youtube_url']}")
        print(f"Answer: {proc['answer_start']}s - {proc['answer_end']}s")
        print(f"Source: {proc['source']}")
    
    print("\n" + "="*70)
    print(f"Built database with {len(procedures)} verified MedVidQA procedures!")
    print("="*70)

if __name__ == "__main__":
    build_verified_medvidqa_database()
