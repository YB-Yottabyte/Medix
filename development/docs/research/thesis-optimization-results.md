# Medix thesis optimization results

Baseline preserved; all new runtime optimizations are opt-in. No Sol jobs, APIs, downloads, or test-split experiments were run for this change.

## Measured outcomes

| Experiment | Result | Interpretation |
|---|---|---|
| Query encoder cache (145 real validation queries, CPU, 5 alternating repeats) | 14.07× median speedup; maximum vector difference 0.0 | Component measurement only, not end-to-end speedup |
| Existing Sol full baseline, user-supplied job 65027646 | Recall@5 64.1%; selected video 33.8%; mIoU .1224; IoU ≥ .5 10.3%; mean latency 27.1 s | This is the full multimodal reference, not rerun locally |
| Cached-full equivalence, Sol job 65061241 | Accuracy exactly matches baseline; mean latency 16.79 s; p50 14.16 s; p95 42.67 s | Establishes prediction equivalence, but does not by itself establish a cache speedup |
| Warm cached-full, Sol job 65086153 | Accuracy exactly matches baseline; mean latency 38.62 s; p50 29.10 s; p95 108.24 s | Shared-system/runtime variance dominates; no end-to-end cache speedup claim is supported |
| Top-3 visual windows, Sol job 65086154 | Selected video 32.4%; mIoU .1136; IoU ≥ .5 9.0%; mean latency 19.30 s | Faster Pareto operating point, with two fewer IoU ≥ .5 successes and 7.2% relative mIoU loss versus full multimodal |
| Transcript-only localization, Sol job 65086155 | Selected video 31.0%; mIoU .0945; IoU ≥ .5 6.2%; mean latency 4.06 s | Strong latency baseline, but visual scoring materially improves localization accuracy |
| Lexical title fusion, reproduced locally | Recall@1 35.2% vs 29.7%; Recall@5 unchanged 64.1% | Retrieval gain; no proven full-pipeline accuracy gain |
| Best local text-only sweep by IoU ≥ .5 | mIoU .1058; IoU ≥ .5 11.0% | Does not beat supplied full baseline on mean IoU; protocol differs |

The 60 text-only ablations reproduced exactly from v1. Cached-bank run time: 15.18 s versus 133.91 s for the earlier bank-building run. This is a single cross-run observation, not a controlled latency speedup estimate.

Cache microbenchmark: median uncached 0.1388 s versus warm disk cache 0.00986 s for all 145 query embeddings; initial cold cache 0.2048 s. Caching makes the first pass slower. Model initialization, media decoding, CLIP, clip export, network and generation are excluded. No full-pipeline speedup is yet measured.

## Changes

- Persistent content-addressed text and CLIP image-feature caches, atomic writes, duplicate elimination, corruption recovery, pinned model/software namespaces. The CLIP cache keys exact image bytes, not just timestamps; text keys include encoding options. Cache storage must be treated as trusted local application data.
- CLIP computes cache misses in bounded batches of 32. Warm calls skip image inference, but still decode frames after process restart; persistent frame decoding is not implemented.
- Optional top-N transcript windows for visual processing (`--visual-candidate-limit`). This changes candidate coverage and needs accuracy evaluation; default remains all windows.
- Explicit `--visual-device cpu|cuda|mps`; default stays unchanged to preserve baseline behavior. CUDA is now selectable through the evaluator/factory.
- Localizer and fusion ablation flags (`--localizer`, `--transcript-weight`), per-query retrieval/localization/evidence timings, p50/p95 query latency and input hashes.
- Validation evaluator now reads only the requested split rather than loading both validation and test annotations.
- Fast replay of existing validation candidate scores for retrieval rank and five score weights. It verifies sample IDs/labels and hashes input. Counterfactual evidence extraction is not verified by replay, so results are scoring simulations requiring a final media-backed run.
- Provider-neutral OptionalVisionAdapter validates image input and returns structured observations separately from the unchanged question. Without a provider it reports provider_not_configured. It is an integration boundary, not an operational image QA endpoint; no image-based accuracy is claimed.

## Interpretation and limitations

The frozen full multimodal configuration remains the final accuracy configuration: Top-5 frozen title/author retrieval, retrieval weight 0, all visual windows, transcript weight .5, and CPU CLIP. Top-3 is retained only as an explicit efficiency operating point. Transcript-only establishes that visual scoring adds .0279 absolute mIoU and six IoU ≥ .5 successes on 145 validation samples, at substantial latency cost.

