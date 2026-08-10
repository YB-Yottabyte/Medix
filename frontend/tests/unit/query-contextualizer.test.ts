import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationContext,
  decideRetrieval,
  isContextDependentQuestion,
} from "../../lib/ai/query-contextualizer";
import type { ChatMessage } from "../../lib/types";

function message(
  id: string,
  role: ChatMessage["role"],
  parts: unknown[]
): ChatMessage {
  return { id, role, parts } as ChatMessage;
}

test("buildConversationContext retains the latest procedure and user question", () => {
  const history = [
    message("user-1", "user", [
      { type: "text", text: "How do I clean a wound?" },
    ]),
    message("assistant-1", "assistant", [
      {
        type: "tool-searchProcedure",
        toolCallId: "tool-1",
        state: "output-available",
        input: { query: "How do I clean a wound?" },
        output: {
          status: "answered",
          videoId: "wound-video",
          evidenceBundleId: "wound-bundle",
          matchedProcedure: "Cleaning a minor wound",
          retrievalQuery: "How do I clean a wound?",
          citations: [
            {
              cue_id: "T001",
              start_seconds: 10,
              end_seconds: 15,
              text: "Clean the wound.",
            },
          ],
        },
      },
    ]),
  ];

  const context = buildConversationContext(history);

  assert.equal(context.previousUserQuestion, "How do I clean a wound?");
  assert.equal(context.activeProcedure, "How do I clean a wound?");
  assert.equal(context.activeEvidence?.videoId, "wound-video");
  assert.match(context.recentTranscript, /active procedure/);
});

test("detects contextual follow-ups but leaves standalone questions alone", () => {
  assert.equal(isContextDependentQuestion("What should I do next?"), true);
  assert.equal(isContextDependentQuestion("How long should I do that?"), true);
  assert.equal(isContextDependentQuestion("Can I use a shirt instead?"), true);
  assert.equal(
    isContextDependentQuestion("How do I perform CPR on an adult?"),
    false
  );
});

test("reuses active evidence for same-procedure follow-ups", () => {
  const context = buildConversationContext([
    message("user-1", "user", [
      { type: "text", text: "How do I pack a wound?" },
    ]),
    message("assistant-1", "assistant", [
      {
        type: "tool-searchProcedure",
        toolCallId: "tool-1",
        state: "output-available",
        input: {
          query: "How do I pack a wound?",
          action: "search_new_source",
        },
        output: {
          status: "answered",
          videoId: "wound-packing-video",
          evidenceBundleId: "wound-packing-bundle",
          retrievalQuery: "How do I pack a wound?",
          citations: [
            {
              cue_id: "T001",
              start_seconds: 16,
              end_seconds: 31,
              text: "Pack the wound with gauze or a clean shirt.",
            },
          ],
        },
      },
    ]),
  ]);

  for (const followUp of [
    "What should I do next?",
    "How long should I do that?",
    "Should I keep pressure on it?",
    "Can I use a shirt instead?",
  ]) {
    assert.equal(
      decideRetrieval(followUp, context),
      "continue_current_evidence"
    );
  }
});

test("retrieves a new source only for a clear topic change", () => {
  const context = buildConversationContext([
    message("assistant-1", "assistant", [
      {
        type: "tool-searchProcedure",
        toolCallId: "tool-1",
        state: "output-available",
        input: {
          query: "How do I pack a wound?",
          action: "search_new_source",
        },
        output: {
          status: "answered",
          videoId: "wound-packing-video",
          evidenceBundleId: "wound-packing-bundle",
          retrievalQuery: "How do I pack a wound?",
          citations: [
            {
              cue_id: "T001",
              start_seconds: 16,
              end_seconds: 31,
              text: "Pack the wound with gauze.",
            },
          ],
        },
      },
    ]),
  ]);

  assert.equal(
    decideRetrieval("How do I perform CPR on an adult?", context),
    "retrieve_new_source"
  );
  assert.equal(
    decideRetrieval("I have a different question about choking.", context),
    "retrieve_new_source"
  );
  assert.equal(
    decideRetrieval("What about CPR?", context),
    "retrieve_new_source"
  );
  assert.equal(
    decideRetrieval("Where should I place AED pads?", context),
    "retrieve_new_source"
  );
});

test("keeps the active evidence through a long text-only follow-up exchange", () => {
  const history = [
    message("assistant-initial", "assistant", [
      {
        type: "tool-searchProcedure",
        toolCallId: "tool-initial",
        state: "output-available",
        output: {
          status: "answered",
          videoId: "aed-video",
          evidenceBundleId: "aed-bundle",
          retrievalQuery: "How do I use an AED?",
          citations: [
            {
              cue_id: "T001",
              start_seconds: 10,
              end_seconds: 15,
              text: "Place the AED pads on the chest.",
            },
          ],
        },
      },
    ]),
    ...Array.from({ length: 10 }, (_, index) =>
      message(`follow-up-${index}`, index % 2 ? "assistant" : "user", [
        { type: "text", text: `Follow-up turn ${index}` },
      ])
    ),
  ];

  const context = buildConversationContext(history);
  assert.equal(context.activeEvidence?.videoId, "aed-video");
  assert.equal(
    decideRetrieval("Where should I place them?", context),
    "continue_current_evidence"
  );
});
