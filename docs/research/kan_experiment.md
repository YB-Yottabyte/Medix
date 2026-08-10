# KAN Confidence Experiment

## Research question

Can a Kolmogorov–Arnold Network (KAN) produce better-calibrated retrieval-confidence estimates
than a conventional multilayer perceptron (MLP) for selective medical-video question answering?

This is an empirical question. Medix must not claim that KAN is better before the frozen test
evaluation supports that conclusion.

## Hypothesis

A small spline-based KAN may capture nonlinear relationships among retrieval signals while
retaining inspectable one-dimensional edge functions. This may improve calibration and
risk–coverage behavior relative to a parameter-matched MLP.

## Experimental conditions

All models receive the same standardized features:

1. top retrieval score;
2. margin between the first and second candidates;
3. mean top-k score;
4. top-k score standard deviation;
5. normalized score entropy;
6. token overlap between the query and top candidate title;
7. fraction of available top-k candidates; and
8. top semantic score.

The compared confidence models are:

- the unmodified top retrieval score, including the current fixed `0.35` gate;
- logistic regression as the linear baseline;
- a one-hidden-layer SiLU MLP;
- a two-layer cubic B-spline KAN.

The MLP width is selected from the KAN parameter count so their capacities are approximately
matched. The models predict whether the top retrieved video is the annotated video.

## Leakage and model selection

- Use the official MedVidQA training split to fit model weights.
- Use validation data for early stopping and selection of the answer threshold.
- Run the official test split only after the method and target validation precision are frozen.
- Verify that video identifiers are disjoint across all three inputs.
- Exclude the query's own indexed `sample_id` from retrieval. Otherwise the exact evaluation
  question is present in the index and makes the task artificially easy.
- Repeat neural conditions with the same documented random seeds.

The experiment reports Brier score, expected calibration error, AUROC, average precision,
area under the risk–coverage curve (AURC), answer coverage, and selective risk. Lower Brier score,
calibration error, AURC, and selective risk are better.

## Acceptance rule

KAN should replace the fixed production gate only if it demonstrates a repeatable advantage over
both the MLP and linear baseline on calibration or selective risk, without unacceptable latency.
A null or negative result remains reportable but does not justify deploying KAN.

## Reproduction

First generate retrieval records for every split. Each output must be produced using an index that
does not expose evaluation labels to the model:

```bash
uv run python -m evaluation.build_manifest \
  --input MedVidQA/cleaned/train.json \
  --output evaluation/datasets/medvidqa_train.json
uv run python -m evaluation.build_manifest \
  --input MedVidQA/cleaned/val.json \
  --output evaluation/datasets/medvidqa_validation.json
uv run python -m evaluation.build_manifest \
  --input MedVidQA/cleaned/test.json \
  --output evaluation/datasets/medvidqa_test.json

uv run python -m evaluation.run_retrieval \
  --manifest evaluation/datasets/medvidqa_train.json \
  --output evaluation/results/retrieval_train.jsonl
uv run python -m evaluation.run_retrieval \
  --manifest evaluation/datasets/medvidqa_validation.json \
  --output evaluation/results/retrieval_validation.jsonl
uv run python -m evaluation.run_retrieval \
  --manifest evaluation/datasets/medvidqa_test.json \
  --output evaluation/results/retrieval_test.jsonl
```

Alternatively, generate all three files without a Qdrant server:

```bash
uv run --group research python -m evaluation.run_offline_retrieval
```

Install the explicitly separated research dependencies and run the comparison:

```bash
uv sync --group dev --group research
uv run --group research python -m evaluation.run_confidence_experiment \
  --train evaluation/results/retrieval_train.jsonl \
  --validation evaluation/results/retrieval_validation.jsonl \
  --test evaluation/results/retrieval_test.jsonl \
  --output evaluation/results/confidence_comparison.json
```

The JSON result retains every seed-level result as well as aggregate test statistics. Generated
results should be preserved with the thesis experiment artifacts, but metrics should not be
described as clinical-safety evidence.
