"""Reproducible dataset intent audit. Prompt examples must come from train only.
Gold intervals remain evaluation metadata; no answers or labels are sent to runtime prompts.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


def intent(q):
    if re.search(r"\bwhy\b|\b(?:reason|purpose)\b", q, re.I):
        return "rationale"
    if re.search(r"\bwhat (?:to|should .{0,20}) do (?:if|when)\b", q, re.I):
        return "contingency"
    if re.search(
        r"\b(?:when|identify when)\b.{0,80}\b(?:help|doctor|attention|emergency|call)\b", q, re.I
    ):
        return "escalation"
    if re.search(r"\bhow (?:long|many|much|often)\b", q, re.I):
        return "quantity"
    if re.search(
        r"\b(?:symptoms?|signs?)\b|\bhow (?:to )?(?:check|identify|recognize|tell)\b", q, re.I
    ):
        return "recognition"
    return "procedure"


def audit(root):
    splits = {
        s: json.loads((root / "MedVidQA" / f"{s}.json").read_text())
        for s in ("train", "val", "test")
    }
    report = {
        "total_questions": sum(map(len, splits.values())),
        "splits": {},
        "method": "Descriptive rule-based question audit, not expert labels. Runtime examples use train only. Original dataset has temporal answer intervals, not prose medical answers.",
        "why_policy": "Derived why variants are labeled separately and require explicit rationale support; neither original timestamps nor derived rationales enter retrieval as gold answers.",
    }
    for split, rows in splits.items():
        report["splits"][split] = {
            "count": len(rows),
            "intent_counts": dict(Counter(intent(x["question"]) for x in rows)),
            "explicit_why_count": sum(
                bool(re.search(r"\bwhy\b", x["question"], re.I)) for x in rows
            ),
            "how_word_count": sum(bool(re.search(r"\bhow\b", x["question"], re.I)) for x in rows),
        }
    train = {str(x["sample_id"]): x for x in splits["train"]}
    report["runtime_examples"] = json.loads(
        (root / "frontend/lib/ai/dataset-question-examples.json").read_text()
    )
    report["derived_why_cases"] = [
        {
            "source_split": "train",
            "source_sample_id": sid,
            "original_question": train[sid]["question"],
            "question": q,
            "derived": True,
            "expected": "Explain only an explicitly supported reason; an action-only passage is insufficient. Do not invent causal links.",
        }
        for sid, q in [
            ("115", "Why is pressure used when bandaging a wound?"),
            ("636", "Why is running water used to cool a burn?"),
            ("839", "Why check circulation after applying a sling?"),
        ]
    ]
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    p.add_argument(
        "--output", type=Path, default=Path("development/docs/dataset-question-review.json")
    )
    a = p.parse_args()
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(audit(a.root), indent=2) + "\n")
    print(a.output)


if __name__ == "__main__":
    main()
