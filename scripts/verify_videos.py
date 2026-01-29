#!/usr/bin/env python3
"""
Verify MedVidQA Dataset Videos
Check which videos from the official TREC MedVidQA dataset are still available
"""
import json
import urllib.request

def verify_medvidqa_videos():
    # Load REAL MedVidQA dataset
    with open('MedVidQA/train.json', 'r') as f:
        data = json.load(f)

    print("="*70)
    print("  VERIFYING VIDEOS FROM REAL MedVidQA DATASET")
    print("="*70)
    print(f"\nTotal samples in MedVidQA: {len(data)}")

    # Get unique videos
    seen = set()
    unique_videos = []
    for item in data:
        vid = item['video_id']
        if vid not in seen:
            seen.add(vid)
            unique_videos.append(item)

    print(f"Unique videos in dataset: {len(unique_videos)}")
    print("\nTesting first 30 videos for availability...")
    print("-"*70)

    available = []
    unavailable = []

    for i, item in enumerate(unique_videos[:30]):
        vid_id = item['video_id']
        question = item['question'][:50]
        
        try:
            url = f'https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            response = urllib.request.urlopen(req, timeout=5)
            size = len(response.read())
            
            if size > 2000:
                available.append(item)
                status = "✅"
            else:
                unavailable.append(item)
                status = "❌"
        except:
            unavailable.append(item)
            status = "❌"
        
        print(f"{i+1}. [{status}] {vid_id}: {question}...")

    print()
    print("="*70)
    print(f"RESULTS: {len(available)} available, {len(unavailable)} unavailable")
    print("="*70)

    if available:
        print("\n📹 VERIFIED AVAILABLE VIDEOS FROM MedVidQA DATASET:")
        print("-"*70)
        for item in available[:10]:
            print(f"\nVideo ID: {item['video_id']}")
            print(f"Question: {item['question']}")
            print(f"URL: https://www.youtube.com/watch?v={item['video_id']}")
            print(f"Answer Segment: {item['answer_start']} - {item['answer_end']}")
        
        # Save available videos
        with open('data/verified_medvidqa_videos.json', 'w') as f:
            json.dump(available, f, indent=2)
        print(f"\n✅ Saved {len(available)} verified videos to data/verified_medvidqa_videos.json")

if __name__ == "__main__":
    verify_medvidqa_videos()
