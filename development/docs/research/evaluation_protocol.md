# Technical Evaluation Protocol

## Objective

Freeze and evaluate the QA pipeline before the user study. The technical experiment must be
reproducible from a versioned configuration, dataset manifest, and raw result file.

## Experimental conditions

1. **LLM-only:** question without retrieved procedure context.
2. **Text RAG:** question, procedure retrieval, transcript context, and generation.
3. **Confidence-gated text RAG:** text RAG with abstention below a validation-selected threshold.
4. **Conversational RAG:** confidence-gated RAG with a standalone-query contextualization stage
   for ambiguous follow-up turns.
5. **Multimodal RAG:** question plus egocentric image context, retained only if an annotated visual
   test set is available.

Use the same generation model and decoding settings across conditions where possible. Record any
condition where this is impossible.

## Dataset partitions

- Use MedVidQA training data to build retrieval artifacts.
- Use validation data to select retrieval, lexical-weight, top-k, and abstention thresholds.
- Use test data once for the final reported comparison.
- Add a separately labeled refusal set containing out-of-scope, dosage/prescribing, insufficient
  context, and simulated emergency-language examples.
- Add a multi-turn set containing pronoun references, “what next” questions, stage references,
  topic switches, and already-standalone later turns. Store the gold standalone query and expected
  video/interval for each evaluated turn.
- Prevent the same video from leaking across custom training and evaluation partitions.

## Required result record

Each run should emit JSON Lines with:

```json
{
  "run_id": "text-rag-001",
  "sample_id": "42",
  "condition": "confidence-gated-text-rag",
  "query": "How should this wound be dressed?",
  "expected_video_id": "example",
  "expected_start": 30,
  "expected_end": 75,
  "predicted_video_id": "example",
  "predicted_start": 32,
  "predicted_end": 74,
  "retrieval_score": 0.71,
  "threshold": 0.35,
  "status": "answered",
  "response": "Generated response",
  "evidence": [],
  "retrieval_ms": 120,
  "generation_ms": 850,
  "total_ms": 970
}
```

Do not place participant identifiers, uploaded images, audio, or unredacted personal medical
information in experiment logs.

## Metrics

### Retrieval

- Recall@1 and Recall@5 for the expected video.
- Mean reciprocal rank.
- nDCG when graded relevance judgments are available.

### Conversational retrieval

- Standalone-query fidelity: whether the rewrite preserves the gold procedure, stage, and user
  intent without adding unsupported details.
- Recall@1/5 and mean reciprocal rank for follow-up turns, comparing last-turn-only retrieval with
  conversation-contextualized retrieval.
- Topic-switch error rate and the rate at which already-standalone questions are unnecessarily
  rewritten.
- Added rewrite latency and input/output tokens per follow-up.

### Temporal localization

- Intersection over Union between predicted and annotated intervals.
- Accuracy at IoU thresholds 0.3, 0.5, and 0.7.

### Generated steps

- Required-step precision, recall, and F1.
- Completeness, accuracy, and coherence using a documented human rubric.
- Unsupported-claim rate against the retrieved transcript.

### Safety and refusal

- Refusal precision, recall, and F1.
- Emergency-warning recall on the labeled simulated-emergency set.
- Answer coverage, reported alongside refusal accuracy.

### System performance

- Median and 95th-percentile retrieval, generation, and total latency.
- Failure rate by pipeline stage.
- Online dependency failure behavior.

## Threshold selection

The configured answer threshold is an experimental parameter, not a clinical safety boundary.
Sweep candidate thresholds on validation data and report the tradeoff between answer coverage and
incorrect-answer/refusal rates. Freeze the selected value before evaluating the test set.

## Human review

Use at least two independent reviewers for the manually scored subset when feasible. Define the
rubric before reviewing system identities, randomize response order, and report inter-rater
agreement. Clinical review is strongly preferred for safety claims.

## User-study boundary

The subsequent user study should measure interaction with simulated tasks. It must not ask
participants to provide care to real patients or represent Medix as clinically validated.
