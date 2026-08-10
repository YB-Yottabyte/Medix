# Medix

Medix is a research prototype for medical procedure question answering. It uses the MedVidQA dataset, semantic retrieval, Groq-hosted language and vision models, YouTube transcript grounding, and a FastAPI web service to return step-by-step answers with relevant video segments.

This project is for educational and research use only. It is not a medical device and must not replace professional medical care or emergency services.

## What It Does

- Answers medical procedure questions with retrieval-augmented generation.
- Finds relevant MedVidQA video segments and timestamps.
- Fetches and caches YouTube transcripts so answers can be grounded in video content.
- Supports text queries, image uploads, voice transcription, single video-frame analysis, and combined multimodal requests.
- Includes scripts for cleaning MedVidQA data, verifying YouTube videos, building embeddings, and indexing vectors in Qdrant.

## Project Layout

```text
.
├── app.py                         # Root compatibility entrypoint for the FastAPI backend
├── backend/
│   ├── app.py                     # ASGI and local-development entrypoint
│   ├── application.py             # FastAPI application factory
│   ├── config.py                  # Typed configuration and project paths
│   ├── container.py               # Dependency container and composition root
│   ├── ports.py                   # Protocol interfaces for dependency inversion
│   ├── api/                       # Thin HTTP routes and error translation
│   ├── services/                  # Text/image/voice/multimodal use cases
│   ├── adapters/                  # Models, vector store, cache, and transcript integrations
│   ├── static/                    # CSS and browser JavaScript for the built-in UI
│   └── templates/                 # Jinja HTML template
├── scripts/
│   ├── clean_medvidqa.py          # Cleans and validates the MedVidQA splits
│   ├── build_database.py          # Builds local MedVidQA procedure and embedding cache
│   ├── qdrant_semantic_search.py  # Creates and populates the Qdrant collection
│   ├── verify_all_videos.py       # Checks YouTube video availability
│   └── update_system.py           # Updates local verified-video data
├── MedVidQA/                      # Source and cleaned MedVidQA dataset files
├── data/
│   ├── transcript_cache/          # Cached YouTube transcripts
│   └── verified_medvidqa_videos.json
├── docs/ARCHITECTURE.md            # Design and dependency flow
├── docs/research/                  # Literature matrix and thesis methodology
├── evaluation/                     # Reproducible experiment runners and metrics
├── tests/                          # Backend contract and configuration tests
├── frontend/                      # Separate Next.js chatbot frontend template
├── .python-version                # Python version selected by uv
├── pyproject.toml                 # Dependencies and Python tool configuration
└── uv.lock                        # Reproducible Python dependency lockfile
```

Provider and storage integrations are consolidated under `backend/adapters/`. The previous root-level forwarding packages and duplicate backend integration folders have been removed.

## Backend Architecture

The backend uses a layered application design:

```text
FastAPI routes and Pydantic schemas
      ↓
MedicalQAService
      ↓
retrieval, generation, vision, transcript, and speech adapters
```

`create_app()` constructs FastAPI, `ServiceFactory` creates production dependencies, and `ServiceContainer` makes dependencies explicit and replaceable in tests. Routes only handle HTTP input/output; multimodal orchestration lives in the service layer. FastAPI exposes interactive OpenAPI documentation at `/docs`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design rationale, dependency flow, degraded-startup behavior, and thesis evaluation gaps.

## Python Environment with uv

