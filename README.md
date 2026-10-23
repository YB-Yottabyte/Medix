# Medix

Medix is a research prototype for medical procedure question answering. It uses the MedVidQA dataset, semantic retrieval, Voyager-hosted Qwen text and vision models, YouTube transcript grounding, and a FastAPI web service to return step-by-step answers with relevant video segments.

This project is for educational and research use only. It is not a medical device and must not replace professional medical care or emergency services.

## What It Does

- Answers medical procedure questions with retrieval-augmented generation.
- Finds relevant MedVidQA video segments and timestamps.
- Fetches and caches YouTube transcripts so answers can be grounded in video content.
- Supports text queries, validated image observations, browser voice input, and local speech playback.
- Includes scripts for cleaning MedVidQA data, verifying YouTube videos, building embeddings, and preparing the video catalog.

## Project Layout

```text
.
├── frontend/                 # Medix website and chat interface
├── backend/                  # API, evidence pipeline and runtime config
├── data/                     # Runtime catalogs, transcripts and video caches
├── MedVidQA/                 # Source dataset
├── development/              # Supporting research and maintenance tools
├── app.py                    # Main backend entrypoint
├── pyproject.toml            # Python dependencies and tool configuration
├── uv.lock                   # Locked Python dependencies
├── README.md
└── LICENSE
```

Provider and storage integrations are consolidated under `backend/adapters/`. The previous root-level forwarding packages and duplicate backend integration folders have been removed.

## Backend Architecture

The backend uses a layered application design:

```text
FastAPI routes and Pydantic schemas
      ↓
GroundedMedicalQAPipeline
      ↓
video retrieval → temporal localization → evidence extraction
      ↓
Voyager structured generation → citation/support validation
```

`create_app()` constructs FastAPI, `ServiceFactory` creates production dependencies, and `ServiceContainer` makes dependencies explicit and replaceable in tests. Routes only handle HTTP input/output; multimodal orchestration lives in the service layer. FastAPI exposes interactive OpenAPI documentation at `/docs`. See [development/docs/ARCHITECTURE.md](development/docs/ARCHITECTURE.md) for the design rationale, dependency flow, degraded-startup behavior, and thesis evaluation gaps.

## Python Environment with uv

