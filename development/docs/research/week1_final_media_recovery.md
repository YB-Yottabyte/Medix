# MedVidQA Week 1 final staged media recovery

Acquisition date: 2026-09-24 (UTC timestamps per resource in the records). The original MedVidQA annotations, 852-video catalog, production caches, evaluation code, and prior benchmark results were not changed. No benchmark was rerun.

## A. Final recovery and coverage

- Of the 21 remaining target videos, 20 passed on the first updated-tool attempt. The last, `xYFeFFzFftw`, returned `ERROR: unable to download video data: HTTP Error 403: Forbidden` for selected format `243+251-20`; a separate retry with advertised `134+140-20` passed. The failed attempt record is preserved.
- Including the 2 phase-2 videos and 3 earlier diagnostic videos, **26/26** target videos now have validated media and recovered transcripts.
- The merged cache contains **87** transcript files (61 original + 26 recovered) and **77** video files (51 original + 26 recovered). All 164 copied file hashes were verified and all 87 transcript files parsed as nonempty cue lists.
- **59/59** questions in the previously transcript-blocked test group now have their *correct target video* transcript and validated local media. This is resource coverage, not a new pipeline accuracy or answer score.

## B. Per-video media record

All 21 new acquisitions use isolated `yt-dlp[default]==2026.08.19`, `yt-dlp-ejs==0.8.0`, Deno 2.7.5, and the previously tested up-to-360p format policy; no cookies, credentials, proxies, or impersonation. Frame validation decoded three timestamps (opening, an annotated interval midpoint, and near the latest annotated end). Clip validation encoded a short excerpt from the latest annotated interval. Individual JSON records, including raw stderr and exact errors, are in `development/evaluation/results/week1/2026-09-24-remaining-media/records/`, with the successful retry in `retry/xYFeFFzFftw.json`.

| Video ID | Final status | Selected format | Bytes | Duration / latest gold end (s) | Frames | Clip | Affected test Qs |
|---|---|---|---:|---:|---|---|---:|
| `T43753AfaKY` | Recovered | `396+251-11` | 7,705,238 | 280.901 / 240 | pass | pass | 3 |
| `UZqktEPlxTU` | Recovered | `396+251-11` | 4,670,802 | 118.341 / 105 | pass | pass | 1 |
| `VHN5zPaw96w` | Recovered | `396+251-11` | 2,654,974 | 89.041 / 77 | pass | pass | 1 |
| `VYXSyQmTAXQ` | Recovered | `396+251-8` | 19,988,866 | 567.941 / 430 | pass | pass | 3 |
| `ZNWjfe-84Ig` | Recovered | `396+251-11` | 3,125,303 | 109.721 / 75 | pass | pass | 2 |
| `Zs8Fs5HaJHs` | Recovered | `396+251` | 4,918,520 | 190.621 / 183 | pass | pass | 1 |
| `_RNMIizfDEY` | Recovered | `396+251` | 15,545,358 | 714.941 / 46 | pass | pass | 1 |
| `_hb7isbiW3s` | Recovered | `243+251-16` | 16,743,663 | 304.041 / 263 | pass | pass | 1 |
| `bUgV89cdfTM` | Recovered | `134+251-19` | 2,527,064 | 104.221 / 90 | pass | pass | 1 |
| `dqtqS_OVDGw` | Recovered | `243+251` | 17,888,347 | 474.701 / 396 | pass | pass | 3 |
| `fsdchGejKmU` | Recovered | `396+251-12` | 17,287,227 | 617.461 / 565 | pass | pass | 3 |
| `g-gNQPyxU4c` | Recovered | `243+251` | 23,949,729 | 685.101 / 405 | pass | pass | 1 |
| `hekjiCqb9-g` | Recovered | `396+251-8` | 3,231,547 | 104.361 / 64 | pass | pass | 1 |
| `kSpggqOLgaU` | Recovered | `243+251` | 17,365,623 | 450.281 / 413 | pass | pass | 2 |
| `kyEF16tBBxo` | Recovered | `396+251-17` | 5,076,109 | 206.881 / 190 | pass | pass | 3 |
| `lRO4l8QkAzM` | Recovered | `243+251-20` | 8,029,919 | 209.161 / 140 | pass | pass | 1 |
| `ma_cmlU9DxU` | Recovered | `396+251` | 5,838,939 | 143.661 / 131 | pass | pass | 1 |
| `oIuGLGlQ2gg` | Recovered | `243+251-20` | 6,100,784 | 162.961 / 157 | pass | pass | 2 |
| `vgW6ZD_QwwQ` | Recovered | `396+251-11` | 15,992,512 | 410.301 / 345 | pass | pass | 6 |
| `x3YFqBzO5Uw` | Recovered | `396+251-2` | 5,581,028 | 148.881 / 144 | pass | pass | 5 |
| `xYFeFFzFftw` | Recovered on retry | `134+140-20` | 24,991,540 | 565.499 / 549 | pass | pass | 1 |

