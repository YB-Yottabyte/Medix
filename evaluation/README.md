# Medix Evaluation

This package evaluates retrieval separately from generation and user-interface outcomes.

## Paper-faithful temporal-localization benchmark

The official `MedVidQA/train.json`, `val.json`, and `test.json` files are the immutable benchmark.
Runtime YouTube availability filtering and derived cleaned files must not change this benchmark.
The loader verifies the paper's 2,710/145/155 question counts, 800/49/50 video counts, and
video-disjoint partitions.

Run deterministic Random Mode and Random Guess baselines with:

```bash
uv run python -m evaluation.run_temporal_baselines
```

These baselines implement the paper's stated procedures, but exact random results can differ
because the paper and released code do not publish the random seed. Learned localization models
must implement `backend.temporal_localization.TemporalLocalizer`. The annotation oracle is located
under `evaluation` and may be used only to test pipeline wiring.

For the later video preprocessing stage, Medix will use TorchCodec because it performs
FFmpeg-backed exact timestamp decoding directly into PyTorch tensors. A visual backbone such as
VideoMAE can then consume those tensors without a NumPy/OpenCV conversion layer.

## Open-corpus retrieval extension

Build an immutable retrieval manifest from the official MedVidQA test split:

```bash
uv run python -m evaluation.build_manifest
```

After the retrieval cache and Qdrant collection are available, run:

```bash
uv run python -m evaluation.run_retrieval \
  --manifest evaluation/datasets/medvidqa_test.json \
  --output evaluation/results/retrieval.jsonl
```

For a reproducible research run that does not require Qdrant, the offline evaluator applies the
same normalized semantic similarity and lexical blend directly to the verified corpus:

```bash
uv run --group research python -m evaluation.run_offline_retrieval
```

Summarize it with:

```bash
uv run python -m evaluation.summarize \
  --predictions evaluation/results/retrieval.jsonl
```

The manifest builder copies only identifiers, questions, expected video IDs, and annotated
intervals. Do not modify the test set or tune thresholds from its results. Choose configuration
and confidence thresholds using the validation split, freeze them, and then run the final test.
The current question-level retrieval runner is retained as a legacy baseline. Excluding only the
query's own `sample_id` does not prevent another expert-authored question from the same held-out
video from being retrieved. Its existing outputs must not be described as leakage-free video
retrieval.

Build the separate one-document-per-video catalog from public YouTube metadata:

```bash
uv run python -m scripts.build_video_catalog
```

Then run the title-and-author retrieval baseline:

```bash
uv run --group research python -m evaluation.run_video_retrieval
```

The catalog builder uses the MedVidQA files only to enumerate video IDs, source URLs, and
durations. Its persisted documents contain no expert questions, sample IDs, or answer timestamps.
The evaluator ranks against the global available-video catalog and measures video retrieval only;
temporal localization remains a separate downstream task. Because the MedVidQA paper assumes that
the correct video is already given, this is a Medix system extension rather than a paper baseline.

## Transcript-window temporal localization

Cache timestamped transcripts for the validation and test videos:

```bash
uv run python -m scripts.cache_medvidqa_transcripts
```

Then tune fixed transcript-window duration on validation and evaluate once on test:

```bash
uv run --group research python -m evaluation.run_transcript_localization
```

The localizer embeds timestamped transcript windows and selects the window most similar to the
question. It does not index expert questions or answer boundaries. Missing transcripts remain
zero-IoU predictions in full-split metrics; covered-only metrics are reported as diagnostics.
This is a text-only localization baseline for the later transcript-plus-visual model, not the
proposed final Medix method.

## Transcript-plus-visual localization

Cache low-resolution copies of transcript-covered validation and test videos:

```bash
uv run python -m scripts.cache_medvidqa_videos --splits val test
```

Then tune transcript/visual fusion weight on validation and evaluate the frozen configuration:

```bash
uv run --group research python -m evaluation.run_multimodal_localization
```

FFmpeg samples three frames per transcript window and pinned CLIP scores question-to-frame
similarity. The evaluator compares visual-only reranking and multiple fusion weights, selects only
on validation, and runs the selected configuration once on test. Missing local videos fall back
to transcript-only localization. Full-split, visual-covered, transcript-only matched-subset, and
random matched-subset results are all retained so coverage cannot be mistaken for model quality.
Downloaded videos and transcripts are generated local caches and are excluded from version
control.

## Evidence bundle extraction

Create transcript, frame, clip, hash, score, and provenance bundles from the frozen multimodal
test predictions:

```bash
uv run --group research python -m evaluation.run_evidence_extraction
```

Evidence artifacts are content-addressed where possible: questions that select the same
video interval reuse the same clip and timestamped frames. Bundle manifests never contain gold
answer timestamps; the evaluator reports full-split coverage, extraction success among localized
samples, failure reasons, and clip-duration alignment error. Generated media under
`evaluation/artifacts/` is excluded from version control.

## End-to-end retrieval, localization, and evidence

Generate validation and test video-retrieval predictions, then populate candidate evidence from
the retrieved video IDs rather than the gold target IDs:

```bash
uv run --group research python -m evaluation.run_video_retrieval --split validation
uv run --group research python -m evaluation.run_video_retrieval --split test

uv run python -m scripts.cache_medvidqa_transcripts \
  --retrieval-predictions \
  evaluation/results/video_retrieval_validation.jsonl \
  evaluation/results/video_retrieval_test.jsonl \
  --candidate-only

uv run python -m scripts.cache_medvidqa_videos \
  --retrieval-predictions \
  evaluation/results/video_retrieval_validation.jsonl \
  evaluation/results/video_retrieval_test.jsonl \
  --candidate-only
```

