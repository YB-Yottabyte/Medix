# Medix Backend Architecture

## Purpose

Medix is a research prototype for just-in-time medical-procedure question answering. The
backend combines semantic retrieval, transcript grounding, language generation, medical-image
analysis, local speech playback, and timestamped video results. It is not a diagnostic system or
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
GroundedMedicalQAPipeline
    │
    ├── SafetyTriageService ── scope and emergency classification
    ├── EndToEndMedicalPipeline
    │   ├── SemanticVideoRetriever ── in-memory embeddings + lexical ranking
    │   ├── temporal localization ── transcript/CLIP windows
    │   └── evidence extraction ── bounded video + transcript cues
    └── EvidenceGroundedAnswerGenerator
        ├── VoyagerStructuredAnswerModel ── qwen35-27b
        └── claim/citation/support validation

Image requests → OptionalVisionAdapter → VoyagerVisionModel
Speech playback → local Kokoro runtime
```

The major responsibilities are:

- `backend.application.MedixApplication` constructs FastAPI and registers routes and error
  handlers.
- `backend.config.AppSettings` parses and validates runtime configuration.
- `backend.container.ServiceFactory` is the composition root. It creates production dependencies
  and records capability-specific startup failures.
- `backend.api.routes` translates HTTP requests into service calls. It contains no retrieval,
  model, or prompt logic.
- `backend.services.grounded_qa.GroundedMedicalQAPipeline` coordinates evidence acquisition,
  safety assessment, generation, and abstention.
- `backend.research_pipeline.ResearchPipelineFactory` composes the current pipeline and optional
  extractive/local research baselines.
- `backend.adapters.structured_vision.StructuredVisionModel` normalizes images and validates the
  observation envelope. Images guide retrieval and are not transcript evidence.
- `backend.ports` defines the structural interfaces required by the service layer.
- `backend.adapters` owns model providers, local cache loading, transcript
  access, and response generation.

The root `app.py` is the only compatibility entrypoint. Integrations that previously lived in
separate `models` and `database` trees are consolidated under `backend/adapters`.

## Startup and Degraded Operation

Importing the application never terminates the Python process. `create_app()` always creates a
FastAPI application:

- If configuration or retrieval artifacts are unavailable, `/api/health` reports `degraded` and
  model-dependent routes return HTTP 503.
- Voyager requires `ASU_RC_API_KEY`. Vision can be explicitly disabled with
  `MEDIX_VISION_PROVIDER=disabled`; disabled image requests return HTTP 503.
- Heavy ML dependencies are imported only inside the production composition boundary. Tests can
  inject small fakes without loading models.

This distinction makes the application testable and provides useful operational diagnostics.

## Evidence and abstention

Missing retrieval results, unavailable media, or an incomplete evidence bundle produce an
abstention. Generation accepts only claims linked to transcript cues within the selected interval;
invalid citation IDs or unsupported claims are rejected. The frontend handles greetings and
Medix capability questions without procedure retrieval. Experimental retrieval thresholds must be
selected on validation data; they are not clinical safety guarantees.

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
- label-free video catalog metadata;
- transcript cache data.

Canonical video embeddings are built in memory at startup. Generated caches and local
service state are intentionally excluded from version control.
The scripts in `development/scripts/` reproduce the retrieval artifacts.

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

The default implementation calls hosted Voyager models and YouTube when a transcript is not cached.
It therefore does not yet satisfy the thesis goal of operation without a robust internet
connection. Offline model execution, a fully local transcript corpus, queueing/retry behavior,
and on-device or edge deployment remain future system work.

## Tooling Decisions

- **uv** is the only Python environment and dependency manager. `pyproject.toml` is the dependency
  source and `uv.lock` makes local development and CI reproducible.
- **Ruff** replaces separate formatter, import sorter, and lint tools.
- The backend pytest regression suite is archived outside this repository; backend CI currently
  runs lint/format checks. Frontend checks remain configured separately.
- **pre-commit** runs repository hygiene and language-specific quality checks before changes reach
  CI.
- Standard-library **Protocol** interfaces provide dependency inversion without forcing adapter
  classes into an inheritance hierarchy.

FastAPI's Pydantic models validate transport inputs and generate the OpenAPI contract. Domain
configuration remains represented by validated dataclasses so the service layer is independent
of the web framework. The explicit composition root remains the dependency-injection mechanism;
an additional container framework would add complexity without improving this object graph.

## Retired integrations

The current application has no Groq, CreateAI, or Qdrant connection. Retrieval uses local
embeddings and metadata. The unused HTML/JavaScript backend UI was removed; `frontend/` is the
website. Historic research notes and frozen outputs are retained as records, not active setup
instructions. PostgreSQL, Redis, and blob storage support separate frontend features and are
not replacements for the video-retrieval index.
