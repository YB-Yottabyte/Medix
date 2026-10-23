"""Offline CPU microbenchmark: pinned encoder, real validation queries, no test split."""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import time
from importlib.metadata import version
from pathlib import Path

import numpy as np

from backend.adapters.feature_cache import CachedTextEncoder
from development.evaluation.medvidqa_dataset import load_official_split
from development.evaluation.run_validation_improvements import MODEL, REVISION, ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=False)
    import torch
    from sentence_transformers import SentenceTransformer

    torch.set_num_threads(4)
    encoder = SentenceTransformer(MODEL, revision=REVISION, device="cpu", local_files_only=True)
    source = ROOT / "MedVidQA/val.json"
    texts = [s.question for s in load_official_split(source)]
    options = {
        "normalize_embeddings": True,
        "convert_to_numpy": True,
        "show_progress_bar": False,
        "batch_size": 64,
    }
    namespace = f"{MODEL}@{REVISION}:{version('sentence-transformers')}:{version('transformers')}:{encoder.max_seq_length}"
    encoder.encode(
        texts[:4], **options
    )  # Exclude model initialization and warmup in both conditions.
    cached = CachedTextEncoder(encoder, args.output_dir / "cache", namespace)
    started = time.perf_counter()
    cold = cached.encode(texts, **options)
    cold_time = time.perf_counter() - started
    direct_times, cache_times, differences = [], [], []
    for repeat in range(5):
        # Alternate order; rebuild wrapper so results require persistent disk reads.
        wrapper = CachedTextEncoder(encoder, args.output_dir / "cache", namespace)
        results = {}
        for name in ("direct", "cache") if repeat % 2 == 0 else ("cache", "direct"):
            started = time.perf_counter()
            result = (encoder if name == "direct" else wrapper).encode(texts, **options)
            elapsed = time.perf_counter() - started
            (direct_times if name == "direct" else cache_times).append(elapsed)
            results[name] = result
        differences.append(float(np.max(np.abs(results["direct"] - results["cache"]))))
        np.testing.assert_allclose(results["direct"], results["cache"], atol=1e-6, rtol=1e-5)
    summary = {
        "scope": "145 validation query embeddings only; excludes model load, retrieval, decoding, CLIP, evidence extraction and generation",
        "device": "cpu",
        "threads": 4,
        "model": MODEL,
        "revision": REVISION,
        "validation_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "namespace": namespace,
        "cold_cache_seconds": cold_time,
        "uncached_seconds": direct_times,
        "warm_disk_cache_seconds": cache_times,
        "median_speedup": statistics.median(direct_times) / statistics.median(cache_times),
        "max_absolute_difference": max(differences),
        "vectors": len(cold),
    }
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
