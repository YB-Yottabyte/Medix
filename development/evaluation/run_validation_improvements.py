"""Offline validation-only retrieval/localization ablations with a cached MiniLM bank.

No test-split option, remote inference, downloads, media acquisition, or training.
Candidate construction consumes public catalog/transcripts, never answer annotations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import time
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from backend.temporal_localization.adaptive import (
    build_adaptive_windows,
    refine_to_cues,
    select_window,
)
from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from backend.video_retrieval.catalog import load_video_documents
from development.evaluation.medvidqa_dataset import load_official_split
from development.evaluation.metrics import interval_iou

ROOT = Path(__file__).resolve().parents[2]
MODEL = "sentence-transformers/all-MiniLM-L6-v2"
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
LOGGER = logging.getLogger(__name__)
MODES = ("fixed90", "fixed60", "adaptive", "adaptive_lexical", "refined")
RETRIEVALS = ("title", "rrf_equal", "rrf_title75", "title_lexical")
WEIGHTS = (0.0, 0.5, 1.0)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metrics(rows):
    return {
        "samples": len(rows),
        "recall_at_5": float(np.mean([r["target_in_top5"] for r in rows])),
        "selected_video_accuracy": float(np.mean([r["correct_video"] for r in rows])),
        "mean_iou": float(np.mean([r["iou"] for r in rows])),
        **{f"iou_at_{t}": float(np.mean([r["iou"] >= t for r in rows])) for t in (0.3, 0.5, 0.7)},
    }


def paired_interval(base, improved, samples, repetitions=2000):
    groups = defaultdict(list)
    for index, sample in enumerate(samples):
        groups[sample.video_id].append(index)
    keys = sorted(groups)
    rng = np.random.default_rng(572)
    delta = np.asarray([r["iou"] for r in improved]) - np.asarray([r["iou"] for r in base])
    success = np.asarray([r["iou"] >= 0.5 for r in improved], dtype=float) - np.asarray(
        [r["iou"] >= 0.5 for r in base], dtype=float
    )
    draws = []
    for _ in range(repetitions):
        positions = [i for key in rng.choice(keys, len(keys)) for i in groups[key]]
        draws.append((float(delta[positions].mean()), float(success[positions].mean())))
    return {
        "method": "paired video-cluster bootstrap; exploratory after configuration selection",
        "mean_iou_delta": float(delta.mean()),
        "success_delta": float(success.mean()),
        "ci95": np.quantile(draws, [0.025, 0.975], axis=0).T.tolist(),
        "gained_successes": int((success > 0).sum()),
        "lost_successes": int((success < 0).sum()),
    }


def weighted_rrf(title, transcript, weight):
    n = len(title)
    tr = np.empty(n)
    tr[np.argsort(-title, kind="stable")] = np.arange(1, n + 1)
    rr = np.empty(n)
    rr[np.argsort(-transcript, kind="stable")] = np.arange(1, n + 1)
    return (1 - weight) / (60 + tr) + weight * np.where(np.isfinite(transcript), 1 / (60 + rr), 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--transcript-cache",
        type=Path,
        default=ROOT
        / "development/evaluation/results/week1/2026-10-04-final-resource-snapshot-v1/transcript_cache",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--embedding-cache",
        type=Path,
        default=ROOT / "development/evaluation/results/validation-improvements-cache",
    )
    parser.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cpu")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite {args.output_dir}")
    import torch
    from sentence_transformers import SentenceTransformer

    torch.set_num_threads(args.threads)
    started = time.monotonic()
    samples = load_official_split(ROOT / "MedVidQA/val.json")
    if len(samples) != 145:
        raise ValueError("Expected exactly 145 official validation questions")
    catalog_path = ROOT / "data/medvidqa_video_catalog.json"
    documents = load_video_documents(catalog_path)
    ids = [d.video_id for d in documents]
    id_index = {v: i for i, v in enumerate(ids)}
    repository = CachedTranscriptRepository(args.transcript_cache)
    windows, owners, cues_by_video, indices = [], [], {}, {}
    hashes = {}
    for vi, document in enumerate(documents):
        try:
            cues = repository.load(document.video_id)
        except TranscriptUnavailableError:
            continue
        cues_by_video[vi] = cues
        hashes[document.video_id] = sha(args.transcript_cache / f"{document.video_id}.json")
        candidates = build_adaptive_windows(cues, document.duration_seconds)
        indices[vi] = np.arange(len(windows), len(windows) + len(candidates))
        windows.extend(candidates)
        owners.extend([vi] * len(candidates))
    owners = np.asarray(owners)
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "catalog": sha(catalog_path),
                "transcripts": hashes,
                "revision": REVISION,
                "sizes": [30, 60, 90],
                "windows": [asdict(w) for w in windows],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    args.embedding_cache.mkdir(parents=True, exist_ok=True)
    cache = args.embedding_cache / f"{fingerprint}.npy"
    encoder = SentenceTransformer(
        MODEL, revision=REVISION, device=args.device, local_files_only=True
    )
    queries = encoder.encode(
        [s.question for s in samples],
        normalize_embeddings=True,
        batch_size=64,
        show_progress_bar=False,
    )
    titles = [d.searchable_text for d in documents]
    title_embeddings = encoder.encode(
        titles, normalize_embeddings=True, batch_size=64, show_progress_bar=False
    )
    texts = [w.text for w in windows]
    LOGGER.info(
        "Catalog=%d, transcript videos=%d, multi-scale windows=%d",
        len(documents),
        len(indices),
        len(windows),
    )
    if cache.exists():
        embeddings = np.load(cache, allow_pickle=False)
    else:
        embeddings = encoder.encode(
            texts, normalize_embeddings=True, batch_size=64, show_progress_bar=True
        )
        np.save(cache, embeddings)
    if embeddings.shape != (len(windows), queries.shape[1]):
        raise ValueError("Embedding cache shape mismatch")
    vectorizer = TfidfVectorizer(stop_words="english", sublinear_tf=True, dtype=np.float32)
    lexical_bank = vectorizer.fit_transform(titles + texts)
    lexical_queries = vectorizer.transform([s.question for s in samples])
    lexical_scores = (lexical_queries @ lexical_bank.T).toarray()
    dense_scores = queries @ embeddings.T
    title_scores = queries @ title_embeddings.T
    # The canonical title-author retriever's exact lexical blend.
    import re

    for qi, sample in enumerate(samples):
        tokens = set(re.findall(r"[a-z0-9]+", sample.question.lower()))
        overlap = [
            len(tokens & set(re.findall(r"[a-z0-9]+", title.lower()))) / max(1, len(tokens))
            for title in titles
        ]
        title_scores[qi] = 0.85 * title_scores[qi] + 0.15 * np.asarray(overlap)
    ranking = {name: [] for name in RETRIEVALS}
    localization = {name: [] for name in MODES}
    oracle_rows = {name: [] for name in MODES}
    audit = []
    for qi, sample in enumerate(samples):
        pooled = np.full(len(documents), -np.inf)
        mask90 = np.asarray([w.scale == 90 for w in windows])
        np.maximum.at(pooled, owners[mask90], dense_scores[qi, mask90])
        scores = {
            "title": title_scores[qi],
            "rrf_equal": weighted_rrf(title_scores[qi], pooled, 0.5),
            "rrf_title75": weighted_rrf(title_scores[qi], pooled, 0.25),
            "title_lexical": 0.8 * title_scores[qi] + 0.2 * lexical_scores[qi, : len(documents)],
        }
        for name in RETRIEVALS:
            ranking[name].append(
                sorted(range(len(documents)), key=lambda i: (-float(scores[name][i]), ids[i]))
            )
        for mode in MODES:
            by_video = {}
            for vi, positions in indices.items():
                candidates = [windows[p] for p in positions]
                selected, score = select_window(
                    candidates,
                    dense_scores[qi, positions],
                    lexical_scores[qi, len(documents) + positions],
                    mode=mode,
                )
                win = candidates[selected]
                start, end = (
                    refine_to_cues(win, cues_by_video[vi], documents[vi].duration_seconds)
                    if mode == "refined"
                    else (win.start, win.end)
                )
                by_video[vi] = (start, end, score, win.scale)
            localization[mode].append(by_video)
            vi = id_index.get(sample.video_id)
            prediction = by_video.get(vi)
            oracle_rows[mode].append(
                {
                    "sample_id": sample.sample_id,
                    "iou": interval_iou(
                        sample.answer_start_seconds,
                        sample.answer_end_seconds,
                        prediction[0],
                        prediction[1],
                    )
                    if prediction
                    else 0,
                    "correct_video": bool(prediction),
                    "target_in_top5": True,
                }
            )
        vi = id_index.get(sample.video_id)
        positions = indices.get(vi, [])
        cues = cues_by_video.get(vi, ())
        max_iou = max(
            (
                interval_iou(
                    sample.answer_start_seconds,
                    sample.answer_end_seconds,
                    windows[p].start,
                    windows[p].end,
                )
                for p in positions
            ),
            default=0,
        )
        audit.append(
            {
                "sample_id": sample.sample_id,
                "video_id": sample.video_id,
                "transcript_available": bool(cues),
                "gold_duration": sample.answer_duration_seconds,
                "cue_overlaps_answer": any(
                    c.start_seconds < sample.answer_end_seconds
                    and c.end_seconds > sample.answer_start_seconds
                    for c in cues
                ),
                "candidate_oracle_iou": max_iou,
                "title_rank": ranking["title"][qi].index(vi) + 1 if vi is not None else None,
            }
        )
    results, rows_by_name = {}, {}
    for retrieval in RETRIEVALS:
        for mode in MODES:
            for weight in WEIGHTS:
                name = f"{retrieval}__{mode}__w{weight:g}"
                rows = []
                for qi, sample in enumerate(samples):
                    top5 = ranking[retrieval][qi][:5]
                    candidates = []
                    for rank, vi in enumerate(top5):
                        prediction = localization[mode][qi].get(vi)
                        if prediction is None:
                            continue
                        # Fixed common scores for selection: title similarity + local passage score.
                        joint = weight * float(title_scores[qi, vi]) + (1 - weight) * prediction[2]
                        candidates.append((joint, -rank, vi, prediction))
                    best = max(candidates, default=None)
                    correct = bool(best and ids[best[2]] == sample.video_id)
                    prediction = best[3] if best else None
                    rows.append(
                        {
                            "sample_id": sample.sample_id,
                            "expected_video_id": sample.video_id,
                            "predicted_video_id": ids[best[2]] if best else None,
                            "predicted_start": prediction[0] if prediction else None,
                            "predicted_end": prediction[1] if prediction else None,
                            "target_in_top5": sample.video_id in [ids[i] for i in top5],
                            "correct_video": correct,
                            "iou": interval_iou(
                                sample.answer_start_seconds,
                                sample.answer_end_seconds,
                                prediction[0],
                                prediction[1],
                            )
                            if correct
                            else 0,
                        }
                    )
                results[name] = metrics(rows)
                rows_by_name[name] = rows
    baseline = "title__fixed90__w0"

    def key(name):
        return (
            results[name]["iou_at_0.5"],
            results[name]["mean_iou"],
            results[name]["selected_video_accuracy"],
        )

    winner = max(results, key=key)
    # Nested selection across held-out validation video groups: do not split related questions.
    group_ids = sorted(
        {s.video_id for s in samples}, key=lambda s: hashlib.sha256(s.encode()).hexdigest()
    )
    folds = {v: i % 5 for i, v in enumerate(group_ids)}
    crossvalidated = []
    fold_choices = []
    for fold in range(5):
        train = [i for i, s in enumerate(samples) if folds[s.video_id] != fold]
        held = [i for i, s in enumerate(samples) if folds[s.video_id] == fold]

        def tune_key(name, train=train):
            report = metrics([rows_by_name[name][i] for i in train])
            return report["iou_at_0.5"], report["mean_iou"], report["selected_video_accuracy"]

        choice = max(results, key=tune_key)
        fold_choices.append({"fold": fold, "selected": choice, "held_out_questions": len(held)})
        crossvalidated.extend(rows_by_name[choice][i] for i in held)
    retrieval_report = {}
    for name in RETRIEVALS:
        ranks = [
            ranking[name][i].index(id_index[s.video_id]) + 1 if s.video_id in id_index else 10**9
            for i, s in enumerate(samples)
        ]
        retrieval_report[name] = {
            "recall_at_1": float(np.mean(np.asarray(ranks) <= 1)),
            "recall_at_5": float(np.mean(np.asarray(ranks) <= 5)),
            "mrr_at_5": float(np.mean([1 / r if r <= 5 else 0 for r in ranks])),
        }
    summary = {
        "protocol": "validation-only, text-only video-and-time predictions; no media extraction or generation",
        "test_split_read": False,
        "validation_sha256": sha(ROOT / "MedVidQA/val.json"),
        "catalog_sha256": sha(catalog_path),
        "transcript_fingerprint": fingerprint,
        "model": MODEL,
        "revision": REVISION,
        "device": args.device,
        "candidate_windows": len(windows),
        "transcript_videos": len(indices),
        "transcript_hashes": hashes,
        "runtime_seconds": time.monotonic() - started,
        "baseline": baseline,
        "selected_configuration": winner,
        "retrieval": retrieval_report,
        "oracle_video": {name: metrics(rows) for name, rows in oracle_rows.items()},
        "experiments": results,
        "paired_selected_vs_matched_baseline": paired_interval(
            rows_by_name[baseline], rows_by_name[winner], samples
        ),
        "grouped_validation_selection": {"metrics": metrics(crossvalidated), "folds": fold_choices},
        "alignment": {
            "questions_with_transcripts": sum(a["transcript_available"] for a in audit),
            "questions_with_overlapping_cues": sum(a["cue_overlaps_answer"] for a in audit),
            "candidate_oracle_mean_iou": float(np.mean([a["candidate_oracle_iou"] for a in audit])),
            "candidate_oracle_successes": sum(a["candidate_oracle_iou"] >= 0.5 for a in audit),
        },
    }
    args.output_dir.mkdir(parents=True)
    (args.output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (args.output_dir / "alignment.json").write_text(json.dumps(audit, indent=2) + "\n")
    for name, rows in rows_by_name.items():
        (args.output_dir / f"{name}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    LOGGER.info("Selected %s: %s; matched baseline: %s", winner, results[winner], results[baseline])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
