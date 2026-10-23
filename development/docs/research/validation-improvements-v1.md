# MedVidQA validation experiments — 2026-10-08

## Decision

Keep the production configuration unchanged. Lexical title fusion improves validation retrieval ranking, but this experiment does not establish a temporal-localization improvement over the supplied end-to-end baseline. No final test configuration is selected. The official test split was not evaluated.

## Data and protocol

Work was performed in `/Users/sairithwikk/Documents/Medix`. No connection to Sol or job submission was made. The local snapshot `development/evaluation/results/week1/2026-10-04-final-resource-snapshot-v1/transcript_cache` contains 840 JSON transcripts (7,252,711 bytes); 838 match the 852-video catalog. These are actual timestamped text cues. The subsequently supplied Week 1 report confirms that transcripts were copied back to the Mac while media stayed on Sol. The local manifest SHA-256 exactly matches the supplied frozen manifest: `7e770b751eb7866f7fff9ccddeaa0c99ba2939d06b0fb0bec3fc1a15b1c1083a`. This establishes matching manifest provenance; current Sol file contents have not been checked. Videos were neither needed nor used by this benchmark. The supplied shared ChatGPT conversation could not be fetched.

The runner uses all 145 validation questions, a pinned offline MiniLM model, 37,693 label-free 30/60/90-second windows, and cached embeddings. It compares 4 retrieval methods × 5 localization methods × 3 video-selection weights. Validation answer intervals are used only for scoring/selection, never candidate construction or embedding text. Video selection combines the original title score with localization confidence; fused retrieval changes the shortlist, not the title component of that selection formula.

This is a text-only video-and-time benchmark: no video extraction, generation, or media-availability gate. Consequently, the local matched baseline is distinct from the supplied end-to-end baseline. Title-only and transcript-RRF retrieval metrics reproduce the supplied retrieval results exactly, but oracle MiniLM90 localization is 0.2408 rather than the supplied 0.250. The timing/grid/cache/protocol discrepancy must be reconciled before claiming an end-to-end gain.

Runtime: 133.9 seconds on local MPS including one-time window encoding. No paid APIs, downloads, model training, or Sol resources were used. This is batch experiment runtime, not online query latency.

## Measured retrieval

| Method | Recall@1 | Recall@5 | MRR@5 |
|---|---:|---:|---:|
| Title/author baseline | 29.7% | 64.1% | 0.429 |
| Equal title/transcript RRF | 32.4% | 62.1% | 0.445 |
| Title-weighted RRF (75%) | 31.0% | 64.1% | 0.438 |
| Title score + TF-IDF (80/20) | **35.2%** | 64.1% | **0.467** |

Lexical fusion adds eight correct rank-one videos (43→51), but does not improve recall ceiling. These remain validation observations without independent confirmation.

## Temporal results

| Configuration | Recall@5 | Video selected | Mean IoU | IoU ≥ .5 |
|---|---:|---:|---:|---:|
| Supplied end-to-end baseline (different protocol) | 64.1% | 33.8% | .122 | 10.3% |
| Local matched title + fixed90 | 64.1% | 31.0% | .0906 | 5.5% (8) |
| Title + fixed60 | 64.1% | 33.1% | .0939 | 9.7% (14) |
| Equal RRF + fixed60 | 62.1% | 30.3% | .1058 | 11.0% (16) |
| Equal RRF + adaptive lexical | 62.1% | 32.4% | .1080 | 9.0% (13) |
| Equal RRF + refined boundaries | 62.1% | 32.4% | .1089 | 8.3% (12) |
| Lexical title + fixed60 | 64.1% | 35.9% | .0905 | 9.0% (13) |

All rows here use localization-only video confidence (weight zero). All 60 results and per-question predictions are preserved in `development/evaluation/results/validation-improvements-v1/`.

Selecting by success at IoU .5, then mean IoU, chooses equal RRF + fixed60 on the full validation set. Against the matched local baseline it gains nine successes and loses one. The paired video-cluster bootstrap mean-IoU delta is .0152 (95% interval −.0126 to .0504). The success-rate delta is 5.5 percentage points (interval 1.2 to 12.1). These intervals are exploratory after selection among 60 configurations, not confirmatory evidence.

Five-fold selection grouped by video yields held-out mean IoU .0901 and success 7.6%, with different configurations selected across folds. The apparent full-validation gain is unstable. Do not promote the winning sweep configuration or spend the test split on it yet.

