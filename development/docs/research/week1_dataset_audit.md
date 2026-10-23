# Week 1 MedVidQA dataset and resource audit

Audit date: 2026-09-24 UTC. This report uses the original MedVidQA splits and
the saved July 2026 Medix retrieval/evidence results. No benchmark was rerun.
The old catalog, caches, and results were not overwritten.

## A. Provenance and evidence boundary

| File | Provenance | SHA-256 |
| --- | --- | --- |
| `MedVidQA/train.json` | Original-format MedVidQA train annotations; first committed locally in `b5f945c` (2026-01-28) | `5209346c6a9675f4d65a6c28b7b9f12130efd8c4fb64c7194c56ab11fc408a59` |
| `MedVidQA/val.json` | Original-format MedVidQA validation annotations; same local commit | `108ba15a941d1d19d0e6dc27237a9039fef28a578a08f635c03784a40f0d5870` |
| `MedVidQA/test.json` | Original-format MedVidQA test annotations; same local commit | `62321ec0a20f8ec94f57c219609f28422dec954534fac409e333edaa1627348d` |
| `data/medvidqa_video_catalog.json` | Derived from those three splits and YouTube oEmbed title/author metadata by `development/scripts/build_video_catalog.py` | `12fefa04ba75ebdd3c7c18c98fff444c81f67cf3f4b1a7e095018dca41981e6c` |
| `development/evaluation/results/candidate_transcript_cache_report.json` | Prior candidate transcript acquisition output | `f9a28d045298294de2e6c7456ba7b52f91dce279962fb76b42eda6215866820c` |

