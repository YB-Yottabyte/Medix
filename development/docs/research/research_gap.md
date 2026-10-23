# Research Gap and Questions

## Problem

People seeking just-in-time procedural information may have occupied hands, limited attention,
and an ambiguous view of the current situation. A conventional search interface requires them to
find a suitable resource and manually locate the useful segment. A language model can produce a
direct answer, but fluency alone does not show that its instructions are supported by the selected
source.

## Bounded gap

Prior MedVidQA work evaluates medical-video retrieval, visual answer localization, and
instructional-step captioning. Medical RAG work evaluates evidence retrieval for mostly
text-oriented medical QA. Egocentric procedural research and medical AR training provide
additional foundations, but they do not by themselves establish reliable, question-triggered
medical guidance.

Medix therefore investigates the narrower intersection:

> A confidence-aware multimodal RAG pipeline for retrieving timestamped medical instructional
> evidence and presenting short, traceable procedural guidance in a hands-free interface.

This wording deliberately does not claim that no related system exists, that Medix is clinically
safe, or that it improves patient outcomes.

## Research questions

### RQ1 — pipeline reliability

How accurately does Medix retrieve the relevant instructional video and answer interval for a
medical-procedure question?

### RQ1a — conversational retrieval

For context-dependent follow-up questions, does conversation-aware query contextualization improve
procedure and timestamp retrieval over retrieving with the latest user message alone, and what
latency and token cost does it add?

### RQ2 — grounding and refusal

Compared with an LLM-only baseline, does confidence-gated retrieval reduce unsupported answers
and improve appropriate refusal on unanswerable and out-of-scope questions?

### RQ2a — learned confidence architecture

For predicting whether the top retrieved procedure is correct, does a spline-based
Kolmogorov–Arnold Network improve calibration or selective-risk performance over a
parameter-matched MLP and a linear confidence model?

### RQ3 — visual context

For deliberately ambiguous questions, does adding egocentric visual context improve procedure
retrieval over question-only retrieval?

### RQ4 — user interaction

In simulated procedure-information tasks, how does the Medix interface affect information-finding
time, task-step accuracy, perceived workload, and usability compared with a conventional
instructional-video interface?

RQ1 and RQ2 are the required thesis core. RQ3 should be retained only if a defensible visual test
set can be constructed. RQ4 requires applicable institutional ethics approval before recruitment.

## Contributions that can be supported

- A reproducible, modular implementation of the pipeline.
- A benchmark protocol spanning retrieval, timestamps, refusal, grounding, and latency.
- A controlled comparison of last-turn-only and conversation-contextualized retrieval for
  procedural follow-up questions.
- A controlled comparison of LLM-only and retrieval-grounded responses.
- A controlled, leakage-safe comparison of linear, MLP, and KAN retrieval-confidence models.
- A simulation-based usability evaluation of the interaction design.
- A transparent analysis of failure modes and connectivity limitations.

## Claims that cannot currently be supported

- Clinical safety or efficacy.
- Diagnostic accuracy.
- Improved patient outcomes.
- Correct recognition of physical procedural actions.
- Fully offline operation.
- Generalization beyond the evaluated procedures and participant population.
