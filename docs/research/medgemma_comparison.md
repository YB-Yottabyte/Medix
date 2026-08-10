# MedGemma 1.5 4B IT versus Qwen 3.5 9B for Grounded Generation

## Status

Reproducible engineering results from a frozen head-to-head run on August 9, 2026. They record a
model-selection decision for the Medix generation stage. They are not evidence of clinical safety,
general model superiority, or improved patient outcomes. The sample is a smoke test, not a
benchmark: 10 follow-up questions and 2 initial questions over a single procedure domain (AED use,
plus one tourniquet item). No clinician rated any output.

MedGemma was evaluated and **not promoted**. Qwen 3.5 9B remains the only local medical generation
model in Medix. MedGemma has been removed from the selectable model configuration; the evaluation
harness is retained so the experiment can be re-run.

## Why MedGemma was tested

Medix generates medical guidance on a local model under an evidence-grounded contract: the model
may use only the transcript cues of the active EvidenceBundle, must select cues by ID, and must
emit structured JSON that the application validates before anything reaches the user. Qwen 3.5 9B
is a general instruction-tuned model filling that role.

MedGemma 1.5 4B IT is a medical-domain-tuned model, so the hypothesis was that domain tuning would
improve medical guidance quality. The counter-hypothesis, which the results support, is that
domain knowledge is the wrong axis for this architecture: Medix deliberately *forbids* parametric
medical knowledge, so a medical model's advantage is suppressed by design, while the binding
constraints — schema compliance and citation discipline — are general instruction-following
capabilities where a 4B model is weaker than a 9B one.

A secondary motivation was cost: 4B would roughly halve resident memory versus 9B.

## Setup

| | Qwen 3.5 9B | MedGemma 1.5 4B IT |
|---|---|---|
| Identifier | `qwen3.5:9b-q4_K_M` | `hf.co/unsloth/medgemma-1.5-4b-it-GGUF:Q4_K_M` |
| Parameters | 9.7 B | 4 B |
| Quantization | Q4_K_M | Q4_K_M (matched) |
| Runtime | Ollama, OpenAI-compatible endpoint | identical |

Controlled so that only the generating model varies:

- Identical system prompts, taken verbatim from `lib/ai/medical-follow-up.ts`.
- Identical EvidenceBundle: six fixed transcript cues with clip-relative timestamps. Retrieval,
  localization, and bundle construction are not exercised — cues are held constant.
- Identical downstream pipeline: `parseSemanticAssessment` → `parseGroundedClaims` →
  `parseClaimVerification` → `renderGroundedClaims` → `validateFollowUpAnswer`. Timestamps are
  resolved by application code from cue IDs, never by the model.
- Identical decoding: `temperature` 0 for assessment and verification, 0.1 for generation,
  `maxOutputTokens` 1200, reasoning disabled where the model permits it.
- Groundedness scored by a **neutral third model**, `llama3.1:8b`, so that neither candidate
  grades itself or its own family.

Follow-up items are split into six `answerable` questions covered by the bundle and four
`unanswerable` questions that are not (compression rate, compression depth, the no-shock-advised
branch, adrenaline dosing). The unanswerable set is the abstention probe: it measures whether a
model answers from parametric medical knowledge when the evidence does not support an answer,
which is the failure mode a medical-domain model is most prone to.

## Two harness defects corrected before the reported run

An initial run scored MedGemma 0/6. That result was **invalid** — both causes were defects in
Medix, not in the model, and both were fixed for all models before the reported run.

1. **JSON extraction.** The payload extractor matched greedily from the first brace to the last.
   MedGemma emits a `thought` prose preamble and then repeats the JSON block twice, so the match
   spanned two objects and never parsed. Replaced with a balanced-brace scanner that returns the
   last parseable object.
2. **Enum placeholder convention.** Prompts specified fields as `"a|b|c"`. MedGemma copied the
   option list literally as the value (`"relation":"continue_to_use_evidence|no_retrieval_needed|…"`),
   which validation correctly rejected. Prompts now state "EXACTLY ONE of" with a well-formed
   example. Qwen was unaffected either way.

Both fixes are retained in production because they make the contract unambiguous for any model.
Recording this here matters for the thesis: the first result was an artifact of prompt formatting,
and reporting it would have been wrong.

## Results

### Follow-up pipeline

