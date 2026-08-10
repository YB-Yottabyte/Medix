# Medix Evidence-Agreement KAN

## Proposed contribution

Medix-EAK is a selective-answering module that estimates whether independently produced evidence
signals support the same medical procedure. It is not a diagnostic model and does not generate
medical instructions. Its output is a probability that the retrieved evidence is sufficient to
permit the downstream grounded generator to answer.

The proposed contribution is the combination of:

- procedural-video retrieval signals;
- transcript-support signals;
- visual-to-procedure signals from an egocentric frame;
- explicit agreement and conflict measurements;
- a spline-based KAN confidence model; and
- conservative answer-or-abstain behavior.

The novelty claim remains provisional until the literature review and full multimodal ablation are
complete.

## Feature contract

The retrieval-only control uses eight features:

- top score, score margin, mean, standard deviation, and entropy;
- query-to-title overlap;
- candidate availability; and
- top semantic score.

The Evidence-Agreement condition adds:

- lexical, cross-encoder, transcript-support, and visual-procedure scores;
- semantic–lexical agreement;
- retrieval–reranker agreement;
- retrieval–transcript agreement;
- text–visual agreement;
- maximum disagreement among available evidence; and
- availability masks for reranker, transcript, and visual signals.

Missing evidence is represented by both a neutral numeric value and an explicit availability mask.
It must not be interpreted as disagreement.

Input records may provide optional evidence as:

```json
{
  "evidence_signals": {
    "cross_encoder_score": 0.86,
    "transcript_support_score": 0.73,
    "visual_procedure_score": 0.81
  }
}
```

## Core hypothesis

> At the same answer coverage, an Evidence-Agreement KAN will have lower selective risk and better
> probability calibration than a parameter-matched Evidence-Agreement MLP.

## Required ablations

1. Fixed top-score threshold.
2. Retrieval-only logistic model.
3. Retrieval-only MLP.
4. Retrieval-only KAN.
5. Evidence-Agreement MLP.
6. Evidence-Agreement KAN.
7. Evidence-Agreement KAN without visual features.
8. Evidence-Agreement KAN without transcript features.
9. Evidence-Agreement KAN without explicit conflict features.

Report Brier score, ECE, AUROC, average precision, AURC, risk at fixed coverage, coverage at fixed
risk, and latency. Compare paired predictions with bootstrap confidence intervals.

## Conflict benchmark

`evaluation/datasets/evidence_conflicts.json` contains structural cases for three conditions:

- aligned question and visual evidence;
- a relevant question paired with a conflicting visual source; and
- an ambiguous question paired with a potentially resolving visual source.

Every generated entry starts with `review_status: pending`. The referenced frame must be extracted
and inspected, and the question, expected disposition, and medical appropriateness must be
approved before the case enters a reported experiment. Synthetic structure is not a clinical
label.

## Current Phase-0 result

The ablation runner works with the existing retrieval records. At present those records contain
semantic and lexical evidence but no cross-encoder, transcript-support, or visual scores. The
result therefore validates the software and missing-evidence behavior; it does not test the full
multimodal hypothesis.

The next data step is to populate independently computed transcript, reranker, and visual signals
for approved train/validation cases, then freeze a separately reviewed confirmatory test set.
