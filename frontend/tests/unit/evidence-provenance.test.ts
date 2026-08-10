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
    cue_id: "S12",
    start_seconds: 31,
    end_seconds: 36,
    clip_start_seconds: 31,
    clip_end_seconds: 36,
    text: "Attach the AED pads to the patient's bare chest.",
  },
  {
    cue_id: "S13",
    start_seconds: 36,
    end_seconds: 43,
    clip_start_seconds: 36,
    clip_end_seconds: 43,
    text: "Continue   CPR while preparing the AED.",
  },
];

function activeEvidence(): ProcedureToolOutput {
  return {
    answer: null,
    status: "answered",
    answerable: true,
    confidence: 0.8,
    abstentionReason: null,
    emergencyWarning: null,
    safetyDisposition: "supported",
    citations: evidence,
    evidenceContext: evidence,
    evidenceBundleId: "aed-bundle",
    videoId: "aed-video",
    videoUrl: null,
    clipUrl: null,
    startTime: 31,
    endTime: 43,
    matchedProcedure: "How do I use an AED?",
    retrievalQuery: "How do I use an AED?",
    sourceRetrievalQuery: "How do I use an AED?",
    queryWasContextualized: false,
    retrievalDecision: "retrieve_new_source",
    followUpQuestion: null,
    renderMediaWorkspace: true,
    responseInstructions: "",
  };
}

function scriptedModel(responses: string[]): LanguageModel {
  let index = 0;
  return {
    specificationVersion: "v3",
    provider: "test-ollama",
    modelId: QWEN_CHAT_MODEL,
    supportedUrls: {},
    doGenerate: async () => {
      const next = responses[index] ?? responses.at(-1) ?? "";
      index += 1;
      return {
        finishReason: "stop",
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        content: [{ type: "text", text: next }],
        warnings: [],
      };
    },
  } as unknown as LanguageModel;
}

async function runFollowUp(responses: string[], question: string) {
  return await generateVerifiedFollowUp({
    model: scriptedModel(responses),
    question,
    activeEvidence: activeEvidence(),
    recentConversation: "user: How do I use an AED?",
  });
}

test("a supported follow-up reports the cues it was built from", async () => {
  const result = await runFollowUp(
    [
      JSON.stringify({
        relation: "continue_to_use_evidence",
        sufficiency: "sufficient",
        supportingCueIds: ["T002"],
        relatedCueIds: ["T001"],
      }),
      JSON.stringify({
        claims: [
          { text: "Keep chest compressions going", cueIds: ["T002"] },
        ],
      }),
      JSON.stringify({
        verdict: "accept",
        utility: 5,
        claims: [{ claimIndex: 0, supported: true, cueIds: ["T002"] }],
      }),
    ],
    "Should compressions continue?"
  );

  // Only the selected cue is exposed, with whitespace normalised and clip-clock
  // timestamps matching the rendered citation.
  assert.deepEqual(result.citedCues, [
    {
      text: "Continue CPR while preparing the AED.",
      startSeconds: 36,
      endSeconds: 43,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result.citedCues), /T00\d|aed-bundle/);
});

test("deferrals and conversational turns expose no provenance", async () => {
  const deferred = await runFollowUp(
    [
      JSON.stringify({
        relation: "continue_to_use_evidence",
        sufficiency: "insufficient",
        supportingCueIds: [],
        relatedCueIds: [],
      }),
    ],
    "What dose of adrenaline is used?"
  );
  assert.deepEqual(deferred.citedCues, []);

  const conversational = await runFollowUp(
    [
      JSON.stringify({
        relation: "no_retrieval_needed",
        sufficiency: "insufficient",
        supportingCueIds: [],
        relatedCueIds: [],
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
  return { id, role, parts } as ChatMessage;
}

function procedureTurn(output: Record<string, unknown>) {
  return message("assistant-1", "assistant", [
    {
      type: "tool-searchProcedure",
      toolCallId: "tool-1",
      state: "output-available",
      output,
    },
  ]);
}

test("the active-source label names the bundle a follow-up would reuse", () => {
  const history = [
    procedureTurn({
      status: "answered",
      videoId: "aed-video",
      evidenceBundleId: "aed-bundle",
      sourceRetrievalQuery: "How do I use an AED?",
    }),
    message("user-2", "user", [{ type: "text", text: "and after that?" }]),
    message("assistant-2", "assistant", [
      { type: "text", text: "Keep going. [0:36–0:43]" },
    ]),
  ];

  assert.equal(activeSourceLabel(history), "How do I use an AED?");
  assert.equal(activeSourceLabel([]), null);
});

test("the active-source label clears when the newest search did not answer", () => {
  assert.equal(
    activeSourceLabel([
      procedureTurn({
        status: "answered",
        videoId: "aed-video",
        evidenceBundleId: "aed-bundle",
        sourceRetrievalQuery: "How do I use an AED?",
      }),
      procedureTurn({ status: "abstained" }),
    ]),
    null
  );
  // An answered result without a usable bundle is not a reusable source.
  assert.equal(
    activeSourceLabel([
      procedureTurn({ status: "answered", videoId: null }),
    ]),
    null
  );
});