No end-to-end cache speedup is claimed. Cached-full accuracy reproduced exactly, but its measured mean latency ranged from 16.79 s to 38.62 s across Sol runs, compared with the earlier 27.13 s baseline. The component-level encoder-cache benchmark remains valid; the end-to-end measurements show that media decoding, evidence extraction, filesystem behavior, and shared-cluster variability dominate wall time.

Prior grouped validation selection remains unstable (held-out mIoU .0901 and success 7.6%). Naive adaptive windows and cue snapping remain failed accuracy approaches. A second identical run demonstrates reproducibility, not independent generalization. The existing 60-configuration sweep should not be expanded just to chase validation gains.

The local transcript bank matches the frozen manifest provenance; video payloads remain on Sol. Full visual cache equivalence on MedVidQA and top-3 accuracy/latency require manual Sol evaluation. The official test split is reserved from further tuning. Source-caption versus ASR stratification remains outstanding.

## Reproduction

Run from the Medix repository with installed dependencies and model weights:

```bash
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 uv run --no-sync python -m development.evaluation.benchmark_feature_cache --output-dir development/evaluation/results/cache-check-new
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 uv run --no-sync python -m development.evaluation.run_validation_improvements --device mps --output-dir development/evaluation/results/ablations-new
```

Output directories must be new. Raw numeric results live in development/evaluation/results/thesis-cache-benchmark-v1 and development/evaluation/results/validation-improvements-v2; those directories are ignored by Git, so preserve them with the thesis artifacts.

After transferring changed code to Sol, reuse the completed run without another model job:

```bash
cd ~/Medix
uv run --no-sync python -m development.evaluation.replay_video_selection --predictions /scratch/$USER/medix-work/validation-check-65027646/results/validation/predictions.jsonl --output-dir /scratch/$USER/medix-work/selection-replay-v1
```

For media-backed evaluation, the prepared development/ops/medvidqa_thesis_ablation.sbatch accepts MEDIX_ABLATION=cached-full, top3, or transcript; MEDIX_SPLIT=validation or test; and requires MEDIX_VIDEO_CACHE. Submit only manually. The split selects the corresponding frozen retrieval snapshot, and output paths include the split name. Reuse the combined symlinks from /scratch/$USER/medix-work/validation-check-65027646/videos while original media exists. The validation ablations are complete. Run only the frozen cached-full configuration once on the official test split, then stop model selection.

CreateAI access is not needed for these retrieval/localization experiments. A concrete vision provider, provider-failure handling at the API boundary, endpoint wiring, and an independently labeled image-question pilot are still needed for real multimodal QA.

## All reproduced text-only ablations

