# Medix Backend Architecture

## Purpose

Medix is a research prototype for just-in-time medical-procedure question answering. The
backend combines semantic retrieval, transcript grounding, language generation, medical-image
analysis, speech transcription, and timestamped video results. It is not a diagnostic system or
a medical device.

## Design

The FastAPI backend follows a layered, object-oriented design:

```text
HTTP request
    │
    ▼
FastAPI router + Pydantic schemas
    │
    ▼
MedicalQAService (use-case orchestration)
    │
    ├── SafetyTriageService ── scope and emergency classification
    ├── RetrievalGate ── confidence decision + evidence metadata
    ├── ResponseGenerator ── AIHandler
    ├── ProcedureRetriever ── Qdrant + embedding model
    ├── MedicalImageRecognizer ── vision-language model
    └── GroqTranscriptionService ── Whisper
```

The major responsibilities are:

- `backend.application.MedixApplication` constructs FastAPI and registers routes and error
  handlers.
- `backend.config.AppSettings` parses and validates runtime configuration.
- `backend.container.ServiceFactory` is the composition root. It creates production dependencies
  and records capability-specific startup failures.
- `backend.api.routes` translates HTTP requests into service calls. It contains no retrieval,
  model, or prompt logic.
- `backend.services.medical_qa.MedicalQAService` coordinates text, video, image, voice, and
  multimodal use cases without depending on FastAPI.
- `backend.services.pipeline` owns deterministic scope triage, the validation-tunable retrieval
  gate, abstention messages, and timestamped evidence metadata.
- `backend.services.transcription.GroqTranscriptionService` isolates speech-provider and
  temporary-file handling.
- `backend.ports` defines the structural interfaces required by the service layer.
- `backend.adapters` owns model providers, local cache loading, Qdrant retrieval, transcript
  access, and response generation.

The root `app.py` is the only compatibility entrypoint. Integrations that previously lived in
separate `models` and `database` trees are consolidated under `backend/adapters`.

## Startup and Degraded Operation

Importing the application never terminates the Python process. `create_app()` always creates a
FastAPI application:

- If configuration or retrieval artifacts are unavailable, `/api/health` reports `degraded` and
  model-dependent routes return HTTP 503.
- If only the Groq vision key is unavailable, text QA can remain available while image routes
  return HTTP 503.
- Heavy ML dependencies are imported only inside the production composition boundary. Tests can
  inject small fakes without loading models.

This distinction makes the application testable and provides useful operational diagnostics.

## Evidence and abstention

Generation is not invoked when the retriever returns no procedure or when the top retrieval score
is below `safety.answer_confidence_threshold`. The response instead records an abstention reason,
the configured threshold, any retrieved source metadata, and per-stage latency. The threshold must
be selected on validation data and is not a clinical safety guarantee.

Diagnosis, prescribing, and dosage-selection questions are rejected by a deterministic
pre-retrieval scope policy. Potential emergency phrases add an escalation warning while retaining
the evidence gate. These rules are deliberately inspectable and testable; they are a research
baseline rather than a clinically validated triage mechanism.

## Dependency Direction

Dependencies point inward:

```text
FastAPI routes → use-case services → ports ← model/retrieval adapters
       │                │
       └──── config + application errors ────┘
```

Use-case services do not import FastAPI. Model and database adapters do not know about HTTP. The
application factory accepts an injected `ServiceContainer`, which is the primary test seam.

## Research Reproducibility

The repository separates:

- source MedVidQA splits in `MedVidQA/`;
- derived cleaned splits and cleaning reports;
- generated local embedding caches;
- Qdrant vector-store state;
- transcript cache data.

Generated embeddings and local service state are intentionally excluded from version control.
The scripts in `scripts/` reproduce the retrieval artifacts.

## Safety and Thesis Evaluation Gaps

Good software structure does not establish clinical safety. Before presenting the prototype as
reliable, the thesis evaluation should measure at least:

1. Retrieval recall and ranking quality on a held-out, procedure-level split.
2. Step-level faithfulness to the selected transcript.
3. Hallucination, omission, and unsafe-instruction rates under clinician review.
4. Emergency escalation sensitivity and false-positive rate.
5. End-to-end latency under constrained or intermittent connectivity.
6. Egocentric-frame robustness across lighting, motion blur, occlusion, skin tone, and device
   viewpoint.
7. Usability and cognitive load for caregivers using the target headset.

The current implementation calls hosted Groq models and YouTube when a transcript is not cached.
It therefore does not yet satisfy the thesis goal of operation without a robust internet
connection. Offline model execution, a fully local transcript corpus, queueing/retry behavior,
and on-device or edge deployment remain future system work.

## Tooling Decisions

- **uv** is the only Python environment and dependency manager. `pyproject.toml` is the dependency
  source and `uv.lock` makes local development and CI reproducible.
- **Ruff** replaces separate formatter, import sorter, and lint tools.
- **pytest + pytest-cov** provide contract, configuration, service, and coverage checks.
- **pre-commit** runs repository hygiene and language-specific quality checks before changes reach
  CI.
- Standard-library **Protocol** interfaces provide dependency inversion without forcing adapter
  classes into an inheritance hierarchy.

FastAPI's Pydantic models validate transport inputs and generate the OpenAPI contract. Domain
configuration remains represented by validated dataclasses so the service layer is independent
of the web framework. The explicit composition root remains the dependency-injection mechanism;
an additional container framework would add complexity without improving this object graph.
