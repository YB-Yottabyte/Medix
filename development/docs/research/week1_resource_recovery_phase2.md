# Week 1 resource recovery, phase 2

Run date: 2026-09-24. This phase used only the 26 IDs whose English transcripts
were recovered in the [phase 1 summary](../../evaluation/results/week1/2026-09-24/summary.json).
The original MedVidQA annotations, 852-video catalog, production video cache,
retrieval configuration, and benchmark outputs were not changed or rerun.

## Scope and method

For each of the 26 IDs, `development/scripts/recover_medvidqa_videos.py`:

1. Ran a read-only `yt-dlp --skip-download --dump-single-json` source probe.
2. Attempted a video download at no more than 360p into
   `development/evaluation/results/week1/2026-09-24-phase2/video_cache/` using `--no-overwrites`.
3. If a local file appeared, measured its size and duration with `ffprobe`,
   checked that it reached the latest test annotation for that video, decoded
   three frames with FFmpeg, and extracted a short clip from the latest annotated
   interval into a separate `test_clips/` directory.
4. Saved source, download, and validation statuses and exact tool stderr in a
   per-ID JSON record. An interrupted run skips already completed records.

The full 26-row record is [week1_phase2_video_inventory.jsonl](week1_phase2_video_inventory.jsonl).
The generated [summary](../../evaluation/results/week1/2026-09-24-phase2/summary.json),
per-ID records, staged videos, and test clips remain in the new phase 2 directory.
The previously recovered transcripts remain in the separate phase 1 staging cache.

## Resource coverage result

| Outcome | Videos | Of 59 transcript-blocked test questions |
| --- | ---: | ---: |
| Current source metadata probe succeeded | 26/26 | 59/59 |
| Local video download succeeded | 2/26 | 2/59 |
| Local duration, frames, and test clip validated | **2/26** | **2/59** |
| Download failed with HTTP 403 media-data error | 24/26 | 57/59 |

All 26 source probes reported `availability: public`, and each reported source
duration reached that video's latest annotated test interval. This is a metadata
observation, not proof that its media stream can currently be fetched. The 24
failed downloads all returned exactly `ERROR: unable to download video data:
HTTP Error 403: Forbidden`. There were no other first-pass download errors.

| Fully usable staged video | File size | Local duration | Latest annotated end | Frames | Test clip |
| --- | ---: | ---: | ---: | --- | --- |
| `Y9-54bnvPGg` (sample 2839) | 1,936,942 bytes | 43.761 s | 34 s | Three decoded | 3.003 s, 284,418 bytes |
| `v0HODFTrkqs` (sample 2777) | 1,503,301 bytes | 36.003 s | 25 s | Three decoded | 3.003 s, 291,400 bytes |

Both extracted clips are nonempty and readable by `ffprobe`. The staged
transcripts also contain cues overlapping the corresponding annotated interval
(8 cues for sample 2839 and 10 for sample 2777). This establishes resource
readiness for those two questions, not that the pipeline will select their video
or generate a correct answer.

After the first-pass failures, format `18` (progressive 360p) was tried for
`Se3kf5X4PCc` in a separate alternate staging directory; it also returned HTTP
403. A read-only `web_safari` yt-dlp client probe for that same video listed
storyboards but no downloadable video stream. No alternate method was applied
to the other 23 failed IDs, so their per-ID first-pass records remain comparable.

## Remaining cause and interpretation

The immediate remaining cause for **24 videos / 57 affected questions** is an
HTTP 403 from the media download, despite successful public metadata probes and
recovered English transcripts. This may reflect stream access, client, or network
restrictions; these observations do not prove the videos are deleted or private.
There are no observed short local videos, frame decode failures, or test-clip
failures among the two successful downloads. No original cache or result was
overwritten.

## Proposed clean benchmark rerun — not executed

1. Freeze hashes and manifests for the original MedVidQA train/validation/test
   files, unchanged 852-video catalog, original retrieval configuration, July
   results, and both Week 1 staging directories.
2. Build **new** merged transcript and video cache directories, copying the 61
   original transcripts plus 26 staged recovered transcripts, and the 51
   original local videos plus two validated staged videos. Do not write into the
   original cache directories.
3. With the original catalog and retrieval settings, save fresh validation and
   test retrieval predictions to new paths and confirm that candidate rankings
   are unchanged. Do not tune using test labels.
4. Run `development.evaluation.run_end_to_end_pipeline` with `--top-k 5`, the previously
   selected `--retrieval-weight 0.0`, the new merged cache paths, and **new**
   output and artifact directories. Run validation before test and preserve
   the July results separately.
5. Report the same full-155 metrics and six failure categories alongside
   catalog, transcript, and local-video coverage. Two newly resource-ready
   questions are **not** a predicted two-question improvement in answer quality.

Stop point: resource coverage is reported here. No model, retrieval, threshold,
vector database, or evaluation code was changed, and no benchmark was run.