| Configuration | Recall@5 | Selected video | Mean IoU | IoU ≥ .5 |
|---|---:|---:|---:|---:|
| title__fixed90__w0 | 0.641 | 0.310 | 0.0906 | 0.055 |
| title__fixed90__w0.5 | 0.641 | 0.352 | 0.0850 | 0.041 |
| title__fixed90__w1 | 0.641 | 0.310 | 0.0723 | 0.048 |
| title__fixed60__w0 | 0.641 | 0.331 | 0.0939 | 0.097 |
| title__fixed60__w0.5 | 0.641 | 0.366 | 0.0903 | 0.090 |
| title__fixed60__w1 | 0.641 | 0.310 | 0.0755 | 0.076 |
| title__adaptive__w0 | 0.641 | 0.324 | 0.0930 | 0.083 |
| title__adaptive__w0.5 | 0.641 | 0.352 | 0.0808 | 0.069 |
| title__adaptive__w1 | 0.641 | 0.310 | 0.0797 | 0.069 |
| title__adaptive_lexical__w0 | 0.641 | 0.345 | 0.0979 | 0.090 |
| title__adaptive_lexical__w0.5 | 0.641 | 0.366 | 0.0859 | 0.069 |
| title__adaptive_lexical__w1 | 0.641 | 0.310 | 0.0791 | 0.069 |
| title__refined__w0 | 0.641 | 0.345 | 0.0998 | 0.090 |
| title__refined__w0.5 | 0.641 | 0.366 | 0.0867 | 0.069 |
| title__refined__w1 | 0.641 | 0.310 | 0.0797 | 0.069 |
| rrf_equal__fixed90__w0 | 0.621 | 0.276 | 0.0967 | 0.076 |
| rrf_equal__fixed90__w0.5 | 0.621 | 0.359 | 0.0934 | 0.055 |
| rrf_equal__fixed90__w1 | 0.621 | 0.283 | 0.0706 | 0.048 |
| rrf_equal__fixed60__w0 | 0.621 | 0.303 | 0.1058 | 0.110 |
| rrf_equal__fixed60__w0.5 | 0.621 | 0.366 | 0.1030 | 0.103 |
| rrf_equal__fixed60__w1 | 0.621 | 0.283 | 0.0747 | 0.076 |
| rrf_equal__adaptive__w0 | 0.621 | 0.290 | 0.0997 | 0.090 |
| rrf_equal__adaptive__w0.5 | 0.621 | 0.352 | 0.0884 | 0.076 |
| rrf_equal__adaptive__w1 | 0.621 | 0.283 | 0.0731 | 0.062 |
| rrf_equal__adaptive_lexical__w0 | 0.621 | 0.324 | 0.1080 | 0.090 |
| rrf_equal__adaptive_lexical__w0.5 | 0.621 | 0.379 | 0.0965 | 0.076 |
| rrf_equal__adaptive_lexical__w1 | 0.621 | 0.283 | 0.0738 | 0.062 |
| rrf_equal__refined__w0 | 0.621 | 0.324 | 0.1089 | 0.083 |
| rrf_equal__refined__w0.5 | 0.621 | 0.379 | 0.0965 | 0.069 |
| rrf_equal__refined__w1 | 0.621 | 0.283 | 0.0744 | 0.062 |
| rrf_title75__fixed90__w0 | 0.641 | 0.297 | 0.0981 | 0.069 |
| rrf_title75__fixed90__w0.5 | 0.641 | 0.372 | 0.0966 | 0.055 |
| rrf_title75__fixed90__w1 | 0.641 | 0.310 | 0.0723 | 0.048 |
| rrf_title75__fixed60__w0 | 0.641 | 0.324 | 0.1015 | 0.103 |
| rrf_title75__fixed60__w0.5 | 0.641 | 0.379 | 0.0988 | 0.097 |
| rrf_title75__fixed60__w1 | 0.641 | 0.310 | 0.0755 | 0.076 |
| rrf_title75__adaptive__w0 | 0.641 | 0.303 | 0.1020 | 0.090 |
| rrf_title75__adaptive__w0.5 | 0.641 | 0.372 | 0.0908 | 0.076 |
| rrf_title75__adaptive__w1 | 0.641 | 0.310 | 0.0797 | 0.069 |
| rrf_title75__adaptive_lexical__w0 | 0.641 | 0.345 | 0.1044 | 0.090 |
| rrf_title75__adaptive_lexical__w0.5 | 0.641 | 0.393 | 0.0964 | 0.076 |
| rrf_title75__adaptive_lexical__w1 | 0.641 | 0.310 | 0.0791 | 0.069 |
| rrf_title75__refined__w0 | 0.641 | 0.345 | 0.1056 | 0.083 |
| rrf_title75__refined__w0.5 | 0.641 | 0.393 | 0.0965 | 0.069 |
| rrf_title75__refined__w1 | 0.641 | 0.310 | 0.0797 | 0.069 |
| title_lexical__fixed90__w0 | 0.641 | 0.317 | 0.0832 | 0.048 |
| title_lexical__fixed90__w0.5 | 0.641 | 0.345 | 0.0821 | 0.041 |
| title_lexical__fixed90__w1 | 0.641 | 0.310 | 0.0723 | 0.048 |
| title_lexical__fixed60__w0 | 0.641 | 0.359 | 0.0905 | 0.090 |
| title_lexical__fixed60__w0.5 | 0.641 | 0.359 | 0.0869 | 0.083 |
| title_lexical__fixed60__w1 | 0.641 | 0.310 | 0.0755 | 0.076 |
| title_lexical__adaptive__w0 | 0.641 | 0.317 | 0.0880 | 0.076 |
| title_lexical__adaptive__w0.5 | 0.641 | 0.352 | 0.0808 | 0.069 |
| title_lexical__adaptive__w1 | 0.641 | 0.310 | 0.0797 | 0.069 |
| title_lexical__adaptive_lexical__w0 | 0.641 | 0.324 | 0.0893 | 0.083 |
| title_lexical__adaptive_lexical__w0.5 | 0.641 | 0.359 | 0.0839 | 0.069 |
| title_lexical__adaptive_lexical__w1 | 0.641 | 0.310 | 0.0791 | 0.069 |
| title_lexical__refined__w0 | 0.641 | 0.324 | 0.0902 | 0.083 |
| title_lexical__refined__w0.5 | 0.641 | 0.359 | 0.0849 | 0.069 |
| title_lexical__refined__w1 | 0.641 | 0.310 | 0.0797 | 0.069 |
