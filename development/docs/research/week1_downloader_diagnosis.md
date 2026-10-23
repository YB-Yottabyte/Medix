# Week 1 YouTube downloader diagnosis

Date: 2026-09-24. This is a three-video tooling comparison only. No benchmark,
model, retrieval, threshold, vector database, annotation, or original cache was
changed. The three test IDs were selected from the 24 public-metadata videos
whose phase 2 media requests returned HTTP 403.

## A. Current downloader and HTTP path

- `development/scripts/cache_medvidqa_videos.py::_download` launches the `yt-dlp` CLI with
  `subprocess.run`. It requests up to 360p using
  `bestvideo[height<=360]+bestaudio/best[height<=360]/worst` and merges to MP4.
  `development/scripts/recover_medvidqa_videos.py::acquire_video` used the same format policy
  for the phase 2 staged attempts, adding non-overwrite, timeout, and retry flags.
- The installed CLI is `/opt/homebrew/bin/yt-dlp`, a Homebrew-managed Python
  entry point for the `yt_dlp` package **2026.03.13**. Its diagnostic output
  showed `yt_dlp_ejs` **0.7.0** and **Deno 2.7.5**. `ffmpeg` merges streams and
  validates clips; it is not the downloader. `youtube-transcript-api` fetches
  captions only and is not involved in the video HTTP 403.
- yt-dlp first extracts webpage/player metadata. Its HTTP media downloader
  (`yt_dlp.downloader.http.HttpFD.real_download`) constructs a networking
  `Request` without POST data, whose default method is **GET**, then calls
  `urlopen`. The old tool's selected media URL host for a representative
  failed video was `rr9---sn-8xgp1vo-a5ml.googlevideo.com`. The 403 came from
  the **media request to a YouTube/Googlevideo server**; yt-dlp reported it as
  `ERROR: unable to download video data: HTTP Error 403: Forbidden`. Source
  metadata extraction had already succeeded. The HTTP status alone does not
  disclose why the server refused that stream URL.

The installed yt-dlp explicitly warned that its version was over 90 days old.
Its verbose output selected the `android vr` player API. The
[official latest stable release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19)
was **2026.08.19** at audit time and includes YouTube client maintenance,
including removal of `android_vr` from default clients. The repository's older
MedVidQA README mentions `pytube` as a historical dataset download example;
the current Medix media scripts do **not** use it. The yt-dlp mechanism is
supported, but the installed release was outdated.

## B. Supported, credential-free alternative tested

The [yt-dlp installation guide](https://github.com/yt-dlp/yt-dlp/wiki/Installation)
supports current stable releases. Its [EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
describes `yt-dlp-ejs` with a supported JavaScript runtime, recommending Deno.
I ran official yt-dlp **2026.08.19** with its default EJS dependency **0.8.0**
and existing Deno **2.7.5** in an isolated temporary `uvx` environment. The
command used `--ignore-config` and `--no-cache-dir`, the same up-to-360p
selector, and a new output directory. No cookies, credentials, proxy,
impersonation, private-video access, or restriction bypass was used. The
official `nightly` channel is another maintained release option, but it was
not needed or tested here. An owner-provided downloadable copy would also
avoid a changing third-party extractor, if rights and provenance permit it.

## C. Three representative public-video tests

The full per-video method, exact old error, observable format list, acquisition
status, file hash, annotations, FFmpeg checks, and clip result are saved in
[week1_downloader_three_video_test.jsonl](week1_downloader_three_video_test.jsonl)
(three rows; SHA-256
`42cec6fd7cfefbcf2c716a87c0706eba7fa92a34bd1e5114eace436a64ce3a06`).
Generated JSON records, media, and test clips are under
`development/evaluation/results/week1/2026-09-24-downloader-diagnostic/`. All three source
probes reported `public` and exposed video formats at 360p or higher.

| Video ID | Old 2026.03.13 result | New 2026.08.19 result | Observable formats | File size | Local duration / latest annotated end | FFmpeg validation |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `Se3kf5X4PCc` | Media HTTP 403 | Downloaded | 64 | 4,279,617 bytes | 122.621 / 112 s | Frames decoded; 3.000 s clip |
| `VykLxY9mzug` | Media HTTP 403 | Downloaded | 15 | 43,716,010 bytes | 741.401 / 344 s | Frames decoded; 3.003 s clip |
| `_bZHLRfVYtU` | Media HTTP 403 | Downloaded | 49 | 24,364,180 bytes | 787.701 / 773 s | Frames decoded; 3.000 s clip |

All three have `ffprobe` video streams, durations reaching all their test
answer intervals, successful frame decodes, and nonempty readable clips
extracted from an annotated interval. The new tool reported no download
failure on these three IDs. The comparison changed the yt-dlp release and
its EJS dependency together; it does not isolate which internal change fixed
the 403.

## D. Feasibility and benchmark decision

This is strong evidence that the 403s for **these three videos** were caused
by downloader/client compatibility rather than video deletion or privacy:
the same public IDs failed with the older tool and worked with the current
official tool, without credentials. It does not yet prove that the other
21 failed IDs will download. Continuing a bounded, staged acquisition attempt
is practical; treating the full 155-question test as uniformly media-backed
is premature until the remaining IDs and catalog omissions are resolved.

Keep the original MedVidQA annotations as the current main labeled benchmark
while measuring resource coverage separately. Do not switch benchmarks based
on the old-tool 403 alone. The
[original dataset paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC10031721/)
explains that videos are referenced by YouTube ID rather than distributed with
the annotations, so long-term media reproducibility remains a real limitation.
If the remaining media cannot be acquired under a documented, permitted method,
then a separately reviewed dataset with reliably distributed media would be
better for the main **media-dependent** evaluation. No such replacement was
selected or evaluated in this diagnostic.

Stop point: exactly three failed public videos were tested with the updated
tool. No remaining IDs were attempted and no benchmark was rerun.