Run the OOP orchestrator on validation for each planned retrieval/localization weight, select only
from validation summaries, and then run test once with the selected weight:

```bash
uv run --group research python -m evaluation.run_end_to_end_pipeline \
  --split validation --retrieval-weight 0.0

uv run --group research python -m evaluation.run_end_to_end_pipeline \
  --split test --retrieval-weight 0.0
```

The orchestrator retrieves top-K videos, localizes every candidate with available evidence,
selects by joint score, extracts an evidence bundle, and abstains when no candidate can be fully
grounded. Candidate transcript acquisition must be reported separately: YouTube caption
availability and pre-existing cache composition can otherwise create an availability bias. The
current candidate-coverage experiment is exploratory until evidence is acquired uniformly, for
example by downloading candidate audio and running the same offline ASR model for every video.

## Evidence-constrained response generation

Run the deterministic extractive baseline over persisted end-to-end bundles:

```bash
uv run python -m evaluation.run_grounded_generation \
  --split validation \
  --predictions evaluation/results/end_to_end/validation/predictions.jsonl

uv run python -m evaluation.run_grounded_generation \
  --split test \
  --predictions evaluation/results/end_to_end/test/predictions.jsonl
```

`EvidenceGroundedAnswerGenerator` accepts only structured claims with transcript cue IDs. Unknown
or missing citations fail closed, and the displayed response is assembled from validated claims
rather than unrestricted model prose. `ExtractiveEvidenceAnswerModel` is the reproducible offline
baseline; `GroqStructuredEvidenceAnswerModel` supplies the same contract for later LLM experiments.
The Groq path is not used in the frozen offline benchmark and must be evaluated separately.

MedVidQA has annotated temporal segments but no reference answer text. Citation validity and
verbatim extractiveness therefore establish provenance only; they do not measure clinical
correctness, semantic entailment, completeness, or usability. Those claims require a reviewed
answer set, blinded human evaluation, and eventual caregiver user testing.

Run the controlled, same-evidence generation comparison offline with:

```bash
uv run python -m evaluation.run_generation_comparison \
  --split validation \
  --predictions evaluation/results/end_to_end/validation/predictions.jsonl \
  --conditions extractive
```

Adding `structured-groq` or `freeform-groq` requires both `--allow-api` and an explicit `--limit`.
The runner writes a condition-labeled audit file, structural summary, blinded review manifest, and
separate unblinding key. See `docs/research/generation_comparison.md` before collecting ratings.
Use `evaluation.prepare_generation_review` for reviewer-specific copies and
`evaluation.summarize_generation_reviews` only after every rating is complete.

`datasets/refusal_cases.json` is an initial software-behavior set. Its labels require advisor and,
for medically meaningful safety claims, qualified clinical review.

## KAN versus MLP confidence experiment

The confidence experiment consumes frozen retrieval JSONL files rather than querying the vector
store during model training. This keeps retrieval fixed across all three model conditions:

```bash
uv sync --group dev --group research
uv run --group research python -m evaluation.run_confidence_experiment \
  --train evaluation/results/retrieval_train.jsonl \
  --validation evaluation/results/retrieval_validation.jsonl \
  --test evaluation/results/retrieval_test.jsonl
```

See `docs/research/kan_experiment.md` for the hypothesis, features, split policy, metrics, and
acceptance rule. Do not tune from the test results or describe KAN as better than MLP before the
comparison supports that statement.

## Evidence-Agreement ablation

Run both the retrieval-only and expanded Evidence-Agreement profiles from the same frozen records:

```bash
uv run --group research python -m evaluation.run_evidence_ablation \
  --train evaluation/results/retrieval_train.jsonl \
  --validation evaluation/results/retrieval_validation.jsonl \
  --test evaluation/results/retrieval_test.jsonl
```

The expanded input accepts optional `cross_encoder_score`, `transcript_support_score`, and
`visual_procedure_score` values under each record's `evidence_signals` object. Availability masks
prevent absent modalities from being treated as conflicting evidence.

Create the pending-review conflict manifest with:

```bash
uv run python -m evaluation.build_conflict_manifest
```

Generated conflict cases are not approved labels. Inspect the referenced frames and obtain the
required domain/ethics review before reporting results from them.
# Supported collection and CCAL localization

The learned-localization experiments must distinguish model failures from
missing local media. Build the deterministic supported collection first:

```bash
uv run python -m scripts.build_supported_collection
```

This writes a detailed, gold-bearing evaluation manifest under
`evaluation/results/supported_collection/manifest.json` and a separate
label-free runtime allowlist at `data/supported_video_collection.json`.
Conditional supported-subset metrics must not be presented as full official
MedVidQA metrics.

The CCAL implementation keeps the application pipeline unchanged and replaces
only the `TemporalLocalizer` strategy. Training reads transcript-covered
examples from the official **training split only**; local video is not required
for the text-based CCAL objective. Training is deliberately refused when fewer
than 100 aligned training examples are present:

```bash
uv run python -m scripts.train_ccal_localizer
```

After a complete checkpoint exists at `data/models/ccal`, evaluate it with:

```bash
uv run python -m evaluation.run_ccal_localization
```

Then set `research_pipeline.localizer_strategy: ccal` to use that checkpoint
inside the canonical v2 pipeline. A missing or incomplete checkpoint makes v2
unavailable; Medix never substitutes untrained weights or silently falls back
to a baseline.
