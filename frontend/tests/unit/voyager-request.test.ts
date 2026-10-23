import assert from "node:assert/strict";
import test from "node:test";
import { generateText } from "ai";
import { DEFAULT_CHAT_MODEL } from "../../lib/ai/models";
import { getLanguageModel } from "../../lib/ai/providers";
import { fetchMedixJson } from "../../lib/ai/tools/medix-api-client";

test("Voyager sends non-thinking mode on the wire", async () => {
  const originalFetch = globalThis.fetch;
  const oldKey = process.env.ASU_RC_API_KEY;
  let body: Record<string, unknown> = {};
  process.env.ASU_RC_API_KEY = "mock-key";
  globalThis.fetch = (async (input: unknown, init: RequestInit) => {
    assert.equal(
      String(input),
      "https://openai.rc.asu.edu/v1/chat/completions"
    );
    body = JSON.parse(String(init.body));
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: "ok", role: "assistant" },
        },
      ],
      created: 1,
      id: "mock",
      model: DEFAULT_CHAT_MODEL,
      usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
    });
  }) as typeof fetch;
  try {
    const result = await generateText({
      maxRetries: 0,
      model: getLanguageModel(DEFAULT_CHAT_MODEL),
      prompt: "Hello",
    });
    assert.equal(result.text, "ok");
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldKey === undefined) {
      delete process.env.ASU_RC_API_KEY;
    } else {
      process.env.ASU_RC_API_KEY = oldKey;
    }
  }
});

test("backend HTTP errors are distinguished from network failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json(
      { error: "Voyager reached the output token limit" },
      { status: 503 }
    )) as typeof fetch;
  try {
    await assert.rejects(
      fetchMedixJson("/api/multimodal/query", { method: "POST" }),
      /backend request failed \(HTTP 503\): Voyager reached/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
