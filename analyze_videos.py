import json
from collections import Counter

def analyze_test_json():
    # Load the test.json file
    with open('MedVidQA/test.json', 'r') as f:
        data = json.load(f)
    
    print(f"Total number of entries in test.json: {len(data)}")
    
    # Extract all video URLs
    video_urls = [entry['video_url'] for entry in data]
    
    # Count unique videos
    unique_videos = set(video_urls)
    print(f"Number of unique video URLs: {len(unique_videos)}")
    
    # Count frequency of each video
    video_counts = Counter(video_urls)
    
    # Show most frequently used videos
    print("\nTop 10 most frequently used videos:")
    for video_url, count in video_counts.most_common(10):
        video_id = video_url.split('v=')[1] if 'v=' in video_url else video_url
        print(f"  {video_id}: {count} questions")
    
    # Show distribution statistics
    counts = list(video_counts.values())
    print(f"\nVideo usage statistics:")
    print(f"  Average questions per video: {sum(counts) / len(counts):.1f}")
    print(f"  Maximum questions from one video: {max(counts)}")
    print(f"  Minimum questions from one video: {min(counts)}")
    
    # Show how many videos have different numbers of questions
    count_distribution = Counter(counts)
    print(f"\nDistribution of questions per video:")
    for num_questions, num_videos in sorted(count_distribution.items()):
        print(f"  {num_videos} videos have {num_questions} question(s) each")

if __name__ == "__main__":
    analyze_test_json()