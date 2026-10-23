# Dataset-informed questions and request performance

The live project is `/Users/sairithwikk/Documents/Medix`. Changes preserve the existing APIs and evidence UI.

## Dataset review and prompt changes

`review_dataset_questions.py` reviews the original train (2,710), validation (145), and test (155) questions: 3,010 total. None contains the word "why". The `how` word occurs in 2,968 questions. These are descriptive counts, not expert intent annotations. Original MedVidQA supervision is a video answer interval, **not a written medical answer**.

`dataset-question-review.json` records question-type counts, four actual training-only examples, and three explicitly derived why questions. The immutable JSON splits are unchanged. Validation/test questions are counted for the descriptive audit, but **never become few-shot prompt examples**. Runtime examples contain question wording and intent, not medical answers, video IDs or annotated times. Derived why questions have no claimed expert rationale labels.

The response layer now supplies the latest question's intent to evidence selection, generation and verification. How-to questions need an action; recognition questions need a check and interpretation; what-if questions need a next action; why questions need a supported reason, purpose or mechanism. Context rewriting preserves interrogative intent. Backend generation applies the same distinction. Existing citation, scope, safety and image-context checks still apply.

For a why question, an action-only answer fails completeness review and gets one repair attempt. If a rationale still cannot be supported, the system does not fall back to a transcript instruction as if it were an explanation. No new medical facts or hardcoded clinical answers were introduced. Intent detection is a small heuristic aid; semantic selection/verification still decides source support. It cannot guarantee clinical correctness.

## What is recorded

Request timings are enabled by default. Set `MEDIX_PERFORMANCE_ENABLED=0` separately for frontend/backend to disable. Default append-only files:

- `data/performance/backend.jsonl`: FastAPI request through ASGI body delivery, including validation errors and failed attempts.
- `data/performance/frontend.jsonl`: Next.js `/api/chat` entry through server response-stream completion/cancellation, plus first response byte and first text-delta times.

Every row has schema version, UTC start, random request ID, layer, route, status, milliseconds, counters and component spans. Next.js forwards `x-medix-request-id` to FastAPI; both return the header for correlation. Frontend ignores externally supplied IDs and creates a fresh one. Backend accepts only bounded hex/UUID-form IDs. `MEDIX_PERFORMANCE_LOG` overrides the file path **per process**; use separate files for the two services.

Component names cover:

- Next.js request decode, session, chat history, persistence, capabilities, intent model, contextualization/rewrite, title model, backend round trip, reference selection, evidence-selection model, response generation, claim parsing, verification/review parsing, repair calls, progressive delivery, and general-response generation.
- Python safety triage, retrieval (metadata and transcript), transcript loading, text embedding inference and feature-cache access, transcript windows, multimodal localization, CLIP frame scoring, frame decoding/extraction, video resolution/download, evidence transcript/frame/clip assembly, vision preprocessing/observation, Voyager calls and structured generation/grounding validation. Repeated candidate and repair calls are separate spans.
- Counters distinguish input modes, intent, evidence reuse/new retrieval, repair attempts and feature/frame/window cache hits/misses. Missing stages mean skipped/not instrumented, **not zero latency**.

Durations use monotonic clocks. Python contextvars and Node AsyncLocalStorage isolate simultaneous requests; Python context follows Starlette's threadpool. The old offline `last_timings_ms` interface is context-local and is no longer the live timing source. Component durations are inclusive of child work. `exclusive_ms` subtracts the union of direct-child spans to avoid double-counting concurrent children.

**Do not add stage durations into a total.** Parent spans overlap their children, retries may overlap other work, and backend time is already inside Next.js's backend round trip. Use measured root `total_ms` for each layer. Clock offsets across machines do not affect local durations; compare correlated traces rather than subtracting wall-clock timestamps.

The Next.js total includes configured progressive-output delay and waits for response persistence/title work when awaited. It ends when the server stream is consumed, not when the browser paints pixels. First-byte time may precede any answer because progress/tool events come first. First-answer time is the first emitted `text-delta`. Upload time before `/api/chat`, browser rendering, deployment startup/model loading, human reading and external scheduler queue time are outside these request totals. Remote model spans include provider/network latency rather than GPU-only kernel time. Cold caches/model inference within the request are included; service startup is not.

