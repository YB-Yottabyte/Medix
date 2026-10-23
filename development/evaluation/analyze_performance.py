"""Summarize request traces into CSV and JSON without double-counting nested work.

python -m development.evaluation.analyze_performance --logs data/performance/*.jsonl --output data/performance/summary
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


def stats(values):
    return (
        {
            "count": len(values),
            "mean_ms": float(np.mean(values)),
            "p50_ms": float(np.percentile(values, 50)),
            "p95_ms": float(np.percentile(values, 95)),
            "max_ms": float(max(values)),
        }
        if values
        else {"count": 0}
    )


def summarize(records):
    stages, totals, statuses = defaultdict(list), defaultdict(list), Counter()
    requests = defaultdict(list)
    for r in records:
        requests[r["request_id"]].append(r)
        layer = r["layer"]
        route = r.get("route", "unknown")
        statuses[(layer, r["status"])] += 1
        totals[(layer, route, r["status"])].append(r["total_ms"])
        for key in ("first_answer_ms", "first_response_byte_ms"):
            if r.get(key) is not None:
                totals[(layer + "." + key, route, r["status"])].append(r[key])
        # Aggregate repeated attempts per request, then compute across requests.
        per_request = defaultdict(float)
        for span in r.get("spans", []):
            for metric in ("duration_ms", "exclusive_ms"):
                per_request[(layer, route, span["name"], span["status"], metric)] += span.get(
                    metric, span["duration_ms"]
                )
        for key, value in per_request.items():
            stages[key].append(value)
    return {
        "method": "Wall clock uses monotonic timers. Stage durations are inclusive; exclusive time subtracts the union of direct-child spans. Stages repeat/overlap and MUST NOT be summed into pipeline total. Backend is nested inside frontend round-trip. No missing stage is treated as zero.",
        "trace_count": len(records),
        "request_count": len(requests),
        "cross_layer_request_count": sum(
            len({r["layer"] for r in group}) > 1 for group in requests.values()
        ),
        "totals": [
            {"layer": layer, "route": route, "status": status, **stats(v)}
            for (layer, route, status), v in sorted(totals.items())
        ],
        "requests": [
            {
                "request_id": r["request_id"],
                "layer": r["layer"],
                "route": r.get("route", "unknown"),
                "started_at": r.get("started_at"),
                "status": r["status"],
                "total_ms": r["total_ms"],
                "first_answer_ms": r.get("first_answer_ms"),
                "first_response_byte_ms": r.get("first_response_byte_ms"),
                "counters": json.dumps(r.get("counters", {}), sort_keys=True),
            }
            for r in records
        ],
        "components": [
            {
                "layer": layer,
                "route": route,
                "stage": stage,
                "status": status,
                "metric": metric,
                **stats(v),
            }
            for (layer, route, stage, status, metric), v in sorted(stages.items())
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--logs", nargs="+", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/performance/summary"))
    args = parser.parse_args()
    records, bad = [], 0
    for file in args.logs:
        for line in file.read_text().splitlines():
            try:
                r = json.loads(line)
                if (
                    isinstance(r, dict)
                    and r.get("schema_version") == 1
                    and isinstance(r.get("spans"), list)
                    and all(k in r for k in ("request_id", "layer", "status", "total_ms"))
                ):
                    records.append(r)
            except (ValueError, TypeError):
                bad += 1
    report = summarize(records)
    report["malformed_lines_skipped"] = bad
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    for name in ("totals", "components", "requests"):
        rows = report[name]
        target = args.output.parent / (args.output.name + "-" + name + ".csv")
        with target.open("w", newline="") as out:
            fields = list(rows[0]) if rows else ["layer", "count"]
            writer = csv.DictWriter(out, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "trace_count",
                    "request_count",
                    "cross_layer_request_count",
                    "malformed_lines_skipped",
                )
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
