#!/usr/bin/env python3
"""
Update Medical QA System to use Complete Verified Dataset
This script updates your system to use all verified videos instead of just the original 28
"""

import json
import os
import shutil
from datetime import datetime


def backup_current_data():
    """Create a backup of current data files."""
    backup_dir = f"data/backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    os.makedirs(backup_dir, exist_ok=True)

    # Backup current verified videos file
    if os.path.exists("data/verified_medvidqa_videos.json"):
        shutil.copy(
            "data/verified_medvidqa_videos.json", f"{backup_dir}/verified_medvidqa_videos_old.json"
        )
        print(f"Backed up original verified videos to {backup_dir}")

    # Backup embeddings if they exist
    if os.path.exists("data/cache_medvidqa_verified/embeddings.npy"):
        os.makedirs(f"{backup_dir}/cache_medvidqa_verified", exist_ok=True)
        shutil.copy(
            "data/cache_medvidqa_verified/embeddings.npy",
            f"{backup_dir}/cache_medvidqa_verified/embeddings.npy",
        )
        print(f"Backed up old embeddings to {backup_dir}")


def update_system_with_complete_dataset():
    """Update the system to use the complete verified dataset."""

    print("=" * 60)
    print("  UPDATING MEDICAL QA SYSTEM")
    print("=" * 60)

    complete_file = "data/verified_medvidqa_videos_complete.json"
    if not os.path.exists(complete_file):
        print(f"Complete verified dataset not found: {complete_file}")
        print("Please run 'python scripts/verify_all_videos.py' first!")
        return

    # Load the complete verified dataset
    with open(complete_file) as f:
        complete_data = json.load(f)

    print(f"Found complete verified dataset with {len(complete_data)} question-answer pairs")

    # Count unique videos
    unique_videos = len({item["video_id"] for item in complete_data})
    print(f"From {unique_videos} unique verified videos")

    # Create backup
    backup_current_data()

    # Update the main verified videos file
    with open("data/verified_medvidqa_videos.json", "w") as f:
        json.dump(complete_data, f, indent=2)

    print(f"Updated verified_medvidqa_videos.json with {len(complete_data)} entries")

    # Remove old embeddings cache (will be regenerated with new data)
    embeddings_dir = "data/cache_medvidqa_verified"
    if os.path.exists(embeddings_dir):
        shutil.rmtree(embeddings_dir)
        print("Removed old embeddings cache (will be regenerated)")

    # Update any configuration that might specify the number of videos
    config_updates = []

    # Check if config.yaml exists and update it
    if os.path.exists("config.yaml"):
        try:
            import yaml

            with open("config.yaml") as f:
                config = yaml.safe_load(f)

            # Update any relevant configuration
            if "database" in config:
                config["database"]["total_videos"] = unique_videos
                config["database"]["total_qa_pairs"] = len(complete_data)

            with open("config.yaml", "w") as f:
                yaml.dump(config, f, indent=2)
            config_updates.append("config.yaml")
        except ImportError:
            print("yaml library not available, skipping config.yaml update")
        except Exception as e:
            print(f"Could not update config.yaml: {e}")

    print("\n" + "=" * 60)
    print("  SYSTEM UPDATE COMPLETE!")
    print("=" * 60)
    print("BEFORE: 28 videos with 28 question-answer pairs")
    print(f"AFTER:  {unique_videos} videos with {len(complete_data)} question-answer pairs")
    print(
        f"IMPROVEMENT: {unique_videos/28:.1f}x more videos, {len(complete_data)/28:.1f}x more Q&A pairs"
    )

    print("\nNEXT STEPS:")
    print("1. Run your system - embeddings will be automatically regenerated")
    print("2. The database will now include all verified medical videos")
    print("3. Users can now ask questions about a much broader range of medical topics")

    if config_updates:
        print(f"4. Updated configuration files: {', '.join(config_updates)}")

    print("\nNOTE: First run may take longer as embeddings are rebuilt")


def show_comparison():
    """Show a comparison between old and new datasets."""

    # Check current status
    main_file = "data/verified_medvidqa_videos.json"
    complete_file = "data/verified_medvidqa_videos_complete.json"

    print("=" * 60)
    print("  DATASET COMPARISON")
    print("=" * 60)

    if os.path.exists(main_file):
        with open(main_file) as f:
            current_data = json.load(f)
        current_videos = len({item["video_id"] for item in current_data})
        print(f"Current system: {len(current_data)} Q&A pairs from {current_videos} videos")
    else:
        print("Current system: No verified videos file found")

    if os.path.exists(complete_file):
        with open(complete_file) as f:
            complete_data = json.load(f)
        complete_videos = len({item["video_id"] for item in complete_data})
        print(f"Available: {len(complete_data)} Q&A pairs from {complete_videos} videos")

        if os.path.exists(main_file):
            improvement_qa = len(complete_data) / len(current_data)
            improvement_videos = complete_videos / current_videos
            print(
                f"Potential improvement: {improvement_videos:.1f}x videos, {improvement_qa:.1f}x Q&A pairs"
            )
    else:
        print("Complete verification not yet available")
        print("Run: python scripts/verify_all_videos.py")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "compare":
        show_comparison()
    else:
        update_system_with_complete_dataset()
