# Medix response and clip behavior — 2026-10-15

## Implemented

- Greetings and capability replies stay short and within Medix's medical-assistance scope.
- Intent routing distinguishes evidence requests, Medix conversation, missing context, and unrelated requests. An unspecified bandaging request asks for body part and bandage type before retrieval; existing context, images, and explicit urgent requests bypass that deterministic shortcut.
- Nonmedical requests receive a short scope redirect. General replies are limited to 180 output tokens and instructed to use at most two short sentences.
- Initial answers are rewritten from source cues into at most three claims / 90 words, then independently checked against their citations. Backend claims are no longer treated as finished conversational prose. Unknown backend citation IDs still fail closed.
- Up to three explicit questions are handled separately against the retrieved source. Each receives an answer or a visible evidence limitation. More than three prompts a prioritization question. This does not implement independent retrieval for every question: a second topic may require another source.
- Unsupported-evidence replies ask a short follow-up offering another video search.
- Raw transcripts start collapsed. The video badge shows the interval in the source video; a trimmed clip's playback clock starts at zero.
- Clip extraction rejects non-finite or invalid intervals, checks available source duration, replaces cached exports of the wrong duration, and checks the generated duration. A 100 ms tolerance accommodates encoded frame/audio packet boundaries. The player pauses at the requested clip duration.

## Timestamp meaning

The live pipeline predicts an interval; it does not look up expert answer timestamps for arbitrary chat questions. A 90-second interval comes from the window localizer, not an FFmpeg failure. These changes enforce the interval supplied to extraction; they do not establish that predicted boundaries equal dataset annotations. No ground-truth labels were injected into retrieval or evaluation. Exact sample-reference playback would need a separately labeled dataset-example workflow. YouTube fallback embeds use platform start/end controls and cannot provide the same frame-level guarantee as local extracted clips.

## Local checks

Final verification: 115 frontend unit tests passed; 37 focused backend tests passed
with one factory test deselected; Biome and scoped Ruff checks passed. The real
FFmpeg cases are included in the backend count. Full TypeScript checking and the
broader evaluation suite could not finish because local dependency reads stalled
(in a Next.js declaration file and Python package metadata). Those processes were
interrupted; their completion is not claimed. The deselected factory test hit the
same dependency-import blocker. No hosted-model quality benchmark was run.

Run from the repository root:

```bash
uv run --no-sync pytest development/tests/test_grounded_generation.py development/tests/test_evaluation.py development/tests/test_clip_bounds.py -q
cd frontend
pnpm test:unit
pnpm exec tsc --noEmit
```

The clip integration tests generate a four-second red/blue video, export 2.2–3.4 seconds, check the first frame is blue and duration is 1.2 seconds, exercise stale-cache replacement, and reject invalid/out-of-range intervals. Model response tests use scripted models: passing them does not establish hosted Qwen answer accuracy.

Manual live checks:

1. `Hey` → short Medix greeting; no evidence retrieval.
2. `Can you help me with how to band the bandage?` → brief context question.
3. `Write a Python program` → short Medix scope redirect.
4. Ask a specific procedure question with sufficient context → concise supported explanation and citations.
5. Ask two explicit medical questions → both addressed; an unsupported part is clearly identified.
6. Play an exported clip → source interval is displayed, player clock is clip-relative, and playback stops at the interval's end.

## Deploying backend changes to Sol

Frontend changes are on the Mac. A running Sol process will continue using the old backend code until the two changed backend files are copied and its job is restarted. Use the prepared archive `/tmp/medix-response-bounds-update.tar.gz` from the Mac; it contains no environment files or credentials. Keep the current job available until the transfer succeeds, then stop that specific job and submit `development/ops/medix_live_backend.sbatch` manually. Use the new job's compute node for the tunnel.

No Sol login, job submission, hosted inference, or test-split evaluation was performed for these fixes. Retrieval/localization accuracy gains have not been measured. Rewriting initial answers adds one bounded generation call; multiple questions require separate bounded generation/verification passes.
