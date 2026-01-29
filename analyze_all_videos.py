import json
import os

def analyze_all_json_files():
    files = ['train.json', 'val.json', 'test.json']
    
    total_entries = 0
    all_video_urls = set()
    
    for filename in files:
        filepath = f'MedVidQA/{filename}'
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                data = json.load(f)
            
            print(f"\n{filename}:")
            print(f"  Number of entries: {len(data)}")
            
            # Get sample_id range
            sample_ids = [entry['sample_id'] for entry in data]
            print(f"  Sample ID range: {min(sample_ids)} - {max(sample_ids)}")
            
            # Count unique videos in this file
            video_urls = [entry['video_url'] for entry in data]
            unique_videos_in_file = set(video_urls)
            print(f"  Unique videos in this file: {len(unique_videos_in_file)}")
            
            # Add to overall stats
            total_entries += len(data)
            all_video_urls.update(unique_videos_in_file)
    
    print(f"\nOverall statistics:")
    print(f"  Total entries across all files: {total_entries}")
    print(f"  Total unique videos across all files: {len(all_video_urls)}")

if __name__ == "__main__":
    analyze_all_json_files()