- [uv](https://docs.astral.sh/uv/) manages Python, the project environment, dependencies, and the lockfile.
- Docker, if you want to run the local Qdrant vector database.
- A Groq API key only for Groq-backed generation, image analysis, and Whisper
  transcription. Kokoro speech synthesis is local and does not use this key.

Create or update the environment exactly from `uv.lock`:

```bash
uv sync --frozen --group dev
```

Do not manually activate `.venv` or use `pip install` for this project. Prefix Python tools with
`uv run`; uv selects the version in `.python-version` and maintains the environment automatically.

Copy the tracked example to a local `config.yaml`. The local file is intentionally gitignored.

```bash
cp config.example.yaml config.yaml
```

```yaml
web:
  host: "0.0.0.0"
  port: 5001
  debug: true

database:
  embedding_model: "all-MiniLM-L6-v2"
  top_k: 5
  similarity_threshold: 0.25
  lexical_weight: 0.15
  qdrant_url: "http://localhost:6333"
  qdrant_collection: "medical_video_transcripts"

ai:
  provider: "groq"
  groq:
    api_key: ""
    model: "openai/gpt-oss-20b"
    temperature: 0.3
    max_tokens: 800
  ollama:
    base_url: "http://localhost:11434"
    model: "qwen3.5:9b-q4_K_M"
    temperature: 0.3
    max_tokens: 512
  huggingface:
    api_key: ""
    model: "mistralai/Mistral-7B-Instruct-v0.2"
    temperature: 0.3
    max_tokens: 800

vision:
  model: "qwen/qwen3.6-27b"
  max_image_size: 10485760
  top_k_matches: 5

safety:
  answer_confidence_threshold: 0.35
```

The answer-confidence threshold is an experimental parameter. Select it using validation data
and freeze it before evaluating the test split. It is not a clinical safety guarantee.

Set your Groq key in the shell before starting the app:

```bash
export GROQ_API_KEY="your-groq-api-key"
```

`GROQ_CHAT_API_KEY` is also supported and takes priority over `GROQ_API_KEY`.

Spoken responses use the local Kokoro-82M runtime. The first Listen request
downloads and caches approximately 363 MB of model and voice files; subsequent
requests reuse that cache. Optional speech settings are `KOKORO_VOICE`
(default `af_heart`), `KOKORO_LANG_CODE` (default `a`, American English), and
`KOKORO_SPEED` (default `1.0`). No hosted speech API key is required.

## Build The Retrieval Data

The FastAPI service expects generated cache files at:

```text
data/cache_medvidqa_verified/procedures.pkl
data/cache_medvidqa_verified/embeddings.npy
```

Build them with:

```bash
uv run python scripts/build_database.py
```

This script loads `MedVidQA/cleaned/*.json`, verifies YouTube thumbnail availability, builds `all-MiniLM-L6-v2` embeddings, and writes the cache files.

Run Qdrant locally:

```bash
docker run -d --name qdrant \
  -p 6333:6333 -p 6334:6334 \
  -v "$(pwd)/qdrant_storage:/qdrant/storage:z" \
  qdrant/qdrant
```

Populate the Qdrant collection:

```bash
uv run python scripts/qdrant_semantic_search.py
```

## Start The FastAPI Service

After `config.yaml`, the embedding cache, Qdrant, and `GROQ_API_KEY` are ready:

```bash
uv run python app.py
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

- `scripts/clean_medvidqa.py` cleans `MedVidQA/train.json`, `val.json`, and `test.json`.
- `scripts/verify_all_videos.py` checks all unique MedVidQA videos and writes complete verified data files.
- `scripts/update_system.py` swaps in the complete verified dataset and clears old generated embeddings.
- `scripts/build_database.py` creates local pickle and NumPy embedding cache files.
- `scripts/qdrant_semantic_search.py` creates the Qdrant collection and uploads vectors with metadata.

## Frontend Folder

`frontend/` contains a Next.js chatbot app using Next.js, React, the AI SDK, Auth.js, Drizzle, Postgres, Redis, Vercel Blob, and Playwright. Its shared `lib/` layer includes model configuration, database access, typed chat data, prompts, rate limiting, and artifact support.

The `searchProcedure` AI SDK tool connects the chat experience to `/api/query`
and renders the canonical grounded answer, extracted clip, timestamps, transcript
citations, safety disposition, and evidence-bundle identifier. Image-based retrieval
is not part of the current canonical runtime.

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

## Quality Checks

Backend linting and formatting use Ruff:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest -q --cov=backend
```

Frontend checks are configured in `frontend/package.json`:

```bash
cd frontend
pnpm exec biome check .
pnpm exec tsc --noEmit
```

## Current Startup Notes

This checkout does not include generated retrieval cache files because `*.pkl`, `*.npy`, and cache artifacts are ignored. The FastAPI application still starts and `/api/health` reports `degraded`, while routes that need the missing cache return HTTP 503. Run `uv run python scripts/build_database.py` to enable retrieval.

Vision is initialized as an independent capability. Without a Groq key, text QA may remain available with another configured provider, while image and frame-analysis requests report that vision is unavailable.

## License

This repository includes an Apache 2.0 license in `LICENSE`.