The five earlier successful videos and their checks are recorded in `development/evaluation/results/week1/2026-09-24-phase2/records/` (2) and `development/evaluation/results/week1/2026-09-24-downloader-diagnostic/` (3). Their exact selected format IDs were not saved in those earlier acquisition records, so the final manifest leaves those IDs null rather than inferring them.

## C. Remaining failures

- **0 of 26** target videos remain without usable media or transcript. The only failed media attempt was the first format choice for `xYFeFFzFftw`; its second staged format succeeded.
- This does not establish availability for other MedVidQA videos or for non-target candidate videos.

## D. Frozen merged cache

- Transcript cache: `development/evaluation/results/week1/2026-09-24-merged-cache-v2/transcript_cache/`
- Video cache: `development/evaluation/results/week1/2026-09-24-merged-cache-v2/video_cache/`
- Manifest: `development/evaluation/results/week1/2026-09-24-merged-cache-v2/manifest.json`
- Tracked manifest copy: `development/docs/research/week1_merged_cache_manifest.json` (byte-identical to the staged manifest)
- Manifest SHA-256: `9e702df863a117e1f0993465599a7cebecb74dee1a36cded7add9ae8ddc8fdad`
- Per-video acquisition table and raw checks: `development/docs/research/week1_remaining_media_recovery.jsonl`
- Manifest freezes every source and destination path, source ID, byte count, SHA-256, split/catalog/script/record hashes, coverage by question ID, acquisition method, UTC freeze time, and versions: Python 3.14.6, yt-dlp 2026.08.19, yt-dlp-ejs 0.8.0, Deno 2.7.5, FFmpeg/ffprobe 7.1.1.
- The first merged copy at `development/evaluation/results/week1/2026-09-24-merged-cache/` contains the same files but an incorrect coverage summary for the successful retry. It was preserved without overwrite and **must not** be used. The `-v2` manifest is the verified frozen cache.

## E. Proposed benchmark rerun (not executed)

From the repository root, use the original splits and catalog with the original top-5 and retrieval-weight settings, and fresh output/artifact directories:

```bash
uv run --frozen --group research python -m development.evaluation.run_end_to_end_pipeline \
  --dataset-dir MedVidQA \
  --catalog data/medvidqa_video_catalog.json \
  --transcript-cache development/evaluation/results/week1/2026-09-24-merged-cache-v2/transcript_cache \
  --video-cache development/evaluation/results/week1/2026-09-24-merged-cache-v2/video_cache \
  --artifact-root development/evaluation/results/week1/2026-09-24-repaired-baseline/artifacts/validation \
  --output-dir development/evaluation/results/week1/2026-09-24-repaired-baseline/end_to_end \
  --split validation --top-k 5 --retrieval-weight 0.0
uv run --frozen --group research python -m development.evaluation.run_end_to_end_pipeline \
  --dataset-dir MedVidQA \
  --catalog data/medvidqa_video_catalog.json \
  --transcript-cache development/evaluation/results/week1/2026-09-24-merged-cache-v2/transcript_cache \
  --video-cache development/evaluation/results/week1/2026-09-24-merged-cache-v2/video_cache \
  --artifact-root development/evaluation/results/week1/2026-09-24-repaired-baseline/artifacts/test \
  --output-dir development/evaluation/results/week1/2026-09-24-repaired-baseline/end_to_end \
  --split test --top-k 5 --retrieval-weight 0.0
```

The evaluation script writes each split under the supplied output directory. These paths are new and the benchmark has not been run.
