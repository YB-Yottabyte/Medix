# Medix live reliability review — October 11, 2026

## Findings and changes

The supplied Sol logs showed a correct hand-bandaging match (`fKzdiuseEIw`, 0–90 seconds), followed by rejection because the generated JSON exceeded the claim limit. That is a generation-contract failure, not evidence that no relevant video exists. Earlier `ECONNREFUSED 127.0.0.1:5001` was a frontend endpoint error; the working tunnel used port 5002. The 838/852 usable resource report demonstrates coverage, not answer accuracy.

- Greetings and identity questions now receive short deterministic responses. No answer-model or intent-classifier call is needed for these turns, and their titles are generated locally. Procedure questions beginning with greetings still enter the evidence path.
- General questions use intent classification and conversational generation. Invalid/failed classification now returns a routing error instead of silently launching retrieval or answering medical instructions without evidence. This classifier remains model-dependent; fixture tests do not establish its real-world accuracy.
- The HTTP response now includes structured claims with their original citation IDs. The frontend maps those IDs to its transcript cues and verifies the original claims instead of generating another initial draft. Existing servers without this field retain the previous two-pass behavior. Unknown citations are rejected before verification. Semantic verification, utility checks, and citation checks remain active.
- Initial-answer presentation permits the backend's five-claim contract; follow-ups retain their shorter limits. Formatting limits are distinct from evidence validation. No transcript or unsupported claim is truncated to force an answer through.
- The earlier Voyager fix allows one JSON-format repair, then rejects invalid output. It does not retry transport errors or bypass grounding checks.
- Live mode may try one alternate already-localized candidate when the first answer abstains. It does not repeat retrieval/localization. Generation remains bounded to two candidates, and the final answer retains the actual selected video's provenance. Default pipeline behavior remains one candidate; the live sbatch enables two using `MEDIX_MAX_EVIDENCE_CANDIDATES=2`.
- The live server now uses persistent text/visual feature caching via `MEDIX_FEATURE_CACHE`. This is separate from QA/evaluation output and can be reused after restart. Cache speedup has not been measured for this deployment.
- Follow-up model calls have 60-second timeouts. Transport failure messages identify unavailable evidence service/tunnel or timeout instead of asserting a lack of relevant evidence.

## Verification

All tests use local fixtures/fake models, with backend model downloads disabled. No Sol connection, submission, official test-split evaluation, or live Voyager call was made during this review.

- Backend: `uv run --no-sync python -m pytest tests -q -p no:cacheprovider` — 180 passed.
- Frontend: `node --import tsx --test tests/unit/*.test.ts` — 109 passed.
- TypeScript: `pnpm exec tsc --noEmit --incremental false` — passed.
- Ruff checks on changed backend implementation files — passed.
- Biome checks on changed frontend implementation and routing tests — passed.
- `bash -n development/ops/medix_live_backend.sbatch` and targeted diff whitespace checks — passed.

The initial frontend suite had an outdated assertion that follow-ups must use Ollama. It now checks the explicitly selected Voyager provider using a fake key without any network request. API contract tests were updated to assert the new claims field. Regression cases cover deterministic greetings, medical questions with greeting prefixes, invalid classifier output, candidate recovery and its two-candidate bound, no repeated localization during recovery, claim-ID mapping, and unknown-citation rejection.

## Existing results: no new accuracy claim

These are the user's completed validation runs (145 examples, same frozen retrieval candidates):

| Configuration | Recall@5 | Selected video | Mean IoU | IoU >= 0.5 | Mean request latency |
|---|---:|---:|---:|---:|---:|
| Full multimodal, job 65086153 | 64.1% | 33.8% | 0.1224 | 10.3% | 38.62 s |
| Top-3 visual windows, job 65086154 | 64.1% | 32.4% | 0.1136 | 9.0% | 19.30 s |
| Transcript-only, job 65086155 | 64.1% | 31.0% | 0.0945 | 6.2% | 4.06 s |

The full run preserves the strongest accuracy of these three; the alternatives trade accuracy for latency. Earlier full-run latency was 16.79 seconds, so these separate jobs do not establish a cache speedup. Frozen retrieval timing also excludes real online retrieval work. Answer-generation quality is not measured by temporal IoU. The current fixes remove redundant calls and recover selected failure cases in fixtures; there is no new measured Recall/IoU or live latency gain.

## Files in this review