The split counts and fields match the [original MedVidQA dataset paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC10031721/): 2,710/145/155 questions and 800/49/50 videos. `MedVidQA/README.md` identifies a January 2022 initial release. The OSF link on the [MedVidQA 2024 site](https://medvidqa.github.io/#datasets) returned 403 during this audit, so upstream byte identity was not verified. The [NIST 2024 data page](https://trec.nist.gov/data/medvidqa2024.html) describes different VCVAL and QFISC releases. No TREC 2024 corpus, topics, or judgments were found in this repository. `MedVidQA/cleaned/*.json` are locally derived and are excluded from the official evaluation loader.

## B. Unique-video reconciliation

| Split | Questions | Videos | Catalog present | Catalog missing | Transcript cached | Local video |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 2,710 | 800 | 757 | 43 | 15 | 5 |
| Validation | 145 | 49 | 47 | 2 | 25 | 25 |
| Test | 155 | 50 | 48 | 2 | 21 | 21 |
| **Union** | **3,010** | **899** | **852** | **47** | **61** | **51** |

The splits share no video IDs. Catalog IDs are unique, all belong to the dataset, and all 47 omissions occur in `unavailable_video_ids`. Annotation URLs and durations are consistent per video and match catalog values. There are no duplicate sample IDs. Three training question/video pairs repeat; one also repeats its interval, while two have different annotated intervals. All 899 annotation videos have a YouTube URL. All 852 catalog entries have a title, author, and URL. The catalog's `transcript` field is null for every entry; the separate cache supplies transcripts.

The complete per-ID reconciliation is saved as `development/docs/research/week1_video_inventory.jsonl` and also appears in the generated audit output under `development/evaluation/results/week1/2026-09-24/` (899 rows, SHA-256 `ef1c599daeaa5a50a0d29fc1d78f8914aec6de1338865c82992e40c4fd9165de`). Each row records split/sample IDs, source URL, catalog fields, transcript/cache status, local media status, a frame-decode check, a clip-source plausibility check, and retry outcome. `clip_source_plausible` means a readable video stream covers the latest gold end; it is **not** proof that every possible evidence clip was encoded successfully. Current YouTube playback availability remains unverified.

## C. Resource availability

Of 899 videos, 51 have both cached transcript and local video, 10 have only a transcript, zero have only a local video, and 838 have neither. All 61 original cached transcripts parsed into nonempty cues. All 51 local videos had a positive duration and video stream, reached their latest annotated answer end, and decoded a test frame. These checks did not download media.

The historical candidate transcript run requested 449 unique retrieved videos; 49 were available and 400 were reported unavailable. The old report does not save exception classes or HTTP statuses. The video caching script selects only IDs that already have transcript files, so absent local video does not establish remote video unavailability.

## D. The 59 transcript-blocked test questions

The 59 questions cover 26 target video IDs. Every ID was in the 852-video catalog and in the prior failed candidate transcript report. None had an original cached transcript or local video. The 2026-09-24 targeted retry fetched **English transcripts for all 26** and staged 3,121 cues in `development/evaluation/results/week1/2026-09-24/recovered_transcripts/`. All 26 staged files pass the pipeline's cached-transcript parser. The original `data/transcript_cache/` remains unchanged.

Thus the current diagnostic outcome is **26/26 transcript videos recovered, corresponding to 59/59 affected questions**. The exact historical cause cannot be reconstructed: the prior `TranscriptFetcher` caught every exception and returned `None`. Current success rules out persistent absence of English captions for these 26 at retry time, but does not prove which prior network, access, or transient condition caused failure. None of the 26 has local video, so transcript recovery alone does not enable a complete evidence bundle. With an appropriately assembled *new* cache snapshot, these 59 targets could proceed to transcript localization; no new benchmark result is claimed.

## E. Catalog metadata retry and the 12 test cases

`development/scripts/build_video_catalog.py` enumerates 899 IDs from the three original splits, copies URL/duration, then requests a title and author from YouTube oEmbed. `development/evaluation/video_catalog.py` omits an ID if that request fails or yields no valid title. There is no split filter or supported-video allowlist in this build. The 47 omissions are 43 train, two validation, and two test videos.

All 47 previously omitted IDs were retried on 2026-09-24. **None returned usable metadata**: 28 gave HTTP **403 Forbidden**, 17 gave HTTP **404 Not Found**, and two gave HTTP **401 Unauthorized**. These are exact oEmbed responses, not a determination that the underlying videos cannot play. The two omitted test videos are:

| Video ID | Test sample IDs | Retry status |
| --- | --- | --- |
| `_N89T_Yqu68` | 2718–2722 (5) | HTTP 401 Unauthorized |
| `5gPyNNXP-wA` | 2814–2820 (7) | HTTP 403 Forbidden |

Both are in the original annotations and were dropped by metadata-dependent catalog construction. Neither has cached transcript or video. The 17 HTTP 404 cases have no oEmbed metadata through this request at audit time; no permanent source-unavailability claim follows from that endpoint alone. The 30 HTTP 401/403 cases are access-denied through that endpoint. No catalog entry was added or altered.

## F. Exact scripts and new artifacts

- `development/scripts/build_video_catalog.py` now logs the underlying metadata exception without changing its returned catalog.
- `development/evaluation/video_catalog.py` now logs which ID is omitted and why; omission behavior is unchanged.
- `backend/adapters/transcript.py` now logs the underlying transcript API, cache read, and cache write exceptions. Return values and cache format are unchanged.
- `development/scripts/cache_medvidqa_transcripts.py` now logs IDs returning no cues; default acquisition and report formats are unchanged.
- `development/scripts/audit_medvidqa_resources.py` produces the inventory and targeted, structured retries. It uses exclusive file creation and refuses a nonempty output directory.
- `development/evaluation/results/week1/2026-09-24/summary.json` records the 47 metadata and 26 transcript per-ID outcomes; SHA-256 `fd6b913d088284470faa0beb5bbf40338cd21d40692c19b063d2aad388702a5d`.
- `development/evaluation/results/week1/2026-09-24/video_inventory.jsonl` is the 899-row inventory. The 26 recovered cue files reside beside it in `recovered_transcripts/`.
- `development/docs/research/week1_video_inventory.jsonl` is a byte-identical, versionable copy of the inventory.

The diagnostic command was:

```bash
python -m development.scripts.audit_medvidqa_resources --retry \
  --output-dir development/evaluation/results/week1/2026-09-24
```

The script deliberately retries only the previously failed catalog IDs and the previously failed target transcripts behind the 59 test questions. It does not retry the other failed candidate transcripts, download video, alter the old cache, or run evaluation.

## G. Next repair decisions

1. Keep the original annotations and July catalog/results frozen. Do not insert fabricated titles for the 47 catalog omissions.
2. Verify the 47 metadata failures using a documented, lawful source check or a later oEmbed retry before adding any catalog entries. Record status and acquisition date. The two omitted test videos are especially consequential.
3. Decide whether to stage local videos for the 26 recovered-transcript targets. The evidence extractor requires transcript, frame, and clip. Verify each acquisition and media decode without overwriting the old video cache.
4. Construct a versioned merged transcript cache from the 61 original files plus 26 staged files only after reviewing this report. Keep the July cache unchanged.

## H. Clean baseline rerun procedure (not executed)

Freeze the three split hashes, old and new catalog hashes, cache manifests, dependency/model revisions, acquisition date, and resource rule. Build retrieval candidates from the frozen catalog; acquire candidate resources uniformly without selecting by gold answer interval. Tune or retain settings on validation only; for a direct comparison retain the saved retrieval weight of `0.0`. Run validation, then test into new directories. Report catalog coverage, Recall@5, transcript/video coverage, correct target localizable, selected-video accuracy, IoU >= 0.5, evidence coverage, and the six exclusive failure categories. Do not interpret the staged captions as a new end-to-end score until local video coverage and a full rerun are complete.