## Bottlenecks and failures

- Retrieval misses 52/145 target videos even with the best Recall@5 here. Equal RRF improves rank one but loses three top-five hits. Lexical title fusion improves ranking without expanding target coverage.
- Four validation questions lack usable target transcripts. All 141 available targets have cues overlapping the annotated interval; overlap alone cannot establish correct audio/video synchronization or semantic alignment. Media inspection on Sol remains necessary for alignment verification.
- Candidate generation has substantial headroom: an oracle choosing the best candidate from the multiscale bank reaches .6829 mean IoU and 124/145 successes. This diagnostic uses ground truth and is not an achievable system result. Window scoring/selection is a larger bottleneck than simply adding more scales.
- Oracle-video fixed90 achieves .2408 mean IoU / 25 successes; fixed60 .2025 / 26; adaptive dense .1996 / 20; adaptive lexical .2019 / 19; refined .2029 / 18. Uncalibrated selection across lengths favors semantically strong text that may not match the target moment. Nearest-cue snapping does not infer action boundaries and reduces success rate. Both ideas were implemented and tested, but are not supported as production improvements.
- CCAL code chooses the span before evaluating its cycle score, so that score cannot improve boundary ranking. Training reconstructs gold answer text independently of the predicted span and excludes negative overflow chunks; inference compares raw span logits across chunks. These are concrete objective/inference mismatches, not proof of the sole cause of the reported .0149. No new CCAL architecture or training was introduced.
- The joint reranker evaluator used a video ID as oracle title when the target was absent from retrieved candidates, and used inconsistent duration sources. It now uses catalog title/duration for every candidate; a regression test covers this case. Its previous oracle result needs rerunning before interpreting model quality. Training/inference negative-distribution mismatch and max-over-windows bias remain hypotheses. No checkpoint rerun was performed and no recovered accuracy is claimed.

## Implementation and checks

- `backend/temporal_localization/adaptive.py`: multiscale windows, conservative cue-boundary refinement, comparable confidence scores.
- `development/evaluation/run_validation_improvements.py`: offline validation-only ablations, input hashes, reusable embedding cache, paired uncertainty, grouped selection, alignment diagnostics, all predictions.
- `development/evaluation/run_joint_moment_reranker_validation.py`: consistent catalog metadata for oracle and retrieved candidates.
- `development/tests/test_adaptive_localization.py`, `development/tests/test_joint_reranker_metadata.py`: regression coverage.
- `development/ops/medvidqa_validation_improvements.sbatch`: manual job template only; verify environment and transcript path against Sol before use.

129 Python tests passed. Scoped Ruff checks and job-script shell syntax passed. Production retrieval/localization defaults were not changed.

## Reproduce and next decision

Local reproduction, using a new output directory:

```bash
cd /Users/sairithwikk/Documents/Medix
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 uv run --no-sync python -m development.evaluation.run_validation_improvements \
  --device mps \
  --output-dir development/evaluation/results/validation-improvements-v2
```

For Sol, copy the implementation first and run the same module manually with `--device cpu` or `--device cuda` and `--transcript-cache` pointing to the verified cache. The exact pinned model revision must already be available because downloads are disabled. The supplied sbatch file assumes the existing `medix` environment and snapshot path; these are not remotely verified. No job has been submitted.

Next prioritize reproducing the original fixed90 temporal baseline with identical transcript hashes/grid/scoring and rerunning the corrected joint evaluator. Audit a small set of failed validation intervals against Sol media for timing drift, cue gaps, and visual-only answers. Then test length-calibrated selection and cue relevance boundaries in a small preregistered validation comparison. Keep the observed lexical retrieval gain as a candidate, not a claimed end-to-end improvement. Select and freeze a configuration only after this reconciliation; evaluate the official test set once afterward.

## Sol cost constraint

The user requires free ASU resources only and manual submission. ASU documents compute as free for faculty, students, and collaborators, with recent usage affecting queue priority through fairshare: https://docs.rc.asu.edu/fairshare/. Check `myaccounts` and `myfairshare` before preparing account-specific submission commands. Do not purchase storage, use paid APIs, or submit jobs automatically. Prefer one bounded CPU validation job and reuse cached transcripts/model embeddings; do not repeat ASR. The supplied snapshot distinguishes 167 source captions from 673 ASR transcripts; source-stratified error analysis remains outstanding.
