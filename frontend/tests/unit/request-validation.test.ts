import assert from "node:assert/strict";
import test from "node:test";
import { postRequestBodySchema } from "../../app/(chat)/api/chat/schema";

const body = {
  id: "00000000-0000-4000-8000-000000000001",
  selectedChatModel: "qwen35-27b",
  selectedVisibilityType: "private",
};
const message = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "user",
  parts: [{ type: "text", text: "How do I check circulation?" }],
};

test("text chat requests preserve their medical question after validation", () => {
  const parsed = postRequestBodySchema.parse({ ...body, message });
  assert.deepEqual(parsed.message?.parts, message.parts);
});

test("multimodal requests retain the data-URL attachment format used by uploads", () => {
  const parts = [
    ...message.parts,
    {
      type: "file",
      name: "bandage.jpg",
      mediaType: "image/jpeg",
      url: "data:image/jpeg;base64,/9j/",
    },
  ];
  assert.deepEqual(
    postRequestBodySchema.parse({ ...body, message: { ...message, parts } })
      .message?.parts,
    parts
  );
});

test("tool approvals preserve nested input and approval records", () => {
  const messages = [
    {
      id: "assistant-approval",
      role: "assistant",
      parts: [
        {
          type: "tool-searchProcedure",
          toolCallId: "fixture",
          state: "approval-responded",
          approval: { id: "approval", approved: true },
          input: { query: "bandage circulation" },
        },
      ],
    },
  ];
  assert.deepEqual(
    postRequestBodySchema.parse({ ...body, messages }).messages,
    messages
  );
});

test("invalid attachment types and oversized text are still rejected", () => {
  const invalidParts = [
    { type: "text", text: "x".repeat(2001) },
    {
      type: "file",
      name: "file.pdf",
      mediaType: "application/pdf",
      url: "https://example.com/file.pdf",
    },
  ];
  for (const part of invalidParts) {
    const parsed = postRequestBodySchema.safeParse({
      ...body,
      message: { ...message, parts: [part] },
    });
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert(parsed.error.issues.length > 0);
    }
  }
});
