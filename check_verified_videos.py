import json

def analyze_verified_videos():
    # Load the verified videos file
    with open('data/verified_medvidqa_videos.json', 'r') as f:
        data = json.load(f)
    
    print(f"Number of verified video entries: {len(data)}")
    
    # Extract unique video URLs
    video_urls = [entry['video_url'] for entry in data]
    unique_videos = set(video_urls)
    print(f"Number of unique verified videos: {len(unique_videos)}")
    
    # Get sample ID range
    sample_ids = [entry['sample_id'] for entry in data]
    print(f"Sample ID range in verified data: {min(sample_ids)} - {max(sample_ids)}")
    
    print(f"\nThis explains the discrepancy:")
    print(f"- Total unique videos in MedVidQA dataset: 899")
    print(f"- Verified/processed videos in your system: {len(unique_videos)}")
    print(f"- Difference: {899 - len(unique_videos)} videos not verified/processed")

if __name__ == "__main__":
    analyze_verified_videos()