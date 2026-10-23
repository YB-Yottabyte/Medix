# Current live configuration: Voyager Qwen 3.5 27B

> Historical integration record: this connector has been retired. Commands and settings below
> describe the earlier experiment and are not current setup instructions. Use Voyager instead.

Medix now defaults to the direct RC gateway at `https://openai.rc.asu.edu/v1`,
using the exact portal ID `qwen35-27b` for image observations and text generation.
The instructions below about Groq/Sol document the previous configuration.
Legacy adapters are preserved, but the current chat selector exposes Voyager only.
No automatic Groq, CreateAI, or local-model fallback is enabled.

On your Mac, start the backend from the repository root:

```sh
cd /Users/sairithwikk/Documents/Medix
read -s "ASU_RC_API_KEY?Voyager API key: "
export ASU_RC_API_KEY
export ASU_RC_MODEL=qwen35-27b
export MEDIX_VISION_PROVIDER=voyager
uv run --no-sync python app.py
```

In another Mac terminal, enter the same key and start the frontend:

```sh
cd /Users/sairithwikk/Documents/Medix/frontend
read -s "ASU_RC_API_KEY?Voyager API key: "
export ASU_RC_API_KEY
export ASU_RC_MODEL=qwen35-27b
pnpm dev
```

Alternatively save the frontend variables in its ignored `.env.local`, without
`NEXT_PUBLIC_` prefixes. The backend receives the key from its shell environment.
No Sol GPU job or SSH tunnel is required. Connect the ASU VPN if gateway access
requires it. API requests do not provide access to Sol video/transcript files:
local evidence caches still need to be available to the backend.

Open `http://localhost:3000`, attach one PNG/JPEG (at most 5 MiB), and ask:

> Using the bandage supplies in this photo as context, find a video demonstrating
> hand bandaging. Summarize only steps supported by the video and cite timestamps.
> If the evidence is insufficient, say so.

Then repeat without the image and ask a follow-up about the cited video.
Image observations augment retrieval only; answers still require video evidence.
The backend uses JSON mode with bounded output and rejects incomplete or malformed
responses. A synthetic image pilot verified the gateway accepts images and JSON mode with
`chat_template_kwargs.enable_thinking=false`. This option is sent by backend and
frontend so reasoning cannot exhaust short answer budgets. Backend structured
responses are bounded to 2,048 output tokens; truncated output remains rejected.
Actual photo questions and end-to-end accuracy still require evaluation.

Reference: https://docs.rc.asu.edu/ai/api/

---

# Groq Qwen image + text test

Groq model: `qwen/qwen3.8-27b`. The backend uses the existing Groq key from
GROQ_CHAT_API_KEY, GROQ_API_KEY, or ai.groq.api_key, in that order.
Vision defaults to Groq; set MEDIX_VISION_PROVIDER=disabled to disable it.
CreateAI is used only when explicitly selected; there is no quota fallback.
Restart the backend after changing environment configuration.

The chat paperclip now accepts JPEG/PNG for the separate vision stage regardless
of the response model selection. Attach one image <=5 MiB and include a text question.
Uploads are inline data URLs, not public blob objects. Images remain part of saved
chat messages in the existing database. Remote attachment URLs are rejected; reattach
older images. The backend re-encodes images before sending them to Groq.

The model extracts visual objects/actions, used to augment retrieval. Original text
is used for localization and evidence-grounded answers. It cannot validate your
technique or diagnose a photo. Retrieved video/transcript resources are still required.
The answer model picker selects the response generator, not the dedicated vision model.

## Manual pilot

1. Upload a clear photograph of a roll of bandage/gauze beside an uninjured hand,
   or a staged training demonstration. Prompt:

   "Using the supplies in this photo as context, find a relevant instructional video
   explaining how to wrap a hand with a bandage. Give the steps supported by the video
   and cite timestamps. If the video does not cover this, say so."

   Expected: relevant retrieved evidence and timestamped steps, or explicit abstention.
   Do not expect a diagnosis or a claim that the pictured technique is correct.
2. Repeat the same question without the image. Compare selected video and citations.
3. Upload an unrelated/unclear photograph with that question. Expected: limited visual
   observations; the answer must still rely on retrieved evidence and may abstain.
4. Text-only regression: "Find a video demonstrating hand bandaging and summarize its steps."

Backend: `uv run --no-sync python app.py` from the repository root.
Frontend: `pnpm dev` from frontend. Use your existing backend environment/key setup.
A process-local cap defaults to 100 vision attempts, with 512 output tokens, no reasoning,
and no retries. It is not an account-wide dollar or daily token limit; Groq account plan
and quotas apply. One image question can also invoke the existing answer-generation and
chat-title models. No live inference was run by the implementation tests.

Official reference: https://console.groq.com/docs/vision

## Text generation on Sol

Text defaults to the existing Sol Ollama deployment (`qwen3.6:27b`), reached
through `http://localhost:11500`. Groq remains responsible for image observations.
Sol now handles initial answers, evidence-grounded backend generation, follow-up
assessment/verification, query contextualization, and chat titles. Existing
explicit model selections remain available; select **Qwen 3.6 27B / Sol** if a
saved browser selection still shows GPT-OSS or local Qwen.

Set these same values in the backend shell and frontend `.env.local` if overriding:

```sh
SOL_OLLAMA_BASE_URL=http://localhost:11500
SOL_CHAT_MODEL=qwen3.6:27b
SOL_FALLBACK_TO_LOCAL=false
```

The root configuration uses `research_pipeline.answer_model: structured_sol`.
Restart both application servers after changes. This assumes a manually started
Sol compute job serving that exact installed model and an active SSH tunnel.
The app does not create a job or tunnel. Sol requests do not consume Groq or
CreateAI token credits; compute allocation eligibility and limits still apply.
No automatic hosted-provider fallback is enabled. Vision requests still use
Groq and remain subject to that account's plan and limits.

No live Sol generation was tested by this change. Reuse the image prompt above,
then ask a follow-up about the cited video to verify both routes with your session.
