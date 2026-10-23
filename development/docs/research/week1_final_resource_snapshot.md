# Week 1 final MedVidQA resource snapshot

Snapshot time: 2026-10-04 10:22:35 UTC. This report describes the frozen
resource state after public media recovery on ASU Sol and offline Whisper ASR.
It does not contain a benchmark rerun and does not change annotations,
retrieval rankings, models, thresholds, catalog semantics, or evaluation logic.

## Frozen inputs and outputs

The original MedVidQA split remains 899 unique videos and 3,010 questions:
800/2,710 train, 49/145 validation, and 50/155 test. The unchanged retrieval
catalog contains 852 videos. Frozen validation and test Top-5 rankings remain
the rankings saved on 2026-09-24.

The completed resource artifacts are:

- `development/evaluation/results/week1/2026-10-04-asr-v1/`: 676 ASR attempt records,
  673 timestamped transcripts, run provenance, and source/transcript hashes.
- `development/evaluation/results/week1/2026-10-04-sol-resource-snapshot-v1/`: the final
  Sol transcript and acquisition metadata copied without media payloads.
- `development/evaluation/results/week1/2026-10-04-final-resource-snapshot-v1/`: 840-file
  merged transcript cache, 899-row inventory, summary, and frozen manifest.

The final manifest SHA-256 is
`7e770b751eb7866f7fff9ccddeaa0c99ba2939d06b0fb0bec3fc1a15b1c1083a`.
The ASR transfer checksum is
`6eedea0e15d22e75ce377d29df37928b6f5ef792edd3ec7cff1cf81e3baee8f3`.

## Overall resource coverage

| Resource state | Videos | Percent of 899 |
| --- | ---: | ---: |
| Catalog metadata | 852 | 94.8% |
| Local media on Sol | 843 | 93.8% |
| Valid timestamped transcript | 840 | 93.4% |
| Fully usable media + transcript | 840 | 93.4% |
| Media only; ASR found no timestamped speech | 3 | 0.3% |
| Catalog metadata only | 11 | 1.2% |
| Unavailable or unresolved | 45 | 5.0% |

The 840 transcripts comprise 167 source/downloaded captions and 673 offline
ASR transcripts. The ASR model was
`openai/whisper-large-v3-turbo` at revision
`41f01f3fe87f28c78e2fbf8b568835947dd65ed9`, forced to English with 30-second
chunks, batch size 16, and timestamp output. The A100 job completed in
1:58:21 with Slurm exit code 0.

## Coverage by split

| Split | Videos | Fully usable videos | Questions | Fully usable questions |
| --- | ---: | ---: | ---: | ---: |
| Train | 800 | 744 | 2,710 | 2,572 |
| Validation | 49 | 47 | 145 | 141 |
| Test | 50 | 49 | 155 | 148 |
| **Union** | **899** | **840** | **3,010** | **2,861** |

All three ASR failures are in train. Validation has two unavailable target
videos affecting four questions. Test has one unavailable target video
affecting seven questions.

## Remaining media failures

| Exact failure class | Videos |
| --- | ---: |
| Private video | 28 |
| Video unavailable | 21 |
| YouTube age/bot verification requiring authentication | 3 |
| Removed for terms-of-service violation | 1 |
| HTTP 403 on media data | 1 |
| Members-only channel content | 1 |
| Local duration 0.146 seconds short of latest annotation | 1 |
| **Total** | **56** |

No cookies, credentials, proxies, impersonation, or access-control bypasses
were used. The exact downloader errors and attempts are retained per video in
`video_inventory.jsonl`. The near-boundary duration case is retained as a
failure because changing the validation tolerance would change the frozen
resource rule.

## ASR failures

Three readable training videos have valid, non-silent Opus audio but Whisper
returned no nonempty timestamped cues:

| Video | Duration | Mean volume | Questions |
| --- | ---: | ---: | ---: |
| `NRf06TTRzEA` | 413.841 s | -19.3 dB | 3 |
| `dqwGKyQSqdI` | 280.714 s | -22.8 dB | 1 |
| `w4EUi7XcVmA` | 131.294 s | -20.5 dB | 3 |

They are classified as `media_only/no_recognizable_timestamped_speech` and do
not affect validation or test.

## Frozen validation and test candidate coverage

The frozen retrieval output contains 1,500 candidate slots and 449 unique
candidate videos across validation and test.

| Measure | Validation | Test |
| --- | ---: | ---: |
| Questions | 145 | 155 |
| Unique Top-5 candidates | 297 | 300 |
| Fully usable unique candidates | 290 | 295 |
| Questions with all Top-5 candidates fully usable | 130 | 147 |
| Correct target fully usable | 141 | 148 |
| Correct target in frozen Top-5 | 93 | 88 |
| Correct target in Top-5 and fully usable | 93 | 88 |

Across the union, 441/449 unique candidates are fully usable. Every correct
target that appears in the frozen Top-5 is now resource-ready: 93/93 on
validation and 88/88 on test. Fifteen validation and eight test questions have
at least one unavailable non-target candidate, which must remain visible in
resource-coverage reporting during the rerun.

## Effect of the unchanged 852-video catalog

The catalog still omits 47 original MedVidQA videos. Two omitted test targets
affect 12 test questions:

- `_N89T_Yqu68`: five questions; media and ASR transcript are available, but
  the target cannot be retrieved because it remains outside the catalog.
- `5gPyNNXP-wA`: seven questions; the video is private and has no usable local
  resource.

Resource recovery therefore does not change the frozen test retrieval upper
bound or the saved 88/155 Recall@5 result. Catalog repair remains outside this
baseline.

## Reproducibility boundary

The merged transcript cache is local and network-independent. The 843 media
files remain on Sol; they were not copied back to the Mac. Evaluation must run
where those files are mounted or use the configured cache location. Every ASR
transcript records the source-media hash, transcript hash, model revision, GPU,
Torch version, parameters, and completion time. Every acquired media failure
retains the public source probe, format attempts, tool error, and final status.

Source captions and generated ASR transcripts must be reported separately in
analysis because ASR introduces an additional measurement source. The clean
baseline should use the frozen resources as observed and report resource
abstentions rather than silently removing unavailable videos or questions.

## Readiness

The resource snapshot is ready for a clean offline baseline rerun after the
evaluation command is pointed to the frozen merged transcript cache and Sol
media-cache roots. That configuration step must preserve the frozen retrieval
rankings, models, thresholds, annotations, and metrics.

**Ready for clean baseline rerun: YES**
