# Literature Matrix

## Review method

The initial review targets five connected areas: medical instructional-video QA, medical RAG,
RAG evaluation, egocentric procedural understanding, and AR-supported medical training. The
matrix distinguishes findings reported by the papers from proposed Medix work. It is not yet a
systematic review; database queries, inclusion criteria, exclusion criteria, and screening counts
must be documented before making systematic-review claims.

| Work | Contribution and evidence | Limitation relevant to Medix | Consequence for Medix |
|---|---|---|---|
| Gupta, Attal, and Demner-Fushman (2023), [MedVidQA dataset](https://doi.org/10.1038/s41597-023-02036-y) | Introduces MedVidQA and MedVidCL. MedVidQA contains 3,010 manually created questions with timestamped visual answers from 899 instructional videos. The paper benchmarks medical visual answer localization and reports that localization remains challenging. | Ground truth identifies video spans, not whether generated procedural advice is safe for real-world use. The videos are not egocentric responder recordings. | Use the official train/validation/test split for retrieval and temporal evaluation. Do not treat dataset inclusion as clinical validation. |
| Gupta and Demner-Fushman (2022), [MedVidQA shared task](https://aclanthology.org/2022.bionlp-1.25/) | Defines medical video classification and medical visual answer localization, with timestamp prediction as the visual answer. Reports multimodal and monomodal shared-task systems. | Focuses on finding an answer segment in a supplied video rather than interactive generation, refusal, or user-facing guidance. | Compare retrieval and temporal localization using established metrics rather than evaluating only response fluency. |
| Gupta and Demner-Fushman (2024), [TREC 2024 MedVidQA](https://arxiv.org/abs/2412.11056) | Extends evaluation to video-corpus retrieval plus localization and query-focused instructional-step captioning. Uses MAP, Recall@K, Precision@K, nDCG, IoU, step precision/recall/F-score, and human ratings of completeness, accuracy, and coherence. | Generated steps still require human evaluation, and the setting does not establish safe use during real emergencies. | Reuse retrieval, timestamp, step, and human-rating dimensions. Keep the user study simulation-based. |
| Lewis et al. (2020), [Retrieval-Augmented Generation](https://proceedings.neurips.cc/paper/2020/hash/6b493230-Abstract.html) | Establishes RAG as generation conditioned on explicit non-parametric memory and motivates provenance and updateable knowledge. | More factual generation on open-domain tasks does not guarantee medical faithfulness or safe procedural instructions. | Treat retrieval as evidence access, then measure whether the answer is actually supported. |
| Xiong et al. (2024), [Benchmarking RAG for Medicine](https://aclanthology.org/2024.findings-acl.372/) | Introduces MIRAGE with 7,663 questions and evaluates combinations of corpora, retrievers, and LLMs. Reports gains from medical RAG and identifies configuration effects such as lost-in-the-middle behavior. | Primarily medical knowledge QA rather than timestamped instructional-video assistance. | Report retriever, corpus, model, prompt, threshold, and top-k settings. Compare against an LLM-only condition. |
| Sohn et al. (2025), [Rationale-Guided RAG](https://aclanthology.org/2025.naacl-long.635/) | Shows that irrelevant context, poorly targeted queries, and corpus bias can weaken medical RAG; proposes filtering and rationale-guided retrieval. | Uses medical QA benchmarks rather than a constrained procedure corpus and live visual context. | Add a relevance gate before generation and study failure cases caused by partially relevant evidence. |
| He et al. (2025), [ASTRID](https://aclanthology.org/2025.findings-acl.857/) | Proposes Context Relevance, Refusal Accuracy, and Conversational Faithfulness for clinical RAG evaluation; includes emergency and out-of-domain questions. | Automated metrics do not replace expert review, and its surgical follow-up setting differs from procedural video guidance. | Make relevance, appropriate refusal, and evidence faithfulness primary evaluation dimensions. Include unsupported and emergency questions. |
| Lee et al. (2024), [Error Detection in Egocentric Procedural Task Videos](https://openaccess.thecvf.com/content/CVPR2024/papers/Lee_Error_Detection_in_Egocentric_Procedural_Task_Videos_CVPR_2024_paper.pdf) | Studies error detection in first-person procedural activity and highlights the difficulty of reasoning about procedural mistakes from egocentric video. | General procedural tasks are not medical procedures and do not validate clinical error detection. | Use egocentric images first as retrieval context. Treat automatic action correctness as future work unless annotated medical data are obtained. |
| Sun et al. (2024), [VR/AR for CPR training](https://doi.org/10.1186/s12909-024-05720-8) | Meta-analysis of nine randomized trials involving 855 participants found no significant overall difference from face-to-face CPR training on several performance measures. The authors report substantial heterogeneity. | Training effectiveness does not establish effectiveness during real emergencies or patient outcomes. | Frame the AR interface as a simulated usability intervention, not a clinically validated treatment system. |

## Synthesis

The literature supports four design decisions:

1. Evaluate video retrieval and temporal localization using established MedVidQA metrics.
2. Evaluate generation separately from retrieval; relevant context does not guarantee a faithful
   answer.
3. Include refusal and emergency/out-of-domain cases rather than measuring answer rate alone.
4. Evaluate the headset-style interface in simulation and avoid claims about patient outcomes.

The defensible intersection is a confidence-aware pipeline that combines a user question and
optional egocentric context, retrieves a timestamped instructional source, generates only after a
relevance gate, exposes provenance, and is evaluated for both technical behavior and usability.
