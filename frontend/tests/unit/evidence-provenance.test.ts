import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModel } from "ai";
import { activeSourceLabel } from "../../lib/active-source";
import { generateVerifiedFollowUp } from "../../lib/ai/medical-follow-up";
import { QWEN_CHAT_MODEL } from "../../lib/ai/models";
import type {
  ProcedureToolOutput,
  TranscriptCitation,
} from "../../lib/ai/tools/search-procedure";
import type { ChatMessage } from "../../lib/types";

const evidence: TranscriptCitation[] = [
  {
    clip_end_seconds: 36,
    clip_start_seconds: 31,
    cue_id: "S12",
    end_seconds: 36,
    start_seconds: 31,
    text: "Attach the AED pads to the patient's bare chest.",
  },
  {
    clip_end_seconds: 43,
    clip_start_seconds: 36,
    cue_id: "S13",
    end_seconds: 43,
    start_seconds: 36,
    text: "Continue   CPR while preparing the AED.",
  },
];

function activeEvidence(): ProcedureToolOutput {
  return {
    abstentionReason: null,
    answer: null,
    answerable: true,
    citations: evidence,
    clipUrl: null,
    confidence: 0.8,
    emergencyWarning: null,
    endTime: 43,
    evidenceBundleId: "aed-bundle",
    evidenceContext: evidence,
    followUpQuestion: null,
    matchedProcedure: "How do I use an AED?",
    queryWasContextualized: false,
    renderMediaWorkspace: true,
    responseInstructions: "",
    retrievalDecision: "retrieve_new_source",
    retrievalQuery: "How do I use an AED?",
    safetyDisposition: "supported",
    sourceRetrievalQuery: "How do I use an AED?",
    startTime: 31,
    status: "answered",
    videoId: "aed-video",
    videoUrl: null,
  };
}

function scriptedModel(responses: string[]): LanguageModel {
  let index = 0;
  return {
    doGenerate: async () => {
      const next = responses[index] ?? responses.at(-1) ?? "";
      index += 1;
      return {
        content: [{ text: next, type: "text" }],
        finishReason: "stop",
        usage: {
          inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
          outputTokens: { reasoning: 0, text: 1, total: 1 },
        },
        warnings: [],
      };
    },
    modelId: QWEN_CHAT_MODEL,
    provider: "test-ollama",
    specificationVersion: "v3",
    supportedUrls: {},
  } as unknown as LanguageModel;
}

async function runFollowUp(responses: string[], question: string) {
  return await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(),
    model: scriptedModel(responses),
    question,
    recentConversation: "user: How do I use an AED?",
  });
}

test("a supported follow-up reports the cues it was built from", async () => {
  const result = await runFollowUp(
    [
      JSON.stringify({
        relatedCueIds: ["T001"],
        relation: "continue_to_use_evidence",
        sufficiency: "sufficient",
        supportingCueIds: ["T002"],
      }),
      JSON.stringify({
        claims: [{ cueIds: ["T002"], text: "Keep chest compressions going" }],
      }),
      JSON.stringify({
        claims: [{ claimIndex: 0, cueIds: ["T002"], supported: true }],
        utility: 5,
        verdict: "accept",
      }),
    ],
    "Should compressions continue?"
  );

  // Only the selected cue is exposed, with whitespace normalised and clip-clock
  // timestamps matching the rendered citation.
  assert.deepEqual(result.citedCues, [
    {
      endSeconds: 43,
      startSeconds: 36,
      text: "Continue CPR while preparing the AED.",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result.citedCues), /T00\d|aed-bundle/);
});

test("deferrals and conversational turns expose no provenance", async () => {
  const deferred = await runFollowUp(
    [
      JSON.stringify({
        relatedCueIds: [],
        relation: "continue_to_use_evidence",
        sufficiency: "insufficient",
        supportingCueIds: [],
      }),
    ],
    "What dose of adrenaline is used?"
  );
  assert.deepEqual(deferred.citedCues, []);

  const conversational = await runFollowUp(
    [
      JSON.stringify({
        relatedCueIds: [],
        relation: "no_retrieval_needed",
        sufficiency: "insufficient",
        supportingCueIds: [],
      }),
      "You're welcome.",
    ],
    "thanks"
  );
  assert.deepEqual(conversational.citedCues, []);
});

function message(
  id: string,
  role: ChatMessage["role"],
  parts: unknown[]
): ChatMessage {
  return { id, parts, role } as ChatMessage;
}

function procedureTurn(output: Record<string, unknown>) {
  return message("assistant-1", "assistant", [
    {
      output,
      state: "output-available",
      toolCallId: "tool-1",
      type: "tool-searchProcedure",
    },
  ]);
}

test("the active-source label names the bundle a follow-up would reuse", () => {
  const history = [
    procedureTurn({
      evidenceBundleId: "aed-bundle",
      sourceRetrievalQuery: "How do I use an AED?",
      status: "answered",
      videoId: "aed-video",
    }),
    message("user-2", "user", [{ text: "and after that?", type: "text" }]),
    message("assistant-2", "assistant", [
      { text: "Keep going. [0:36–0:43]", type: "text" },
    ]),
  ];

  assert.equal(activeSourceLabel(history), "How do I use an AED?");
  assert.equal(activeSourceLabel([]), null);
});

test("the active-source label clears when the newest search did not answer", () => {
  assert.equal(
    activeSourceLabel([
      procedureTurn({
        evidenceBundleId: "aed-bundle",
        sourceRetrievalQuery: "How do I use an AED?",
        status: "answered",
        videoId: "aed-video",
      }),
      procedureTurn({ status: "abstained" }),
    ]),
    null
  );
  // An answered result without a usable bundle is not a reusable source.
  assert.equal(
    activeSourceLabel([procedureTurn({ status: "answered", videoId: null })]),
    null
  );
});
