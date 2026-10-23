#!/usr/bin/env python3
"""
Complete MedVidQA Dataset Video Verification
Verify all 899 unique videos from the complete MedVidQA dataset (train + val + test)
"""

import json
import os
import time
import urllib.request
from collections import defaultdict


def load_all_medvidqa_data():
    """Load data from all MedVidQA files and combine them."""
    all_data = []
    files = ["train.json", "val.json", "test.json"]

    print("Loading MedVidQA dataset files...")
    for filename in files:
        filepath = f"MedVidQA/{filename}"
        if os.path.exists(filepath):
            with open(filepath) as f:
                data = json.load(f)
            print(f"  {filename}: {len(data)} entries")
            all_data.extend(data)
        else:
            print(f"  WARNING: {filename} not found!")

    print(f"Total entries loaded: {len(all_data)}")
    return all_data


def get_unique_videos(data):
    """Extract unique videos from the dataset."""
    video_dict = {}
    video_questions = defaultdict(list)

    for item in data:
        vid = item["video_id"]
        if vid not in video_dict:
            video_dict[vid] = item
        # Keep track of all questions for each video
        video_questions[vid].append(
            {
                "sample_id": item["sample_id"],
                "question": item["question"],
                "answer_start": item["answer_start"],
                "answer_end": item["answer_end"],
                "answer_start_second": item["answer_start_second"],
                "answer_end_second": item["answer_end_second"],
            }
        )

    # Add all questions to each unique video entry
    unique_videos = []
    for vid, video_data in video_dict.items():
        video_data["all_questions"] = video_questions[vid]
        video_data["question_count"] = len(video_questions[vid])
        unique_videos.append(video_data)

    return unique_videos


def verify_video_availability(video_id, timeout=10):
    """Check if a YouTube video is available by testing thumbnail."""
    try:
        url = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        response = urllib.request.urlopen(req, timeout=timeout)
        size = len(response.read())
        return size > 2000  # Available videos have larger thumbnails
    except Exception:
        return False


def verify_all_medvidqa_videos():
    """Verify all unique videos from the complete MedVidQA dataset."""

    print("=" * 80)
    print("  COMPLETE MedVidQA DATASET VIDEO VERIFICATION")
    print("=" * 80)

    # Load all data
    all_data = load_all_medvidqa_data()

    # Get unique videos
    unique_videos = get_unique_videos(all_data)
    print(f"\nUnique videos to verify: {len(unique_videos)}")

    # Sort by question count (videos with more questions first)
    unique_videos.sort(key=lambda x: x["question_count"], reverse=True)

    print("\nStarting video verification...")
    print("-" * 80)

    available = []
    unavailable = []
    batch_size = 50  # Process in batches to avoid rate limiting

    for i, video_data in enumerate(unique_videos):
        vid_id = video_data["video_id"]
        question_count = video_data["question_count"]
        first_question = video_data["question"][:60]

        # Add delay every batch to be respectful to YouTube
        if i > 0 and i % batch_size == 0:
            print(f"\nProcessed {i} videos. Taking a 5-second break...")
            time.sleep(5)

        # Verify video availability
        is_available = verify_video_availability(vid_id)

        if is_available:
            available.append(video_data)
            status = "[OK]"
        else:
            unavailable.append(video_data)
            status = "[FAIL]"

        print(f"{i+1:3d}. [{status}] {vid_id} ({question_count:2d}Q): {first_question}...")

        # Small delay between requests
        time.sleep(0.5)

    print()
    print("=" * 80)
    print("VERIFICATION COMPLETE!")
    print(f"Available: {len(available)} videos")
    print(f"Unavailable: {len(unavailable)} videos")
    print(f"Success rate: {len(available)/len(unique_videos)*100:.1f}%")
    print("=" * 80)

    # Calculate total questions for available videos
    total_questions = sum(video["question_count"] for video in available)
    print(f"\nTotal question-answer pairs from available videos: {total_questions}")

    if available:
        print("\nTOP 10 AVAILABLE VIDEOS (by question count):")
        print("-" * 80)
        for i, video in enumerate(available[:10]):
            print(f"{i+1}. Video ID: {video['video_id']} ({video['question_count']} questions)")
            print(f"   First question: {video['question']}")
            print(f"   URL: https://www.youtube.com/watch?v={video['video_id']}")
            print()

        # Create detailed verified dataset
        verified_dataset = []
        for video in available:
            # Add all questions for this video to the verified dataset
            for question_data in video["all_questions"]:
                entry = {
                    "sample_id": question_data["sample_id"],
                    "question": question_data["question"],
                    "answer_start": question_data["answer_start"],
                    "answer_end": question_data["answer_end"],
                    "answer_start_second": question_data["answer_start_second"],
                    "answer_end_second": question_data["answer_end_second"],
                    "video_length": video["video_length"],
                    "video_id": video["video_id"],
                    "video_url": video["video_url"],
                }
                verified_dataset.append(entry)

        # Save the complete verified dataset
        output_file = "data/verified_medvidqa_videos_complete.json"
        with open(output_file, "w") as f:
            json.dump(verified_dataset, f, indent=2)

        print(
            f"Saved {len(verified_dataset)} verified question-answer pairs from {len(available)} videos"
        )
        print(f"   Output file: {output_file}")

        # Also save just the unique video info
        unique_output_file = "data/verified_medvidqa_videos_unique.json"
        with open(unique_output_file, "w") as f:
            json.dump(available, f, indent=2)
        print(f"Saved {len(available)} unique verified videos to {unique_output_file}")

        # Statistics by dataset split
        print("\nSTATISTICS BY ORIGINAL DATASET SPLIT:")
        train_questions = [
            q for v in available for q in v["all_questions"] if q["sample_id"] <= 2710
        ]
        test_questions = [
            q for v in available for q in v["all_questions"] if 2711 <= q["sample_id"] <= 2865
        ]
        val_questions = [q for v in available for q in v["all_questions"] if q["sample_id"] >= 3019]

        print(f"  Train set: {len(train_questions)} questions")
        print(f"  Test set: {len(test_questions)} questions")
        print(f"  Validation set: {len(val_questions)} questions")


if __name__ == "__main__":
    verify_all_medvidqa_videos()
