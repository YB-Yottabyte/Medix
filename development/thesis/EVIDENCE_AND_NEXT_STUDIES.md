# Medix paper: evidence audit and next studies

This file accompanies `medix-paper.tex`. The course PDF supplied by the user specifies an
eight-page maximum excluding references/appendices, the ACM SIGKDD conference template, and the
eight section headings used in the draft. Its additional group-work and course-administration
rules are properties of that assignment, not instructions from the user. The PDF also says that
course submissions using generative AI must disclose that use and include the full interaction
trace; the author should check the current syllabus before submitting.

## Claim-to-evidence map

| Paper claim | Evidence | Boundary |
|---|---|---|
| 2,710/145/155 questions; 800/49/50 disjoint videos | `MedVidQA/{train,val,test}.json`; `evaluation/medvidqa_dataset.py` | Official source splits, not cleaned derivatives. |
| 852-video title/author catalog; 47 unavailable | `data/medvidqa_video_catalog.json`; `evaluation/video_catalog.py` | Source metadata availability changes over time. |
| Retrieval Recall@1 0.2968, Recall@5 0.5677, MRR 0.4041 | `evaluation/results/video_retrieval_test.summary.json`; `evaluation/run_video_retrieval.py` | Catalog coverage bounds recall at 0.9226. |
| Known-video transcript/visual localization | `evaluation/results/{transcript_localization,multimodal_localization}/summary.json` and paired JSONL predictions | Gold video is provided to these diagnostics. Visual matched subset has 67 questions, 19 videos. |
| Selected end-to-end weight 0.0; 56 bundles, 27 correct videos, 8 IoU>=0.5 | `evaluation/results/end_to_end/model_selection.json`, `end_to_end_weight_000/validation/summary.json`, `end_to_end/test/{summary.json,predictions.jsonl}` | A separate validation output under `end_to_end/validation` has weight 0.5 and must not be described as the selected run. |
| Extractive 54 answers, 148 valid/verbatim claims | `evaluation/results/grounded_generation/test/summary.json`; `backend/generation/extractive.py` | Structural provenance only; no reference answer or clinician correctness rating. |
| Exploratory KAN Brier difference | `evaluation/results/confidence_comparison.json`; `docs/research/preliminary_kan_results.md`; `evaluation/run_offline_retrieval.py` | Question-level indexed candidates; other expert questions from the same video can remain. This is separate from title/author video retrieval. |
| Video-clustered uncertainty and error contingency | `thesis/derive_results.py` and `thesis/derived_results.json` | 10,000 paired percentile resamples, fixed predictions and media cache. |

The audit found no `.ipynb` notebooks or saved research plots in the repository. The front end
contains fixed-bundle model-selection harnesses and unit tests, but these do not provide a
held-out user, egocentric, or clinical evaluation. The CCAL localizer has no reportable checkpoint
or results; only six training questions meet the supported-collection requirements, below its
default minimum of 100. The five-case generation review is a calibration pilot. The two
reviewers disagree sharply on some outcomes and their qualifications are not documented; its
ratings should not be used as a safety estimate.

## Exact literature searches and citation insertion points

Search primary papers in **ACL Anthology**, **ACM Digital Library**, **IEEE Xplore**, **CVF Open
Access**, **PubMed**, and the official **TREC/NIST** proceedings. Record query, date, screening
criteria, and a citation matrix before claiming novelty. Recommended exact searches:

1. `"medical video question answering" "visual answer localization" transcript` and
   `"MedVidQA" corpus retrieval localization` — compare with MedVidQA 2022, original dataset,
   and TREC 2024. Cite any statement in Related Work about prior task definitions, baseline
   methods, or direct numerical comparisons. Do not compare distinct test collections as if
   scores were interchangeable.
2. `"medical instructional video" question answer generation evidence citation` and
   `"first aid" video retrieval question answering grounding` — establish whether an earlier
   system already combines retrieval, temporal citations, and generation. Cite before any
   Introduction or Conclusion novelty claim; the present draft makes none.
3. `"medical retrieval augmented generation" refusal faithfulness human evaluation` and
   `"clinical RAG" answerability context relevance` — locate primary work on abstention and
   evidence-grounded response evaluation. Cite the Related Work distinction between context
   relevance, refusal, and faithfulness and the Discussion rationale for expert assessment.
4. `"egocentric" procedural assistance "medical" augmented reality evaluation` and
   `"first person" procedure video error detection` — determine what visual context and
   hands-free guidance studies actually test. Cite before discussing any benefit or gap for
   headset or live egocentric use; Medix has not evaluated those outcomes.
5. `"selective prediction" retrieval augmented generation calibration risk coverage` and
   `"Kolmogorov Arnold network" calibration tabular classification` — establish appropriate
   confidence baselines and whether KAN offers documented calibration benefits. Cite before
   interpreting any architecture-level effect from the preliminary Medix experiment.

The bibliography in `references.bib` contains only works whose title/venue/DOI or official paper
page was checked. Verify final BibTeX metadata and page numbers before submission. A source
for the specific pretrained MiniLM and CLIP checkpoints should be added if the methods section
is expanded to discuss their training or expected transfer performance; only model identity is
claimed now. A formal literature search is still missing, so the Related Work section is
necessarily selective.

## Prioritized missing evidence

1. **Complete acquisition and baselines:** Apply the same transcript acquisition method to all
   candidate videos; add BM25, dense-only, title-only, and retrieval-rank-one selection. Freeze
   all choices on validation. Report acquisition failures and answerability separately.
2. **Ablations:** Remove visual reranking, transcript score, lexical blend, and evidence gate one
   at a time on the same questions and videos. Populate genuinely independent reranker,
   transcript-support, and visual signals before calling an experiment multimodal
   evidence-agreement.
3. **Statistics:** Use paired video-clustered bootstrap intervals for retrieval, localization,
   and end-to-end contrasts. For ordinal human ratings, predefine the primary endpoint, use
   a paired test, report effect size and uncertainty, and give inter-rater agreement plus
   adjudication. A pilot used to refine a rubric cannot double as a confirmatory test.
4. **Answer quality:** Build a clinician-reviewed set with supported, partially supported,
   unsupported, and out-of-scope questions. Rate evidence entailment, omission of critical
   steps, unsafe advice, relevance, and appropriate refusal under blinded, same-evidence
   conditions. The repository has no basis yet for a clinical safety claim.
5. **Figures and tables:** Add a stage-flow figure with full denominators; paired visual-vs-text
   IoU difference plot by video; risk-coverage and calibration plots for confidence models;
   failure-mode table separating unavailable media from wrong ranking/localization. Every
   figure should identify split, subset, and uncertainty method.
