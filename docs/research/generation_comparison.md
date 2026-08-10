# Evidence-Constrained Generation Comparison

## Research question

Does structured claim-level citation enforcement reduce unsupported statements in Medix answers
compared with free-form generation, while retaining useful and coherent answers?

This experiment evaluates response generation only. Every condition receives the same frozen
question, predicted video, predicted interval, and transcript cues. It does not use gold video IDs
or gold timestamps as model inputs.

## Conditions

1. **Extractive:** deterministic token-overlap selection of verbatim transcript cues.
2. **Structured Groq:** temperature-zero JSON claims with required cue IDs, followed by Medix
   citation, interval, and lexical-support validation. GPT-OSS uses Groq strict JSON Schema mode
   so provider output is schema-constrained before Medix domain validation.
3. **Free-form Groq:** the same model, temperature, question, and transcript interval without
   structured claims or citation enforcement.

The extractive condition establishes a high-provenance, low-fluency baseline. Structured versus
free-form Groq is the controlled comparison for the grounding intervention.

## Split policy

Develop prompts, validators, and the review rubric on validation only. Freeze the model, prompts,
decoding settings, rating instructions, and analysis before generating test outputs. Candidate
transcript availability is not uniform, so coverage bias must be reported separately.

Run a bounded validation pilot:

```bash
uv run python -m evaluation.run_generation_comparison \
  --split validation \
  --predictions evaluation/results/end_to_end/validation/predictions.jsonl \
  --conditions extractive,structured-groq,freeform-groq \
  --limit 5 \
  --allow-api
```

Remote execution always requires `--allow-api` and `--limit`. Test additionally requires
`--allow-test`, which should be used only after validation decisions are frozen. `--resume`
reuses only completed outputs whose condition and versioned model identity still match.
Provider or transport errors are recorded as failures. Model claims rejected by the grounding
validator are completed abstentions, preserving the method's fail-closed behavior.

## Blinded review

The runner writes:

- `predictions.jsonl`: auditable labeled outputs and provider failures.
- `summary.json`: automatic structural metrics.
- `blinded_review.json`: randomized response order without condition labels.
- `condition_key.json`: the separately stored unblinding key.

Reviewers see the question, predicted transcript interval, clip reference, and candidate answers.
They rate evidence support, relevance, completeness, and coherence from 1–5 and mark whether an
unsafe or unsupported claim is present. Review status is not a clinical validation claim.

Create separate blinded files for two reviewers:

```bash
uv run python -m evaluation.prepare_generation_review \
  --manifest evaluation/results/generation_comparison_pilot/validation/blinded_review.json \
  --reviewer-id reviewer-01 \
  --output evaluation/results/generation_comparison_pilot/reviews/reviewer-01.json

uv run python -m evaluation.prepare_generation_review \
  --manifest evaluation/results/generation_comparison_pilot/validation/blinded_review.json \
  --reviewer-id reviewer-02 \
  --output evaluation/results/generation_comparison_pilot/reviews/reviewer-02.json
```

Each reviewer fills every rating, adds notes where useful, and changes top-level `review_status`
from `pending` to `complete`. Do not give reviewers `condition_key.json`.

After both reviews are complete:

```bash
uv run --group research python -m evaluation.summarize_generation_reviews \
  --reviews \
    evaluation/results/generation_comparison_pilot/reviews/reviewer-01.json \
    evaluation/results/generation_comparison_pilot/reviews/reviewer-02.json \
  --condition-key \
    evaluation/results/generation_comparison_pilot/validation/condition_key.json \
  --output \
    evaluation/results/generation_comparison_pilot/validation/human_review_summary.json \
  --unblinded-output \
    evaluation/results/generation_comparison_pilot/validation/unblinded_ratings.jsonl
```

The summarizer rejects incomplete ratings. It reports condition summaries, paired bootstrap
confidence intervals, Wilcoxon signed-rank tests for ordinal outcomes, an exact McNemar comparison
for unsafe-claim decisions, and pairwise Cohen kappa when at least two reviewers provide enough
rating variation.

If the pilot shows poor agreement, create a condition-blinded calibration packet:

```bash
uv run python -m evaluation.build_generation_calibration \
  --manifest \
    evaluation/results/generation_comparison_pilot/validation/blinded_review.json \
  --reviews \
    evaluation/results/generation_comparison_pilot/reviews/reviewer-01.json \
    evaluation/results/generation_comparison_pilot/reviews/reviewer-02.json \
  --output \
    evaluation/results/generation_comparison_pilot/validation/calibration_disagreements.json
```

The packet includes only responses with a binary disagreement or an ordinal rating range of at
least two points. It retains raw evidence and reviewer rationales but contains no model-condition
labels. Reviewers use it to agree on rubric anchors; the discussed pilot cases become calibration
cases and must not be presented as independent final evaluation.

Before collecting ratings, agree with the advisor on reviewer qualifications, rating anchors,
adjudication, exclusion rules, primary outcome, statistical test, and minimum meaningful effect.
Use at least two independent reviewers if feasible and report inter-rater agreement.

## Interpretation boundary

Citation structure and lexical overlap cannot establish semantic entailment or medical
correctness. MedVidQA does not provide reference answer text. The principal evidence must
therefore come from blinded human ratings, with qualified clinical review for medical-safety
claims. Caregiver user testing measures usability separately and requires the university's
applicable ethics or IRB process.
