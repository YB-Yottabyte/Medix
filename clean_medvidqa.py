"""
MedVidQA Dataset Cleaner
========================
Cleans train.json, val.json, test.json from the MedVidQA dataset
and produces verified, research-quality output files.

Run from project root:
    python clean_medvidqa.py

Output:
    data/MedVidQA/cleaned/train.json
    data/MedVidQA/cleaned/val.json
    data/MedVidQA/cleaned/test.json
    data/MedVidQA/cleaned/cleaning_report.json
"""

import json
import re
from pathlib import Path
from collections import defaultdict


# ── Configuration ─────────────────────────────────────────────────────────────
DATA_DIR  = Path(__file__).parent / "MedVidQA"
OUT_DIR   = DATA_DIR / "cleaned"
SPLITS    = ["train", "val", "test"]

# Cleaning thresholds — justified by paper's Table 4:
#   Minimum visual answer length in dataset = 3s (train), 10s (val), 4s (test)
#   Mean visual answer length = 62.23s
#   We use 10s minimum to filter clearly broken entries
MIN_ANSWER_DURATION   = 10    # seconds — filters 4-second broken segments
MAX_ANSWER_DURATION   = 600   # seconds — 10 min max (paper removed >20min videos)
MIN_QUESTION_LENGTH   = 5     # words — paper reports min=5 tokens
MAX_QUESTION_LENGTH   = 30    # words — paper reports max=25 tokens (slight buffer)
MIN_SIMILARITY_SCORE  = 0.0   # not applicable at cleaning stage

# YouTube video ID pattern
YT_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{11}$')


# ── Helpers ────────────────────────────────────────────────────────────────────