Trace files contain no question text, responses, images, user/chat IDs, prompts, URLs or credentials. Errors record status rather than exception messages. Files are created with owner-only permissions where supported. Logging failures do not fail medical requests. Traces are ignored by Git. Retain/rotate these append-only files for your study; no automatic retention policy is imposed.

## Analysis and reproducibility

Run from the project root:

```sh
uv run --no-sync python -m development.evaluation.review_dataset_questions
uv run --no-sync python -m development.evaluation.analyze_performance --logs data/performance/backend.jsonl data/performance/frontend.jsonl --output data/performance/summary
```

The analyzer writes `summary.json`, `summary-totals.csv` and `summary-components.csv` and `summary-requests.csv` with counts, means, p50, p95 and maxima by layer/route/status/stage. Repeated calls are aggregated per request before stage percentiles. Failed/cancelled requests are separated; malformed partial lines are counted and skipped. Missing stages are not imputed. Request IDs join backend and frontend without adding their totals.

Run real retrieval + response composition (requires running backend, configured models and credentials):

```sh
cd frontend
pnpm exec tsx tests/eval/dataset-pipeline-eval.ts --live --limit 7
pnpm exec tsx tests/eval/dataset-pipeline-eval.ts --live --ids train-115,derived-why-pressure --limit 2
```

The runner sends only the question, never a gold video/time. It saves actual responses, cited moments, source links, request IDs and wall times under `data/performance/dataset-eval-*.json`. **Unlike content-free timing logs, this evaluation artifact deliberately contains the public dataset questions and generated answers.** Its totals cover backend HTTP plus response composition, not authentication/database/browser delivery. This benchmark is marked `route=offline` in frontend traces. For real application totals use `/api/chat` and its normal trace records.

Clinical accuracy, explanation adequacy and citation entailment require independent review. The runner leaves those review fields empty; `verified=true` is an internal pipeline result, not measured clinical accuracy. The automated tests use controlled source/model fixtures to test contract behavior, causal rejection, completeness repair, citation coordinates, concurrency, cancellation and timing boundaries. Synthetic durations are not real model benchmarks. Keep any before/after reports immutable; this change does not fabricate a historical baseline.

Compare multiple identical questions on a cold and warm service, keep model/provider/configuration fixed, record cache counters, and use enough repetitions before interpreting p95. Keep text, combined-image, image-only clarification, new retrieval and evidence-reuse requests separate when discussing performance.

For response-generation-only experiments, pass `--cached-evidence /absolute/path/to/saved-procedure-output.json` with a previously saved `ProcedureToolOutput`. This mode is explicitly labeled `offline.cached_evidence`; it does not measure retrieval, routing, chat storage or browser rendering. It is not an end-to-end latency measurement.

## Measured pilot and verification

All 159 frontend unit tests and 10 backend tests passed, and TypeScript compilation passed. Coverage includes a supported rationale, an action-only rationale rejected after repair, rejection of an invented cause, exact timestamp coordinates, server/client dependency boundaries, concurrent requests, SSE completion/cancellation, ASGI failure logging and image normalization timing.

Two actual Voyager composition requests were measured against an earlier saved bandage-check retrieval response:

| Case | Wall time | Evidence selection | Generation (all attempts) | Verification (all attempts) | Observed outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Original training question 115: applying a pressure bandage | 1.91 s | 1.90 s | Skipped | Skipped | Insufficient evidence for the requested method in this saved source |
| Derived why-pressure question | 23.48 s | 1.17 s | 8.56 s | 13.74 s | Explained that the supplied sources did not explicitly give the physiological rationale; two generation/verification attempts |

The second request's internal sufficiency label was `sufficient`, but this is **not evidence that a physiological explanation was available or clinically graded as correct**. Its actual answer acknowledged the missing rationale. Review the saved answer rather than equating that label with correctness. The first case's short duration reflects an abstention, not fast completion of a useful medical answer. These are composition-only observations, not fresh retrieval or full-chat benchmarks; two samples do not justify a reliable p95 claim.

Full live end-to-end measurement could not complete because the local backend stalled before listening, during Transformers' `importlib.metadata.packages_distributions()` startup scan. The temporary benchmark server was interrupted. The implementation was tested through ASGI/stream fixtures, but synthetic fixture durations are not presented as model performance. Restart the services in a working runtime to collect real correlated backend and `/api/chat` traces.

`dataset-performance-validation.json` records the measured stage totals, request IDs, test results and limitations. Raw request traces and analysis CSV/JSON files are under `data/performance/`, excluded from Git.
