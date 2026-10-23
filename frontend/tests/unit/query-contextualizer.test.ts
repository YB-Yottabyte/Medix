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
  return { id, parts, role } as ChatMessage;
}

test("buildConversationContext retains the latest procedure and user question", () => {
  const history = [
    message("user-1", "user", [
      { text: "How do I clean a wound?", type: "text" },
    ]),
    message("assistant-1", "assistant", [
      {
        input: { query: "How do I clean a wound?" },
        output: {
          citations: [
            {
              cue_id: "T001",
              end_seconds: 15,
              start_seconds: 10,
              text: "Clean the wound.",
            },
          ],
          evidenceBundleId: "wound-bundle",
          matchedProcedure: "Cleaning a minor wound",
          retrievalQuery: "How do I clean a wound?",
          status: "answered",
          videoId: "wound-video",
        },
        state: "output-available",
        toolCallId: "tool-1",
        type: "tool-searchProcedure",
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
      { text: "How do I pack a wound?", type: "text" },
    ]),
    message("assistant-1", "assistant", [
      {
        input: {
          action: "search_new_source",
          query: "How do I pack a wound?",
        },
        output: {
          citations: [
            {
              cue_id: "T001",
              end_seconds: 31,
              start_seconds: 16,
              text: "Pack the wound with gauze or a clean shirt.",
            },
          ],
          evidenceBundleId: "wound-packing-bundle",
          retrievalQuery: "How do I pack a wound?",
          status: "answered",
          videoId: "wound-packing-video",
        },
        state: "output-available",
        toolCallId: "tool-1",
        type: "tool-searchProcedure",
      },
    ]),
  ]);

  for (const followUp of [
    "What should I do next?",
    "How long should I do that?",
    "Should I keep pressure on it?",
    "Can I use a shirt instead?",
    "How do I check their circulation?",
    "How do I help her?",
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
        input: {
          action: "search_new_source",
          query: "How do I pack a wound?",
        },
        output: {
          citations: [
            {
              cue_id: "T001",
              end_seconds: 31,
              start_seconds: 16,
              text: "Pack the wound with gauze.",
            },
          ],
          evidenceBundleId: "wound-packing-bundle",
          retrievalQuery: "How do I pack a wound?",
          status: "answered",
          videoId: "wound-packing-video",
        },
        state: "output-available",
        toolCallId: "tool-1",
        type: "tool-searchProcedure",
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
        output: {
          citations: [
            {
              cue_id: "T001",
              end_seconds: 15,
              start_seconds: 10,
              text: "Place the AED pads on the chest.",
            },
          ],
          evidenceBundleId: "aed-bundle",
          retrievalQuery: "How do I use an AED?",
          status: "answered",
          videoId: "aed-video",
        },
        state: "output-available",
        toolCallId: "tool-initial",
        type: "tool-searchProcedure",
      },
    ]),
    ...Array.from({ length: 10 }, (_, index) =>
      message(`follow-up-${index}`, index % 2 ? "assistant" : "user", [
        { text: `Follow-up turn ${index}`, type: "text" },
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

test("history includes visible procedure-card answers when no plain-text part was saved", () => {
  const answer =
    "A circulation check was explained. A routine monitoring interval was also explained.";
  const context = buildConversationContext([
    message("user", "user", [
      { text: "How can I check their arm bandage?", type: "text" },
    ]),
    message("assistant", "assistant", [
      {
        output: {
          answer,
          citations: [],
          evidenceBundleId: "bundle",
          evidenceContext: [
            {
              cue_id: "T001",
              end_seconds: 3,
              start_seconds: 0,
              text: "RAW_TRANSCRIPT_NOT_THE_VISIBLE_REPLY",
            },
          ],
          retrievalQuery: "Arm bandage",
          status: "answered",
          videoId: "bandage",
        },
        state: "output-available",
        toolCallId: "procedure",
        type: "tool-searchProcedure",
      },
    ]),
  ]);
  assert.match(
    context.recentTranscript,
    /assistant: A circulation check was explained/
  );
  assert.equal(context.recentTranscript.split(answer).length - 1, 1);
  assert.doesNotMatch(context.recentTranscript, /RAW_TRANSCRIPT/);
});

test("plain-text assistant replies take precedence over procedure-card copies in history", () => {
  const answer = "The visible answer.";
  const context = buildConversationContext([
    message("assistant", "assistant", [
      { text: answer, type: "text" },
      {
        output: {
          answer: "A stale card copy.",
          citations: [],
          retrievalQuery: "Bandage",
          status: "answered",
        },
        state: "output-available",
        toolCallId: "procedure",
        type: "tool-searchProcedure",
      },
    ]),
  ]);
  assert.equal(context.recentTranscript.split(answer).length - 1, 1);
  assert.doesNotMatch(context.recentTranscript, /stale card/);
});
