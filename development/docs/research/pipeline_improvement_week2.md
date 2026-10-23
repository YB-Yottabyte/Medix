# Medix pipeline improvement experiments

## Evaluation contract

- Freeze the test split. All model/window/frame decisions in this experiment track use validation only.
- Primary localization metric: MedVidQA R@1 at temporal IoU >= 0.5.
- Secondary localization metric: mean temporal IoU; also report R@1 at IoU 0.3 and 0.7.
- Primary retrieval metric: target-video recall@5, because localization cannot recover a video missing from the candidate list. Also report recall@1 and MRR.
- Compare systems on the same question IDs. Report paired gains/losses and a deterministic question-level bootstrap interval for localization deltas.
- Keep resource coverage visible beside quality metrics. Missing transcripts/media remain failures in full-split metrics.
- These experiments use the annotated target video to isolate localization. They are not end-to-end user-pipeline results.

## What the current evidence says

The validation-only transcript-window comparison found:

| Localizer | Window | Mean IoU | R@1 IoU >= 0.5 |
| --- | ---: | ---: | ---: |
| MiniLM | 90 s | 0.2502 | 19.3% (28/145) |
| BGE large | 90 s | 0.2399 | 17.9% (26/145) |
| MiniLM | 60 s | 0.2098 | 18.6% (27/145) |
| BGE large | 60 s | 0.2267 | 22.1% (32/145) |

The experiment covered 141/145 validation questions (97.2%). MiniLM at 90 seconds wins on mean IoU; BGE at 60 seconds wins on the chosen primary threshold. This is a mixed result, not evidence that the larger encoder is a general upgrade.

The current transcript localizer returns a whole fixed-size window based on question/window embedding similarity. It does not predict the answer boundaries. The validation answer duration has a 48-second median, so choosing a 60- or 90-second window can leave substantial boundary error even when the right passage is ranked highly.

The CCAL boundary experiment completed on 2026-10-06 but was rejected on validation. It
reached mean IoU 0.0149 and R@1 IoU >= 0.5 of 0.7% (1/145), compared with 0.2502 and
19.3% for MiniLM at 90 seconds. Do not run CCAL on test or promote its checkpoint. The
implemented cycle score is calculated only after the Longformer span has been selected,
so it cannot rerank timestamps; its training reconstruction loss also consumes the gold
answer text independently of the span prediction. The run is retained as a negative result.

An earlier validation transcript-retrieval run changed recall@1 from 29.7% to 32.4%, MRR from 0.429 to 0.445, and recall@5 from 64.1% to 62.1%. Keep that candidate as a tradeoff; the paired comparison script is prepared to count exactly which questions gained and lost Top-5 coverage.

## Experiments 1–5

1. **Metric lock:** use the metric contract above before selecting a run. Compare per-question predictions with `development.evaluation.compare_localization_runs`; do not call a model “better” from rounded aggregate values alone.
2. **Boundary prediction:** train the existing CCAL span localizer on transcript-aligned training questions, rather than selecting one fixed transcript window. The training script uses `train.json` only; the new evaluator reads `val.json` only.
3. **Supervised experiment:** the frozen resource snapshot currently in this workspace has 840 transcript files. The actual CCAL example builder found 2,497 aligned training questions across 732 videos; it rejected 213 examples (75 with a cached transcript but no overlapping cue, 138 with a missing target transcript). The pinned split hash is recorded by the training checkpoint metadata. Recompute these counts on SOL before submitting if the snapshot differs.
4. **Retrieval analysis:** compare title-only and title-plus-transcript Top-5 results question by question with `development.evaluation.compare_retrieval_runs`. Do not change frozen rankings or let localization scores influence retrieval tuning.
5. **Frame reranking:** the new `development.evaluation.run_validation_multimodal_localization` compares transcript-only with transcript-plus-CLIP frame scores on validation, using the fixed 90-second/45-second candidate windows and three sampled frames. It writes validation outputs only. Run after the boundary experiment so we can tell whether frames add value beyond stronger text localization.

## Joint video-and-moment reranker

The next validation experiment replaces separate candidate selection and timestamp
localization with one pairwise cross-encoder score over `question + video title + transcript
window`. It does not alter first-stage retrieval: validation replays the exact frozen Top-5
candidate IDs and scores.

Training reads `train.json` only. It creates 30-, 60-, and 90-second transcript windows,
selects the highest-IoU training window as the positive, and pairs it with two hard negatives
from the same video and two lexical hard negatives from other training videos. Missing
transcripts and samples with no temporally overlapping window are recorded and excluded.
The MiniLM revision already used by Medix is fine-tuned with pairwise ranking loss.

Validation reads `val.json` only and reports two protocols:

- `oracle_target_video`: timestamp quality when the correct video is supplied.
- `joint_top_k`: video selection and timestamp quality across the frozen Top-5 candidates.

The test split remains unread until a validation configuration is frozen. Run
`development/ops/medvidqa_joint_moment_train.sbatch`, then
`development/ops/medvidqa_joint_moment_validation.sbatch`. Both jobs refuse to overwrite existing
versioned outputs.

## SOL run order

Sync these files to the existing `~/Medix` checkout before running:

- `development/scripts/train_ccal_localizer.py`
- `development/evaluation/run_ccal_validation.py`
- `development/evaluation/compare_localization_runs.py`
- `development/evaluation/compare_retrieval_runs.py`
- `development/evaluation/run_validation_multimodal_localization.py`
- `development/ops/medvidqa_ccal_train.sbatch`
- `development/ops/medvidqa_ccal_validation.sbatch`
- `development/ops/medvidqa_frame_reranking_validation.sbatch`

Run the jobs one at a time. Training requests one A100 under the existing course account and its `class` QoS; it has no cloud/API billing, but uses the course account's shared GPU allocation. The job refuses to overwrite its versioned checkpoint directory. First run `sbatch --test-only` on the training job, then submit only if the allocation is accepted and there is no active duplicate.

After training, run `development/ops/medvidqa_ccal_validation.sbatch`, inspect the 145-row validation output and compare it to the saved MiniLM 90-second and BGE 60-second predictions. Only if the boundary model is competitive should the frame reranking job run. Keep the test set locked until one configuration and metric are selected.

## Reproducibility details

The CCAL base models are pinned to Hugging Face revisions:

- Longformer: `allenai/longformer-base-4096@7a2d50a05513897192e79ea7c750493795d7cec0`
- BART: `facebook/bart-base@aadd2ab0ae0c8268c7c9693540e9904811f36177`

Checkpoint metadata records the training split hash, hashes of used transcript files, aligned/rejected counts, seed, model revisions, model training configuration, Python/PyTorch/Transformers versions, and runtime device.
