# Preliminary KAN Confidence Results

## Status

These are reproducible engineering results from the first frozen comparison run on July 24, 2026.
They support continued investigation but are not evidence of clinical safety, general superiority,
or improved patient outcomes.

## Configuration

- Retrieval model: `sentence-transformers/all-MiniLM-L6-v2`
- Model revision: `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`
- Corpus: 2,714 verified MedVidQA question records
- Protocol: leave-one-question-out retrieval; the exact indexed query sample is excluded
- Splits: 2,574 train, 142 validation, and 150 test questions
- Confidence target: at least 90% precision on validation when a feasible threshold exists
- Training seeds: 7, 17, 29, 41, and 53
- Parameters: MLP 331; KAN 329

The same eight retrieval features and standardized training data were used by the logistic, MLP,
and KAN models. The test split was not used to fit weights, stop training, or choose thresholds.

## Preliminary test results

Values for learned neural models are mean ± standard deviation across five initialization seeds.

| Model | Brier ↓ | ECE ↓ | AUROC ↑ | Average precision ↑ | AURC ↓ |
|---|---:|---:|---:|---:|---:|
| Raw top score | 0.3895 | 0.4161 | 0.6736 | 0.5020 | 0.5303 |
| Logistic | 0.1609 ± 0.0010 | 0.1609 ± 0.0077 | 0.8564 ± 0.0003 | 0.7509 ± 0.0034 | 0.3745 ± 0.0018 |
| MLP | 0.1507 ± 0.0026 | **0.1259 ± 0.0056** | 0.8713 ± 0.0035 | 0.8292 ± 0.0069 | 0.3344 ± 0.0032 |
| KAN | **0.1361 ± 0.0044** | 0.1275 ± 0.0181 | **0.8909 ± 0.0062** | **0.8351 ± 0.0088** | **0.3307 ± 0.0043** |

At thresholds selected to seek 90% validation precision, the MLP found no feasible threshold and
answered no test examples. KAN answered 7.9% ± 6.0% of test examples with 6.6% ± 5.6% selective
risk. This coverage is too small and variable to support deployment.

The current fixed `0.35` top-score gate answered all 150 test examples, while only 38% of their
top retrieved videos matched the annotation. This shows that `0.35` is not calibrated for this
leave-one-question-out benchmark; it is not a clinical-error estimate.

## Paired uncertainty analysis

Predictions were averaged across the five training seeds, then 2,000 paired bootstrap resamples
of the 150 test examples were drawn. Differences below are KAN minus MLP.

| Metric | Difference | 95% bootstrap interval | Interpretation |
|---|---:|---:|---|
| Brier | -0.0157 | [-0.0266, -0.0042] | Supports better KAN calibration on this benchmark |
| AUROC | +0.0217 | [-0.0034, +0.0456] | Direction favors KAN; interval includes no difference |
| Average precision | +0.0077 | [-0.0659, +0.0702] | Inconclusive |
| AURC | -0.0051 | [-0.0337, +0.0350] | Inconclusive |

Only the Brier-score comparison has a 95% interval excluding zero. The present evidence therefore
supports the narrow statement that KAN improved probabilistic calibration in this experiment.

## Limitations and next experiment

- MedVidQA questions are cleaner than spontaneous caregiver questions.
- The target is top-video correctness, not factual correctness of generated instructions.
- Leave-one-question-out retrieval uses other annotated questions as candidate descriptions,
  rather than raw video transcripts or real egocentric observations.
- The validation and test sets contain only 142 and 150 questions.
- Repeated initialization seeds measure optimization variability, not dataset variability.
- The KAN implementation and spline hyperparameters need an ablation before architectural claims.

The next confirmatory run should use a separately frozen paraphrase/out-of-distribution question
set, include latency, and avoid changing model or feature choices based on these test results.
