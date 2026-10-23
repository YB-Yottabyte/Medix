import assert from "node:assert/strict";
import test from "node:test";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  VOYAGER_CHAT_MODEL,
} from "../../lib/ai/models";
import {
  getFollowUpModel,
  getLanguageModel,
  getTitleModel,
  languageModelProvider,
  providerOptionsKey,
} from "../../lib/ai/providers";

test("Voyager is the only active provider and uses the exact portal model ID", () => {
  assert.equal(DEFAULT_CHAT_MODEL, VOYAGER_CHAT_MODEL);
  assert.equal(VOYAGER_CHAT_MODEL, "qwen35-27b");
  assert.deepEqual(
    chatModels.map(({ provider }) => provider),
    ["voyager"]
  );
  assert.equal(languageModelProvider(DEFAULT_CHAT_MODEL), "voyager");
  assert.equal(providerOptionsKey(DEFAULT_CHAT_MODEL), "voyager");
});

test("answers, follow-ups and titles share Voyager without performing inference", () => {
  const oldKey = process.env.ASU_RC_API_KEY;
  process.env.ASU_RC_API_KEY = "mock-key";
  try {
    for (const model of [
      getLanguageModel(DEFAULT_CHAT_MODEL),
      getFollowUpModel(),
      getTitleModel(),
    ]) {
      assert.equal(model.modelId, VOYAGER_CHAT_MODEL);
      assert.match(model.provider, /voyager/);
    }
  } finally {
    if (oldKey === undefined) {
      delete process.env.ASU_RC_API_KEY;
    } else {
      process.env.ASU_RC_API_KEY = oldKey;
    }
  }
});
