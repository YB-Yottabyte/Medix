# ASU CreateAI integration

> Historical integration record: this connector has been retired. Commands and settings below
> describe the earlier experiment and are not current setup instructions. Use Voyager instead.

Implementation date: 2026-10-09. Offline contract tests only; project access, model
availability, billed usage, clinical correctness, and image QA accuracy are not yet verified.

## Evaluation boundary

Validation full multimodal: selected video 49/145, mIoU .1224164, IoU >= .5 15/145.
Top-3: 47/145, .1136032, 13/145. Transcript-only: 45/145, .0944864, 9/145.
All replay frozen retrieval (Recall@5 93/145). Aggregate full metrics reproduce;
per-sample identity has not been checked here. Warm full mean latency 38.62 s versus
16.79 s in the previous cached run does not establish an end-to-end cache speedup.
Frozen retrieval lookup timing is not live retrieval latency. These runs stop at
evidence extraction and do not measure response generation or image-question QA.
The official test has been evaluated previously; this final run is a frozen repeat,
not a first-ever unseen test. Report this history transparently.

## Supported integration

- `POST /api/multimodal/query`: JSON `query` plus `image_base64` (raw base64, no data URL).
- `CreateAIVisionModel` extracts bounded objects/actions/uncertainty. Images are validated,
  normalized to JPEG <=1024px, and re-encoded without EXIF before the ASU request.
- Observations augment video retrieval only. The original question is retained for
  safety triage, temporal localization, evidence extraction and grounded generation.
  Response exposes the retrieval query and observations separately from citations.
- Vision errors fail explicitly with HTTP 503; malformed images return HTTP 400.
- Optional `research_pipeline.answer_model: structured_createai` uses the existing
  strict answer decoder and citation/lexical validation. This is not proof of clinical
  correctness. Invalid output does not trigger paid repair calls.
- Text-only `/api/query` and the Sol localization evaluator are unchanged by default.
- No frontend upload wiring or authenticated public deployment is included in this phase.

## Server configuration

Export these in the backend process environment (the backend does not automatically
load this example file). Never place a service token in frontend environment variables,
source control, or chat. Use the environment assigned to your token.

```bash
export CREATEAI_BASE_URL=https://api-main.aiml.asu.edu
export CREATEAI_VISION_ENABLED=0
export CREATEAI_VISION_MODEL=''
export CREATEAI_ANSWER_MODEL=''
export CREATEAI_MAX_OUTPUT_TOKENS=512
export CREATEAI_MAX_REQUESTS=10
export CREATEAI_TIMEOUT_SECONDS=60
```

Set `CREATEAI_API_KEY` privately with your normal secret manager or shell's hidden-input
prompt. Then list accessible models without inference:

```bash
uv run --no-sync python -m development.scripts.createai_models
```

Use an explicit `provider/Model` alias from the ASU catalog, not its upstream `Model ID`.
The supplied API-only catalog excerpt lists `openai/gpt5_2_pro` as vision-capable and
expensive; it does not list Qwen3-VL or establish access to a cheaper vision model.
Models labeled `image` are image generation, not a replacement for `vision`.
No model is auto-selected. After verifying a suitable model, set CREATEAI_VISION_MODEL
and CREATEAI_VISION_ENABLED=1, then restart the backend. A separate text model can be
selected with CREATEAI_ANSWER_MODEL and `structured_createai` in config.yaml.

Example request to a running local backend (consumes one vision call, plus an answer
call if a hosted answer generator is configured and evidence is available):

```python
import base64
from pathlib import Path
import requests
response = requests.post('http://127.0.0.1:5001/api/multimodal/query', json={
    'query': 'How should I wrap this bandage?',
    'image_base64': base64.b64encode(Path('sample.jpg').read_bytes()).decode(),
}, timeout=180)
print(response.status_code)
print(response.json())
```

## Limits and evidence

ASU docs list a default $4/month student budget; older projects can differ. This is
separate from Sol class compute. Confirm the project's usage page before any inference.
Local cap counts attempted inference requests across the shared client within one
Python process. It resets at restart and multiplies across workers; it is not a
persistent/global dollar budget. There are no automatic retries, model fallbacks,
or scheduled calls. ASU enforces project-wide quotas; `/v1` quota errors return 429.
No dollar estimates are inferred from token usage or from an absent price field.

Sources checked: https://docs.aiml.asu.edu/llms.txt,
https://docs.aiml.asu.edu/openai-compatible, https://docs.aiml.asu.edu/limits.
The docs specify inline PNG/JPEG/GIF/WebP, 4 MB decoded images, and server-side service tokens.

## Next experiment

Verify project models, then run one benign image smoke test. Create a small independently
labeled procedure-image pilot with paired text-only versus text+image questions. Record
model alias, prompt version, retrieval changes, citation correctness, abstentions,
latency, and human-reviewed answer quality. Do not present MedVidQA localization IoU
as evidence of image-question answering quality. Keep the frozen Sol test configuration.
