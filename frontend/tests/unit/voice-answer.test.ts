import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "../../lib/types";
import { getVerifiedVoiceAnswer } from "../../lib/voice-answer";

test("voice mode reads a cited, verified procedure answer", () => {
  const message = {
    id: "assistant-1",
    parts: [
      {
        output: { answerable: true, status: "answered" },
        state: "output-available",
        type: "tool-searchProcedure",
      },
      { text: "Apply direct pressure. [0:12–0:20]", type: "text" },
    ],
    role: "assistant",
  } as ChatMessage;

  assert.equal(
    getVerifiedVoiceAnswer(message),
    "Apply direct pressure. [0:12–0:20]"
  );
});

test("voice mode does not read unverified or unsupported text", () => {
  const message = {
    id: "assistant-2",
    parts: [{ text: "Unverified instruction", type: "text" }],
    role: "assistant",
  } as ChatMessage;

  assert.equal(getVerifiedVoiceAnswer(message), null);
});
