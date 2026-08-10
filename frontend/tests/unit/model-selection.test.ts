import assert from "node:assert/strict";
import test from "node:test";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
  QWEN_CHAT_MODEL,
  SOL_CHAT_MODEL,
} from "../../lib/ai/models";
import {
  languageModelProvider,
  ollamaOpenAIBaseUrl,
  providerOptionsKey,
} from "../../lib/ai/providers";

test("keeps GPT-OSS and local Qwen, and adds Sol-backed Qwen 3.6 for evaluation", () => {
  assert.equal(DEFAULT_CHAT_MODEL, "openai/gpt-oss-20b");
  assert.deepEqual(
    chatModels.map(({ name, provider }) => ({ name, provider })),
    [
      { name: "GPT-OSS 20B", provider: "groq" },
      { name: "Qwen 3.5 9B", provider: "ollama" },
      { name: "Qwen 3.6 27B", provider: "sol" },
    ]
  );
  assert.equal(chatModels[1]?.id, QWEN_CHAT_MODEL);
  assert.equal(chatModels[1]?.deployment, "Local model");
  assert.equal(languageModelProvider(DEFAULT_CHAT_MODEL), "groq");
  assert.equal(languageModelProvider(QWEN_CHAT_MODEL), "ollama");
  assert.equal(getCapabilities()[QWEN_CHAT_MODEL]?.tools, true);
  // Sol is an evaluation option only: it must not become any default.
  assert.notEqual(DEFAULT_CHAT_MODEL, SOL_CHAT_MODEL);
  assert.equal(chatModels[2]?.id, SOL_CHAT_MODEL);
});

test("normalizes Ollama hosts to the OpenAI-compatible v1 endpoint", () => {
  assert.equal(
    ollamaOpenAIBaseUrl("http://127.0.0.1:11434/"),
    "http://127.0.0.1:11434/v1"
  );
  assert.equal(
    ollamaOpenAIBaseUrl("http://ollama.internal:11434/v1"),
    "http://ollama.internal:11434/v1"
  );
});

test("providerOptions are keyed by the client name, not the registry provider", () => {
  // Sol's registry provider is "sol" for UI grouping, but its AI SDK client is
  // registered as "ollama". Keying by the registry name silently drops
  // reasoningEffort, which makes the thinking model return empty content.
  assert.equal(languageModelProvider(SOL_CHAT_MODEL), "sol");
  assert.equal(providerOptionsKey(SOL_CHAT_MODEL), "ollama");

  assert.equal(providerOptionsKey(QWEN_CHAT_MODEL), "ollama");
  assert.equal(providerOptionsKey(DEFAULT_CHAT_MODEL), "groq");

  // Every local model must be able to receive the non-thinking option.
  for (const model of chatModels.filter((m) => m.reasoningEffort === "none")) {
    assert.equal(providerOptionsKey(model.id), "ollama", model.id);
  }
});