def load_json(path: Path) -> list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(data: list, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def word_count(text: str) -> int:
    return len(text.strip().split())


def is_valid_youtube_id(video_id: str) -> bool:
    if not video_id or not isinstance(video_id, str):
        return False
    return bool(YT_ID_PATTERN.match(video_id.strip()))


# ── Cleaning Rules ─────────────────────────────────────────────────────────────

def clean_entry(entry: dict, idx: int, split: str) -> tuple[dict | None, list[str]]:
    """
    Clean a single MedVidQA entry.
    Returns (cleaned_entry, list_of_issues).
    Returns (None, issues) if entry should be dropped.
    """
    issues = []

    # ── 1. Required fields ──────────────────────────────────────────────────
    required = ["video_id", "question", "answer_start_second", "answer_end_second"]
    missing  = [f for f in required if f not in entry or entry[f] is None]
    if missing:
        issues.append(f"DROPPED — missing fields: {missing}")
        return None, issues

    # ── 2. Make a clean copy ────────────────────────────────────────────────
    e = entry.copy()

    # ── 3. Video ID validation ──────────────────────────────────────────────
    video_id = str(e["video_id"]).strip()
    if not is_valid_youtube_id(video_id):
        issues.append(f"DROPPED — invalid YouTube ID: '{video_id}'")
        return None, issues
    e["video_id"] = video_id

    # ── 4. Timestamp validation ─────────────────────────────────────────────
    try:
        start = float(e.get("answer_start_second") or e.get("answer_start", 0))
        end   = float(e.get("answer_end_second")   or e.get("answer_end",   0))
    except (ValueError, TypeError):
        issues.append("DROPPED — non-numeric timestamps")
        return None, issues

    e["answer_start"] = start
    e["answer_end"]   = end

    if start < 0:
        issues.append("FIXED — negative start timestamp → clamped to 0")
        start = 0.0

    if end <= start:
        issues.append(f"DROPPED — end ({end}) <= start ({start})")
        return None, issues

    duration = end - start

    if duration < MIN_ANSWER_DURATION:
        issues.append(f"DROPPED — segment too short: {duration:.1f}s < {MIN_ANSWER_DURATION}s")
        return None, issues

    if duration > MAX_ANSWER_DURATION:
        issues.append(f"DROPPED — segment too long: {duration:.1f}s > {MAX_ANSWER_DURATION}s")
        return None, issues

    e["answer_start"] = round(start, 2)
    e["answer_end"]   = round(end,   2)
    e["answer_duration"] = round(duration, 2)   # add computed field

    # ── 5. Question validation ──────────────────────────────────────────────
    question = str(e["question"]).strip()
    if not question:
        issues.append("DROPPED — empty question")
        return None, issues

    wc = word_count(question)
    if wc < MIN_QUESTION_LENGTH:
        issues.append(f"DROPPED — question too short: {wc} words")
        return None, issues

    if wc > MAX_QUESTION_LENGTH:
        issues.append(f"FIXED — question truncated from {wc} words (kept as-is, flagged)")

    # Normalize whitespace
    question = re.sub(r'\s+', ' ', question)
    e["question"] = question

    # ── 6. video_url normalization ──────────────────────────────────────────
    e["video_url"] = f"https://www.youtube.com/watch?v={video_id}"

    # ── 7. Optional field cleaning ──────────────────────────────────────────
    # video_length: must be >= answer_end
    if "video_length" in e and e["video_length"] is not None:
        try:
            vl = float(e["video_length"])
            if vl < end:
                issues.append(f"FIXED — video_length ({vl}) < answer_end ({end}) → set to answer_end")
                e["video_length"] = end
            else:
                e["video_length"] = round(vl, 2)
        except (ValueError, TypeError):
            issues.append("FIXED — invalid video_length → removed")
            del e["video_length"]

    # sample_id: ensure it's a string
    if "sample_id" in e:
        e["sample_id"] = str(e["sample_id"])

    return e, issues


# ── Duplicate Detection ────────────────────────────────────────────────────────

def remove_duplicates(entries: list[dict]) -> tuple[list[dict], int]:
    """
    Remove duplicate entries based on (video_id, answer_start, answer_end).
    Keeps the first occurrence.
    """
    seen    = set()
    unique  = []
    dropped = 0

    for e in entries:
        key = (e["video_id"], e["answer_start"], e["answer_end"])
        if key in seen:
            dropped += 1
            continue
        seen.add(key)
        unique.append(e)

    return unique, dropped


# ── Per-split cleaning ─────────────────────────────────────────────────────────

def clean_split(split: str) -> dict:
    src_path = DATA_DIR / f"{split}.json"
    dst_path = OUT_DIR  / f"{split}.json"

    if not src_path.exists():
        print(f"  ⚠️  {split}.json not found — skipping")
        return {"split": split, "status": "missing"}

    raw = load_json(src_path)
    print(f"\n{'─'*60}")
    print(f"  Cleaning {split}.json  ({len(raw)} entries)")
    print(f"{'─'*60}")

    cleaned      = []
    drop_reasons = defaultdict(int)
    fix_log      = []
    total_drops  = 0

    for i, entry in enumerate(raw):
        result, issues = clean_entry(entry, i, split)

        if result is None:
            total_drops += 1
            reason = issues[0].replace("DROPPED — ", "") if issues else "unknown"
            drop_reasons[reason] += 1
        else:
            cleaned.append(result)
            for issue in issues:
                if "FIXED" in issue:
                    fix_log.append({"index": i, "fix": issue})

    # Deduplicate
    cleaned, dup_count = remove_duplicates(cleaned)
    if dup_count:
        drop_reasons["duplicate entry"] += dup_count
        total_drops += dup_count

    # Save
    save_json(cleaned, dst_path)

    # Report
    report = {
        "split":          split,
        "original_count": len(raw),
        "cleaned_count":  len(cleaned),
        "dropped_count":  total_drops,
        "drop_rate":      f"{total_drops / max(len(raw),1) * 100:.1f}%",
        "drop_reasons":   dict(drop_reasons),
        "fixes_applied":  len(fix_log),
        "duration_stats": compute_duration_stats(cleaned),
    }

    print(f"  Original : {len(raw)}")
    print(f"  Cleaned  : {len(cleaned)}")
    print(f"  Dropped  : {total_drops} ({report['drop_rate']})")
    if drop_reasons:
        for reason, count in sorted(drop_reasons.items(), key=lambda x: -x[1]):
            print(f"    • {reason}: {count}")
    if fix_log:
        print(f"  Fixes    : {len(fix_log)}")

    return report


# ── Duration Statistics ────────────────────────────────────────────────────────

def compute_duration_stats(entries: list[dict]) -> dict:
    if not entries:
        return {}
    durations = [e["answer_duration"] for e in entries if "answer_duration" in e]
    if not durations:
        return {}
    return {
        "min_seconds":  round(min(durations),  1),
        "max_seconds":  round(max(durations),  1),
        "mean_seconds": round(sum(durations) / len(durations), 1),
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "="*60)
    print("  MedVidQA Dataset Cleaner")
    print("="*60)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    all_reports = []
    total_original = 0
    total_cleaned  = 0

    for split in SPLITS:
        report = clean_split(split)
        all_reports.append(report)
        total_original += report.get("original_count", 0)
        total_cleaned  += report.get("cleaned_count",  0)

    # Save cleaning report
    summary = {
        "cleaning_thresholds": {
            "min_answer_duration_seconds": MIN_ANSWER_DURATION,
            "max_answer_duration_seconds": MAX_ANSWER_DURATION,
            "min_question_words":          MIN_QUESTION_LENGTH,
            "max_question_words":          MAX_QUESTION_LENGTH,
        },
        "total_original": total_original,
        "total_cleaned":  total_cleaned,
        "total_dropped":  total_original - total_cleaned,
        "overall_drop_rate": f"{(total_original - total_cleaned) / max(total_original,1) * 100:.1f}%",
        "splits": all_reports,
    }

    report_path = OUT_DIR / "cleaning_report.json"
    save_json(summary, report_path)

    print(f"\n{'='*60}")
    print(f"  TOTAL: {total_original} → {total_cleaned} entries")
    print(f"  Dropped: {total_original - total_cleaned} ({summary['overall_drop_rate']})")
    print(f"\n  Output: {OUT_DIR}/")
    print(f"  Report: {report_path}")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()