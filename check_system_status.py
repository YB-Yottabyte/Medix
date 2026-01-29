import json
import os

def check_system_status():
    """Check the current status of the medical QA system."""
    
    print("="*60)
    print("  MEDICAL QA SYSTEM STATUS CHECK")
    print("="*60)
    
    # Check main verified videos file
    main_file = 'data/verified_medvidqa_videos.json'
    if os.path.exists(main_file):
        with open(main_file, 'r') as f:
            current_data = json.load(f)
        
        # Count unique videos
        unique_videos = len(set(item['video_id'] for item in current_data))
        
        print(f"✅ Main system file: {main_file}")
        print(f"   📊 Question-answer pairs: {len(current_data)}")
        print(f"   📹 Unique videos: {unique_videos}")
        
        # Show some examples
        print(f"\n📋 Sample entries:")
        for i, item in enumerate(current_data[:5]):
            print(f"   {i+1}. Video: {item['video_id']} | Q: {item['question'][:50]}...")
            
    else:
        print(f"❌ Main system file not found: {main_file}")
    
    # Check if embeddings cache exists
    embeddings_dir = 'data/cache_medvidqa_verified'
    if os.path.exists(embeddings_dir):
        embeddings_file = f'{embeddings_dir}/embeddings.npy'
        if os.path.exists(embeddings_file):
            import numpy as np
            embeddings = np.load(embeddings_file)
            print(f"\n✅ Embeddings cache: {embeddings_file}")
            print(f"   📐 Embeddings shape: {embeddings.shape}")
            print(f"   📊 Should match Q&A pairs: {len(current_data) if 'current_data' in locals() else 'Unknown'}")
        else:
            print(f"\n⚠️  Embeddings directory exists but no embeddings file")
    else:
        print(f"\n⚠️  No embeddings cache found - will be created on first run")
    
    # Check backup files
    backup_dirs = [d for d in os.listdir('data') if d.startswith('backup_')]
    if backup_dirs:
        latest_backup = sorted(backup_dirs)[-1]
        print(f"\n📦 Latest backup: data/{latest_backup}")
        
        backup_file = f'data/{latest_backup}/verified_medvidqa_videos_old.json'
        if os.path.exists(backup_file):
            with open(backup_file, 'r') as f:
                old_data = json.load(f)
            old_unique = len(set(item['video_id'] for item in old_data))
            print(f"   📊 Old system: {len(old_data)} Q&A pairs, {old_unique} videos")
            
            if 'current_data' in locals():
                improvement_qa = len(current_data) / len(old_data)
                improvement_videos = unique_videos / old_unique
                print(f"   📈 Improvement: {improvement_videos:.1f}x videos, {improvement_qa:.1f}x Q&A pairs")
    
    # Check complete verification files
    complete_file = 'data/verified_medvidqa_videos_complete.json'
    if os.path.exists(complete_file):
        with open(complete_file, 'r') as f:
            complete_data = json.load(f)
        complete_unique = len(set(item['video_id'] for item in complete_data))
        print(f"\n📄 Complete verified dataset: {complete_file}")
        print(f"   📊 {len(complete_data)} Q&A pairs from {complete_unique} videos")
        
        if 'current_data' in locals():
            if len(current_data) == len(complete_data):
                print(f"   ✅ System is using the complete verified dataset!")
            else:
                print(f"   ⚠️  System has {len(current_data)}, complete has {len(complete_data)}")

if __name__ == "__main__":
    check_system_status()