# Qwen 3.6 27B (Sol) versus Qwen 3.5 9B (local) for Grounded Generation

## Status

Reproducible engineering results from a frozen head-to-head run on August 10, 2026. Same protocol
as `medgemma_comparison.md`: identical prompts, identical EvidenceBundle cues, identical
parse → verify → render → validate pipeline, identical questions. Not evidence of clinical safety
or general model superiority. Sample: 10 follow-up questions and 2 initial questions, one
procedure domain.

**No production switch was made.** Qwen 3.5 9B remains the local medical generation model.
Qwen 3.6 27B is registered as a temporary, selectable evaluation model served from the Sol
supercomputer.

## Why Qwen 3.6 27B was tested

Qwen 3.5 9B runs locally and is the current generation model. Sol provides GPU capacity for a
3× larger model from the same family, so the question was whether scale alone improves
groundedness, citation discipline, or abstention behaviour under Medix's evidence contract.

## Setup

| | Qwen 3.5 9B | Qwen 3.6 27B |
|---|---|---|
| Identifier | `qwen3.5:9b-q4_K_M` | `qwen3.6:27b` |
| Parameters | 9.7 B | 27.8 B |
| Quantization | Q4_K_M | Q4_K_M (matched) |
| Host | local Ollama, `127.0.0.1:11434` | Sol GPU job via SSH tunnel, `localhost:11500` |

Held constant: prompts (verbatim from `lib/ai/medical-follow-up.ts`), six fixed transcript cues,
the full validation pipeline, decoding parameters, and non-thinking generation
(`reasoning_effort: "none"`) for answer-writing. Retrieval, localization, and EvidenceBundle
construction are not exercised.

**Judge caveat.** The neutral judge used previously (`llama3.1:8b`) was no longer installed, so
groundedness was scored by Qwen 3.6 27B, which is also a candidate. It grades its own output on
one arm, so the unsupported-claim row must be discounted. A clean re-run is
`ollama pull llama3.1:8b && MEDIX_JUDGE_MODEL=llama3.1:8b pnpm eval:models`.

## Results

### Follow-up pipeline

| | answered / answerable | abstained / unanswerable | parse failures | hallucinated cue IDs | unsupported claims¹ | mean words | median latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| Qwen 3.5 9B | 6 / 6 | 4 / 4 | 0 | 0 | 0 | 19 | 12.4 s |
| Qwen 3.6 27B | 6 / 6 | 4 / 4 | 0 | 0 | 0 | 23 | 10.2 s |

¹ Judge was Qwen 3.6 itself; see caveat.

A tie on every safety-critical axis. Both answered all six supported questions and abstained on
all four unsupported ones (compression rate, compression depth, no-shock-advised, adrenaline
dosing) rather than answering from parametric knowledge.

### Initial answers

| Model | Question | Words | Bold | Heading | Filler | Citations | Latency |
|---|---|---:|---:|---|---|---|---:|
| Qwen 3.5 9B | AED use | 107 | 0 | no | no | yes | 11.6 s |
| Qwen 3.5 9B | Tourniquet | 41 | 1 | no | no | yes | 6.0 s |
| Qwen 3.6 27B | AED use | 114 | 1 | no | no | yes | 6.8 s |
| Qwen 3.6 27B | Tourniquet | 43 | 1 | no | no | yes | 3.5 s |

Both satisfy the conversational formatting contract: no headings, no closing filler, sparing bold,
citations present.

### The one quality difference: a fabricated citation span

Qwen 3.5's initial AED answer merged two adjacent cues into a single citation, `[0:36–0:49]`.
The bundle contains `[0:36–0:43]` and `[0:43–0:49]`; the merged span is not a cue and does not
exist. Qwen 3.6 kept one cue per claim throughout and produced no invented span.

This matters less as a model comparison than as an architecture finding: the follow-up pipeline
would have rejected `[0:36–0:49]` because `validateFollowUpAnswer` checks every rendered timestamp
against the bundle, **but the initial-answer path has no such validator**, so the fabricated span
would have reached the user and produced a citation link to a clip range that was never localized.
Extending the cue-ID contract to the initial answer remains the highest-value pipeline change.

### Latency is confounded

Qwen 3.6 is faster despite being 3× larger, because it runs on a Sol GPU while Qwen 3.5 runs on
the local machine. These numbers compare **deployments, not models**, and cannot be used to argue
that the larger model is more efficient.

## Conclusion

**No permanent switch.** The results do not clearly favour Qwen 3.6 27B:

- Tied on answerability, abstention, parse reliability, cue-ID validity, and formatting.
- Its one genuine edge — not fabricating a merged citation span — is a single observation, and the
  defect it exposes is better fixed by adding validation to the initial path, which protects
  *whichever* model is deployed.
- The latency advantage is a property of Sol's GPU, not of the model.
- Availability is a liability: Sol depends on an SSH tunnel and a time-limited GPU job. A medical
  assistant whose generation model disappears when a job expires is worse than a slightly slower
  one that is always present.
- The groundedness comparison is compromised by the self-judging caveat.

Qwen 3.5 9B remains production. Qwen 3.6 27B stays selectable for evaluation, with the interface
degrading gracefully when the Sol session is down.

## Availability handling

`lib/ai/sol.ts` centralises the Sol configuration. Every call is bounded (3 s health probe,
120 s request); a closed tunnel, expired GPU job, or stopped server is detected and reported as
one sentence — *"The supercomputer model is currently unavailable. Please start or reconnect the
Sol session and try again."* — never a raw network error. `/api/models` probes reachability per
request so the model selector marks the entry **Session offline** and blocks selection. Falling
back to local Qwen is opt-in via `SOL_FALLBACK_TO_LOCAL=true` and off by default, because silently
rerouting a medical answer to a different model than the user selected is an operator decision.
Covered by `tests/unit/sol-availability.test.ts`.

## Reproducing

```bash
ssh -N -L 11500:<gpu-node>:11434 <user>@sol   # open the tunnel to the GPU job
cd frontend && pnpm eval:models                # defaults to qwen35,qwen36
MEDIX_EVAL_MODELS=qwen35 pnpm eval:models      # local only, no Sol needed
```