Backend implementation: `backend/api/routes.py`, `backend/container.py`, `backend/services/end_to_end.py`, `backend/services/grounded_qa.py`.

Frontend implementation: `frontend/app/(chat)/api/chat/route.ts`, `frontend/lib/ai/chat-routing.ts`, `frontend/lib/ai/small-talk.ts`, `frontend/lib/ai/medical-follow-up.ts`, `frontend/lib/ai/tools/search-procedure.ts`.

Deployment: `development/ops/medix_live_backend.sbatch`.

Tests: `development/tests/test_application.py`, `development/tests/test_evaluation.py`, `development/tests/test_grounded_generation.py`, `frontend/tests/unit/chat-routing.test.ts`, `frontend/tests/unit/small-talk.test.ts`, `frontend/tests/unit/follow-up-pipeline.test.ts`, `frontend/tests/unit/search-procedure.test.ts`.

Existing unrelated changes were preserved. The archive also includes the previously prepared Voyager adapter and backend dependencies to avoid deploying only a partial patch.

## Manual deployment

Prepared archive: `/tmp/medix-live-reliability-update.tar.gz` (65 source files; no .env files, keys, media or transcripts).
SHA-256: `9ebd2a711fbb5a354a6d6b6e63d392db4e9439ec8da5f5f01e625a7b00c89e43`.

On the Mac, with the required network access:

```bash
scp /tmp/medix-live-reliability-update.tar.gz skukunu1@sol.asu.edu:~/
```

On Sol, inspect active jobs first (do not submit a duplicate live server):

```bash
squeue -u "$USER" -o "%.18i %.16j %.8T %.20N"
```

If a `medix-live` job is running, stop only that identified job before replacing its code. Never cancel evaluation jobs. The previous known live job 65133672 already timed out.

On Sol, verify and back up before extraction. Each subsequent step below is conditional on success:

```bash
cd ~/Medix &&
echo '9ebd2a711fbb5a354a6d6b6e63d392db4e9439ec8da5f5f01e625a7b00c89e43  /home/skukunu1/medix-live-reliability-update.tar.gz' | sha256sum -c - &&
BACKUP="$HOME/medix-before-reliability-$(date +%Y%m%d-%H%M%S).tar.gz" &&
tar -czf "$BACKUP" backend development/scripts/build_runtime_collection.py development/evaluation/supported_collection.py development/evaluation/__init__.py backend/config.example.yaml development/ops/medix_live_backend.sbatch &&
tar -xzf ~/medix-live-reliability-update.tar.gz &&
LIVE_JOB=$(sbatch --parsable development/ops/medix_live_backend.sbatch) &&
echo "Live job: $LIVE_JOB"
```

Watch startup on Sol:

```bash
squeue -j "$LIVE_JOB" -o "%.18i %.8T %.20N"
tail -f ~/Medix/medix-live-"$LIVE_JOB".out ~/Medix/medix-live-"$LIVE_JOB".err
```

Wait for `Application startup complete`. Use the exact Mac SSH command printed in stdout, which contains the newly allocated node. Do not assume an old node is reused. Stop the old Mac tunnel before opening the replacement. Leave the replacement tunnel open.

In another Mac terminal:

```bash
curl --fail http://127.0.0.1:5002/api/health
```

After a healthy response, restart the frontend from the main repository:

```bash
cd /Users/sairithwikk/Documents/Medix/frontend
export MEDIX_API_URL=http://127.0.0.1:5002
pnpm dev
```

## Live acceptance checks remaining

1. New chat: `Hey` and `What's your name?` — short responses, no video tool call.
2. `Explain recursion simply` — general answer without retrieval. Repeat after a medical turn to check topic switching.
3. Image plus hand-bandaging request — record video ID, response, citations and elapsed time. The earlier correct video was `fKzdiuseEIw`; do not force this ID or claim success before observing output.
4. Procedure follow-up `What should I do next?` — use the same evidence when applicable; no unsupported steps.
5. Ask a procedure absent from the retrieved evidence — a grounded refusal is expected, not a fabricated success.
6. Close the tunnel and send a procedure request — clear connection failure, not an assertion that the collection has no answer.

Remaining limits: CPU visual localization can still take tens of seconds; extra recovery can add one extraction/generation attempt. The two-hour Slurm job still expires and requires manual restart. Live inference, retrieval quality, semantic entailment, browser behavior and clinical validity are not proved by these unit tests. Preserve the official test split; evaluate any revised research configuration on validation first.