- [uv](https://docs.astral.sh/uv/) manages Python, the project environment, dependencies, and the lockfile.
- A server-side ASU Research Computing Voyager key for Qwen text generation and image observations.
- FFmpeg for extracting timestamp-bounded evidence clips.

Create or update the environment exactly from `uv.lock`:

```bash
uv sync --frozen --group dev
```

Do not manually activate `.venv` or use `pip install` for this project. Prefix Python tools with
`uv run`; uv selects the version in `.python-version` and maintains the environment automatically.

Copy the tracked example to a local `backend/config.yaml`. The local file is intentionally gitignored.

```bash
cp backend/config.example.yaml backend/config.yaml
```

Use `research_pipeline.answer_model: structured_voyager` and `MEDIX_VISION_PROVIDER=voyager`.
Copy `backend/.env.example` to `backend/.env` only for a new setup; preserve existing local credentials.
Set `ASU_RC_API_KEY` in that private file. The model defaults to `qwen35-27b`.

The extractive, Ollama, and Sol answer modes remain optional research baselines.
Groq and CreateAI connectors have been retired; Qdrant is not required.

Spoken responses use the optional local Kokoro-82M runtime. Install it with
`uv sync --frozen --extra speech --group dev` before using Listen. The first Listen request
downloads and caches approximately 363 MB of model and voice files; subsequent
requests reuse that cache. Optional speech settings are `KOKORO_VOICE`
(default `af_heart`), `KOKORO_LANG_CODE` (default `a`, American English), and
`KOKORO_SPEED` (default `1.0`). No hosted speech API key is required.

## Prepare The Retrieval Data

The canonical pipeline uses `data/medvidqa_video_catalog.json`, containing one
label-free title-and-author document per video. It embeds these documents at
startup and ranks them in memory using semantic similarity and lexical overlap.
No separate vector database is required. The live API additionally searches short cached transcript passages,
using question-term coverage and semantic similarity so a related title does not hide a passage
that directly answers the question. Image observations remain secondary retrieval context.
Live localization examines at most two transcript-ranked windows per candidate; after an
unsupported answer, it may try one other already-scored source. Citation/support validation
remains required. The benchmark factory defaults and recorded research outputs are unchanged.

Rebuild the catalog when needed:

```bash
uv run python -m development.scripts.build_video_catalog
```

Grounded answers also require cached transcripts and locally available videos.
See [development/evaluation/README.md](development/evaluation/README.md) for resource preparation.
When `research_pipeline.supported_collection_only` is enabled, the runtime uses
`data/supported_video_collection.json` to restrict retrieval to supported videos.

## Start The FastAPI Service

After `backend/config.yaml`, the video catalog, evidence resources, and configured answer model are ready:

```bash
uv run --env-file backend/.env --no-sync python app.py
```

By default the local development config above serves the app at:

```text
http://localhost:5001
```

Health check:

```bash
curl http://localhost:5001/api/health
```

Interactive API documentation is available at `http://localhost:5001/docs`.

## FastAPI Routes

- `GET /` describes the canonical API.
- `GET /api/health` reports canonical-pipeline readiness.
- `POST /api/query` returns a grounded answer or abstention with video, clip,
  timestamps, transcript citations, confidence, and evidence-bundle provenance.
- `POST /api/v2/query` is a temporary compatibility alias for `/api/query`.
- `POST /api/multimodal/query` adds validated image context to evidence retrieval.
- `POST /api/tts` generates a 24 kHz WAV response locally with Kokoro.
- `GET /api/artifacts/{path}` serves generated clip and evidence artifacts.
- `GET /api/v2/artifacts/{path}` is a temporary compatibility alias.

Example text request:

```bash
curl -X POST http://localhost:5001/api/query \
  -H "Content-Type: application/json" \
  -d '{"query":"How to perform CPR on a child?"}'
```

## Data And Utility Scripts

- `development/scripts/clean_medvidqa.py` cleans `MedVidQA/train.json`, `val.json`, and `test.json`.
- `development/scripts/verify_all_videos.py` checks all unique MedVidQA videos and writes complete verified data files.
- `development/scripts/update_system.py` swaps in the complete verified dataset and clears old generated embeddings.
- `development/scripts/build_database.py` creates local pickle and NumPy embedding cache files.

## Frontend Folder

`frontend/` contains a Next.js chatbot app using Next.js, React, the AI SDK, Auth.js, Drizzle, Postgres, Redis, Vercel Blob, and Playwright. Its shared `lib/` layer includes model configuration, database access, typed chat data, prompts, rate limiting, and artifact support.

The `searchProcedure` AI SDK tool connects the chat experience to `/api/query`
and renders the canonical grounded answer, extracted clip, timestamps, transcript
citations, safety disposition, and evidence-bundle identifier. Image uploads use `/api/multimodal/query`: validated image observations refine retrieval,
while the original question and retrieved transcript remain the basis for the answer.
Greetings and Medix capability questions bypass procedure retrieval.

Configure the frontend:

```bash
cd frontend
cp .env.example .env.local
pnpm install --frozen-lockfile
```

Set the required service credentials in `.env.local`. Keep `MEDIX_API_URL=http://127.0.0.1:5001` when both applications run locally. `LOCAL_AUTH_BYPASS=true` is an optional development-only convenience and still requires migrated Postgres tables; it cannot activate in production.

Run the database migration and development server:

```bash
pnpm db:migrate
pnpm dev
```

Frontend verification:

```bash
pnpm exec biome check .
pnpm exec tsc --noEmit
pnpm test:unit
pnpm build
pnpm test
```

## Medical chat response composition

The FastAPI service still retrieves/localizes video evidence and applies its existing safety
and grounding gates. The frontend's `lib/ai/medical-follow-up.ts` then composes and verifies
the chat answer; changing only the general chat prompt does not change this path.

This response layer uses question-dependent budgets rather than a fixed two-step template.
It keeps video cues and checked medical references separate. `medical-knowledge.ts` contains
small, dated summaries from NHS and St John Ambulance with explicit topic/scope restrictions.
These are supplementary sources, not a comprehensive medical knowledge base or unrestricted
model memory. Entries stop being eligible after 180 days and need a new source check before
updating their dates. No request-time web search or additional provider is introduced.

Every initial question and follow-up first selects a minimal, directly relevant set of video
cues. Generation uses those cues and applicable medical references as separate evidence types.
A second model pass checks each claim's exact support, relevance, source scope and completeness.
An incomplete draft gets at most one generation/verification repair; failed repairs retain a
previously verified partial answer. Individual medical references are checked separately before
joint-source alternatives, allowing redundant citations to be removed without losing support.
Only video-supported claims get clickable timestamps; reference-supported guidance gets compact
numbered links and one deduplicated source list. Unsupported quantities and critical actions
receive an additional deterministic check.

Video demonstrations are optional and require directly relevant, complete playable cues. The
frontend does not attach the full transcript merely because its topic broadly matches. Native
clip playback seeks to selected moments, skips unrelated gaps and pauses at the last selected
boundary. Timestamp labels remain readable while seek coordinates retain fractional seconds.
Live backend localization includes full transcript cue boundaries; benchmark window definitions
remain unchanged. Passage retrieval combines lexical and semantic signals within each passage
before selecting a video's score.

Conversation history and the original medical situation resolve follow-ups, including those
whose preceding answer used references without a video. Failed-check questions receive an
appropriate action budget rather than the brief factual-answer budget. Images supply bounded,
unverified object/action context; they do not establish medical findings. New image requests
preserve history while retrieving fresh evidence. A photo without a question gets one useful
clarification. Latest-turn emergency checks still apply when reusing prior evidence.

Verification is not clinical review. The reference library currently covers ordinary bandages,
cuts/bleeding, injury warning signs and thermal burns; other topics depend on available video evidence and the existing
limitation/safety behavior. No training or fine-tuning was performed. No comprehensive medical
retrieval service or request-time web search is introduced.

```bash
cd frontend
pnpm run test:unit
pnpm exec tsc --noEmit
pnpm exec tsx tests/eval/medical-response-eval.ts --live
MEDIX_EVAL_SOURCE=../development/evaluation/results/response-pipeline-2026-10-15/source.json \
MEDIX_EVAL_OUTPUT=/tmp/medix-conversation-replay.json \
MEDIX_EVAL_ARM=after pnpm exec tsx tests/eval/conversation-response-eval.ts
```

The four-scenario live comparison holds cached transcripts and the current verifier constant,
comparing former transcript-only generator instructions with the revised generator. The separate
five-turn replay compares a captured pre-change implementation run against the revised pipeline
using identical backend evidence. Merely setting `MEDIX_EVAL_ARM=before` does not restore old code.
Both require existing Voyager credentials. The dated report and raw responses under
`development/evaluation/results/response-pipeline-2026-10-15/` record methods and limitations;
coverage probes and source checks cannot certify medical accuracy.

## Quality Checks

Backend linting and formatting use Ruff:

```bash
uv run ruff check --config pyproject.toml .
uv run ruff format --config pyproject.toml --check .
```

Frontend checks are configured in `frontend/package.json`:

```bash
cd frontend
pnpm exec biome check .
pnpm exec tsc --noEmit
```

## Current Startup Notes

The canonical runtime builds its video embeddings in memory at startup. Generated transcript, video, model, and evidence artifacts are ignored. If required configuration, catalog files, or models are unavailable, `/api/health` reports `degraded` and query requests return HTTP 503. Missing evidence for a selected video produces an abstention.

Use `MEDIX_VISION_PROVIDER=disabled` for a text-only backend. With Voyager selected, a missing `ASU_RC_API_KEY` prevents initialization. Cached transcripts and videos are still needed: a reachable inference service does not replace the evidence collection.

For a Sol backend tunneled to Mac port 5002, set the frontend `MEDIX_API_URL=http://127.0.0.1:5002` and restart the frontend. The tunnel must target the compute node of the currently running Slurm job.

## License

This repository includes an Apache 2.0 license in `LICENSE`.

## Development tools

Run resource tools from the project root, for example:
`uv run --no-sync python -m development.scripts.build_video_catalog`.
Submit the Sol backend with `sbatch backend/medix_live_backend.sbatch`.
Backend regression tests now live in `development/tests/`. Older operations jobs
and unused reference assets are not required to run Medix. See
[development/README.md](development/README.md) for the remaining supporting files.

## Production deployment

Medix can run on Render as a Node web service plus a private Python container,
with PostgreSQL, provider credentials, and persistent evidence storage. GitHub
Pages is not an application host. See [the deployment guide](development/docs/DEPLOYMENT.md)
for exact commands, environment variables, private clip delivery, health/readiness,
and deployment limitations. No cloud resources are created by this repository.

## Test the complete project

```bash
uv sync --frozen --group dev
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen python -m pytest
cd frontend
corepack pnpm install --frozen-lockfile
corepack pnpm exec biome check .
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm build
```

CI additionally runs migrations against a fresh PostgreSQL instance and builds
the backend image. Model weights, private environment files, request logs,
generated research caches, and runtime databases are excluded from Git. Original
research notes and dataset files are preserved; build/test tooling lives under
`development/` and application code under `frontend/` and `backend/`.