| | answered / answerable | abstained / unanswerable | parse failures | unsupported claims | median latency |
|---|---:|---:|---:|---:|---:|
| Qwen 3.5 9B | **6 / 6** | 4 / 4 | **0** | 3 | **11.8 s** |
| MedGemma 1.5 4B | 5 / 6 | 4 / 4 | 3 | 2 | 33.1 s |

MedGemma's abstention score is **inflated and should not be read as judgement**: two of its four
abstentions were parse failures, not reasoned refusals. Qwen's four were all reasoned — it
classified the evidence as insufficient and deferred. On the one answerable item MedGemma lost, it
also failed to parse, so the loss is a schema failure rather than a reasoning failure.

MedGemma additionally leaked internal vocabulary into user-facing text on the shock-safety item:
*"The cue advises standing clear before the shock, implying touching is unsafe during the shock"*.
Referring to "the cue" exposes the grounding layer and reads as hedged inference rather than
guidance. Qwen answered directly.

### Initial answers

| Model | Question | Words | Citations present | Unsupported claims | Latency |
|---|---|---:|---|---:|---:|
| Qwen 3.5 9B | AED use | 103 | **yes** | 0 | 19.8 s |
| Qwen 3.5 9B | Tourniquet | 83 | **yes** | 0 | 16.2 s |
| MedGemma 1.5 4B | AED use | 82 | **no** | 0 | 9.1 s |
| MedGemma 1.5 4B | Tourniquet | 43 | **no** | 1 | 6.6 s |

**MedGemma emitted no timestamp citations in either initial answer.** For Medix this is
disqualifying: the citation is the user's link back to the EvidenceBundle and the moment in the
video, and it is what the validator checks. MedGemma also opened with preamble — *"I can confirm
that…"*, *"The evidence states that…"* — which the response-style rules forbid.

### Latency

MedGemma is faster per token on single-shot generation (6.6–9.1 s versus 16.2–19.8 s), consistent
with 4 B versus 9.7 B parameters. It is nevertheless **2.8× slower end-to-end on the follow-up
pipeline** (33.1 s versus 11.8 s median). The cause is that MedGemma always emits a `thought`
reasoning preamble in the content channel and offers no way to disable it, so its token count is
inflated across all three pipeline calls. Qwen accepts `reasoning_effort: "none"` and answers
directly.

## Conclusion

**MedGemma 1.5 4B IT was not promoted.** Qwen 3.5 9B better matches Medix's requirements on the
two axes that actually bind:

- **Structured-output reliability.** 0 parse failures versus 3. Every MedGemma parse failure
  becomes a user-visible deferral, so schema compliance is directly a coverage metric.
- **Citation compliance.** 2/2 initial answers cited versus 0/2. An uncited answer breaks the
  evidence-grounding guarantee that is the point of the system.

Latency reinforces the decision for the multi-call follow-up path, where MedGemma is 2.8× slower
despite being smaller.

The broader finding is that **medical-domain tuning is orthogonal to what Medix needs.** The
architecture forbids parametric medical knowledge and enforces grounding through structured output
and cue-ID validation, so a domain-tuned model's advantage is suppressed by construction while its
weaker instruction-following is fully exposed. Future model selection for this stage should
prioritise schema adherence and citation discipline over medical benchmark scores.

## Threats to validity

- Twelve questions in one procedure domain. Not powered to detect small differences.
- Unsupported-claim counts come from an 8 B judge model, not clinicians; they are indicative only.
- Only Q4_K_M quantization was tested. A higher-precision MedGemma build may follow schemas better.
- MedGemma 1.5 4B was tested; `medgemma:4b` (the non-1.5 Ollama library build) and MedGemma 27B
  were not.
- Latency was measured on one machine with no warm-up control or repeated trials.

## Reproducing

The harness is retained at `frontend/tests/eval/model-comparison.ts` and pins the MedGemma
identifier locally, so it runs unchanged even though MedGemma is no longer a selectable model.

```bash
ollama pull hf.co/unsloth/medgemma-1.5-4b-it-GGUF:Q4_K_M
ollama pull qwen3.5:9b-q4_K_M
ollama pull llama3.1:8b            # neutral judge
cd frontend && pnpm eval:models
```

Related prompt-level experiments live alongside it: `followup-style-eval.ts` and
`initial-answer-style-eval.ts` (`pnpm eval:style`).
