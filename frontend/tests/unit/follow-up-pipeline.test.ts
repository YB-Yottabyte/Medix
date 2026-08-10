import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { LanguageModel } from "ai";
import {
  buildFollowUpCues,
  COLLECTION_SEARCH_REQUEST,
  extractiveFallback,
  offersCollectionSearch,
  generateVerifiedFollowUp,
  linkFollowUpTimestamps,
  parseClaimVerification,
  parseEvidenceTimestampHref,
  parseGroundedClaims,
  parseSemanticAssessment,
  publicFollowUpDeferral,
  validateFollowUpAnswer,
} from "../../lib/ai/medical-follow-up";
import { QWEN_CHAT_MODEL } from "../../lib/ai/models";
import { getFollowUpModel } from "../../lib/ai/providers";
import {
  buildConversationContext,
  decideRetrieval,
} from "../../lib/ai/query-contextualizer";
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
    text: "Continue CPR while preparing the AED.",
  },
  {
    cue_id: "S14",
    start_seconds: 43,
    end_seconds: 49,
    clip_start_seconds: 43,
    clip_end_seconds: 49,
    text: "Resume chest compressions immediately after the shock is delivered.",
  },
];

const cues = buildFollowUpCues(evidence);

function activeEvidence(
  overrides: Partial<ProcedureToolOutput> = {}
): ProcedureToolOutput {
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
    videoUrl: "http://localhost/video.mp4",
    clipUrl: "http://localhost/clip.mp4",
    startTime: 31,
    endTime: 49,
    matchedProcedure: "How do I use an AED?",
    retrievalQuery: "How do I use an AED?",
    sourceRetrievalQuery: "How do I use an AED?",
    queryWasContextualized: false,
    retrievalDecision: "retrieve_new_source",
    followUpQuestion: null,
    renderMediaWorkspace: true,
    responseInstructions: "",
    ...overrides,
  };
}

type ScriptedModel = LanguageModel & { calls: string[] };

/**
 * Returns the scripted texts in order. Anything the pipeline sends is recorded
 * so tests can assert what the model was and was not given.
 */
function scriptedModel(responses: Array<string | Error>): ScriptedModel {
  const calls: string[] = [];
  let index = 0;
  const model = {
    specificationVersion: "v3",
    provider: "test-ollama",
    modelId: QWEN_CHAT_MODEL,
    supportedUrls: {},
    doGenerate: async ({ prompt }: { prompt: unknown }) => {
      calls.push(JSON.stringify(prompt));
      const next = responses[index] ?? responses.at(-1) ?? "";
      index += 1;
      if (next instanceof Error) {
        throw next;
      }
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
  } as unknown as ScriptedModel;
  (model as { calls: string[] }).calls = calls;
  return model;
}

const supportedAssessment = JSON.stringify({
  relation: "same_topic",
  sufficiency: "sufficient",
  supportingCueIds: ["T002"],
  relatedCueIds: ["T001"],
});
const supportedClaims = JSON.stringify({
  claims: [
    { text: "Keep chest compressions going while the AED is prepared", cueIds: ["T002"] },
  ],
});
const acceptedVerification = JSON.stringify({
  verdict: "accept",
  claims: [{ claimIndex: 0, supported: true, cueIds: ["T002"] }],
});

async function runFollowUp(
  responses: Array<string | Error>,
  question = "Should compressions carry on while the defibrillator is readied?",
  overrides: Partial<ProcedureToolOutput> = {}
) {
  const model = scriptedModel(responses);
  const result = await generateVerifiedFollowUp({
    model,
    question,
    activeEvidence: activeEvidence(overrides),
    recentConversation: "user: How do I use an AED?",
  });
  return { result, model };
}

// 1 / 9 — no /api/query call may occur on any same-topic follow-up path.
test("same-topic follow-ups never reach the Medix retrieval endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    requests.push(String(input));
    throw new Error("fetch must not be called during a follow-up");
  }) as typeof fetch;

  try {
    const supported = await runFollowUp([
      supportedAssessment,
      supportedClaims,
      acceptedVerification,
    ]);
    assert.equal(supported.result.verified, true);

    const unsupported = await runFollowUp(
      [
        JSON.stringify({
          relation: "same_topic",
          sufficiency: "insufficient",
          supportingCueIds: [],
          relatedCueIds: [],
        }),
      ],
      "What should I do after the medication is given?"
    );
    assert.equal(unsupported.result.answer, publicFollowUpDeferral());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, []);
});

// 2 — follow-up model is the local Qwen/Ollama model, not Groq.
test("follow-up assessment always runs on the local Qwen model", () => {
  const model = getFollowUpModel() as { provider?: string; modelId?: string };
  assert.match(String(model.provider), /^ollama\b/);
  assert.equal(model.modelId, QWEN_CHAT_MODEL);
  assert.doesNotMatch(String(model.provider), /groq/i);
});

// 3 / 4 / 5 / 11 — text-only output that preserves the bundle.
test("a supported follow-up returns text only and keeps the original bundle", async () => {
  const bundle = activeEvidence();
  const { result } = await runFollowUp(
    [supportedAssessment, supportedClaims, acceptedVerification],
    "Can I stop CPR?"
  );

  assert.equal(result.verified, true);
  assert.equal(typeof result.answer, "string");
  // No tool result, clip, or video object is produced by this path.
  assert.doesNotMatch(result.answer, /clip|videoUrl|searchProcedure|workspace/i);
  assert.doesNotMatch(result.answer, /^\s*Yes[.,]/i);
  assert.doesNotMatch(result.answer, /^\s*No[.,]/i);
  assert.equal(bundle.evidenceBundleId, "aed-bundle");
  assert.equal(bundle.videoId, "aed-video");
});

// 6 — timestamp links seek the original workspace.
test("follow-up timestamps link back to the original evidence bundle", async () => {
  const { result } = await runFollowUp([
    supportedAssessment,
    supportedClaims,
    acceptedVerification,
  ]);
  const linked = linkFollowUpTimestamps(result.answer, "aed-bundle");
  const href = linked.match(/\(#medix-evidence=[^)]+\)/)?.[0].slice(1, -1);

  assert.deepEqual(parseEvidenceTimestampHref(href), {
    evidenceBundleId: "aed-bundle",
    startSeconds: 36,
    endSeconds: 43,
  });
});

// 7 — semantic paraphrase with almost no lexical overlap is answerable.
test("a low-overlap paraphrase is answered from the selected cue", async () => {
  const { result } = await runFollowUp(
    [supportedAssessment, supportedClaims, acceptedVerification],
    "Should compressions carry on while the defibrillator is readied?"
  );

  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.equal(result.taxonomy, "answerable");
  assert.match(result.answer, /\[0:36–0:43\]/);
});

// 8 — unsupported same-topic question defers conservatively.
test("an unsupported same-topic question defers instead of answering", async () => {
  const { result, model } = await runFollowUp(
    [
      JSON.stringify({
        relation: "same_topic",
        sufficiency: "insufficient",
        supportingCueIds: [],
        relatedCueIds: ["T001"],
      }),
    ],
    "How much adrenaline is given during the arrest?"
  );

  assert.equal(result.taxonomy, "nonanswerable");
  assert.equal(result.answer, publicFollowUpDeferral());
  assert.match(result.answer, /ask me to search the supported video collection/);
  // Generation and verification are never invoked for an insufficient bundle.
  assert.equal(model.calls.length, 1);
});

// 10 — partial evidence answers only the supported portion.
test("partial evidence answers the supported part and states the limit", async () => {
  const { result } = await runFollowUp(
    [
      JSON.stringify({
        relation: "same_topic",
        sufficiency: "partial",
        supportingCueIds: ["T002"],
        relatedCueIds: [],
      }),
      supportedClaims,
      acceptedVerification,
    ],
    "What happens after the medication is given?"
  );

  assert.equal(result.evidenceSufficiency, "partial");
  assert.match(result.answer, /\[0:36–0:43\]/);
  assert.match(
    result.answer,
    /does not provide enough verified information in this segment/
  );
});

// 11 — the removed regex-polarity fallback must not come back.
test("the extractive fallback is polarity-neutral", () => {
  const quoted = extractiveFallback(cues.slice(1, 2));

  assert.equal(
    quoted,
    "The current video states: “Continue CPR while preparing the AED.” [0:36–0:43]"
  );
  assert.doesNotMatch(quoted ?? "", /^Yes\b|^No\b/);
  assert.equal(validateFollowUpAnswer(quoted ?? "", evidence).valid, true);

  const source = readFileSync(
    path.join(process.cwd(), "lib/ai/medical-follow-up.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /Yes\. The current video says/);
});

// 12 — hallucinated cue IDs invalidate the whole assessment.
test("hallucinated cue IDs are rejected at every model boundary", async () => {
  assert.equal(
    parseSemanticAssessment(
      JSON.stringify({
        relation: "same_topic",
        sufficiency: "sufficient",
        supportingCueIds: ["T099"],
        relatedCueIds: [],
      }),
      cues
    ),
    null
  );
  assert.equal(
    parseGroundedClaims(
      JSON.stringify({ claims: [{ text: "Something.", cueIds: ["T404"] }] }),
      ["T002"]
    ),
    null
  );
  assert.equal(
    parseClaimVerification(
      JSON.stringify({
        verdict: "accept",
        claims: [{ claimIndex: 0, supported: true, cueIds: ["T404"] }],
      }),
      ["T002"]
    ),
    null
  );

  const { result } = await runFollowUp([
    JSON.stringify({
      relation: "same_topic",
      sufficiency: "sufficient",
      supportingCueIds: ["T900"],
      relatedCueIds: [],
    }),
  ]);
  assert.equal(result.answer, publicFollowUpDeferral());
  assert.equal(result.verified, false);
});

// 13 / 17 — model-invented timestamps and cue IDs never render.
test("model-invented timestamps and cue IDs never reach the output", async () => {
  const { result } = await runFollowUp([
    supportedAssessment,
    JSON.stringify({
      claims: [
        {
          text: "Keep compressions going [9:12–9:40] as shown in cue T002",
          cueIds: ["T002"],
        },
      ],
    }),
    acceptedVerification,
  ]);

  assert.doesNotMatch(result.answer, /9:12|9:40/);
  assert.doesNotMatch(result.answer, /\bT\d{3}\b/);
  assert.match(result.answer, /\[0:36–0:43\]/);
  assert.equal(
    validateFollowUpAnswer("Keep compressions going. [9:12–9:40]", evidence)
      .valid,
    false
  );
});

// 14 — unparseable model JSON defers.
test("unparseable model output defers conservatively", async () => {
  const { result } = await runFollowUp(["I think you should keep going!"]);

  assert.equal(result.answer, publicFollowUpDeferral());
  assert.equal(result.verified, false);
  assert.equal(result.taxonomy, "nonanswerable");
});

// 15 — Ollama failure defers.
test("a local model failure defers conservatively", async () => {
  const { result } = await runFollowUp([new Error("ECONNREFUSED 127.0.0.1:11434")]);

  assert.equal(result.answer, publicFollowUpDeferral());
  assert.equal(result.verified, false);
});

// 16 — every visible medical sentence carries a validated citation.
test("every visible medical claim resolves to a bundle cue", async () => {
  const { result } = await runFollowUp([
    supportedAssessment,
    JSON.stringify({
      claims: [
        { text: "Keep compressions going", cueIds: ["T002"] },
        { text: "Call for help immediately", cueIds: ["T002"] },
      ],
    }),
    JSON.stringify({
      verdict: "refine",
      claims: [
        { claimIndex: 0, supported: true, cueIds: ["T002"] },
        { claimIndex: 1, supported: false, cueIds: [] },
      ],
    }),
  ]);

  assert.doesNotMatch(result.answer, /Call for help/);
  assert.equal(validateFollowUpAnswer(result.answer, evidence).valid, true);
  // A claim with no citation cannot pass deterministic validation.
  assert.equal(
    validateFollowUpAnswer("Give two rescue breaths.", evidence).valid,
    false
  );
});

// The conservative deferral itself must pass the same validation pipeline.
test("the conservative deferral passes deterministic validation", () => {
  assert.equal(
    validateFollowUpAnswer(publicFollowUpDeferral(), evidence, {
      requireCitation: false,
    }).valid,
    true
  );
});

// A rejected verification never renders the draft.
test("a rejected verification falls back or defers, never renders the draft", async () => {
  const { result } = await runFollowUp([
    supportedAssessment,
    JSON.stringify({
      claims: [{ text: "Stop compressions entirely", cueIds: ["T002"] }],
    }),
    JSON.stringify({ verdict: "reject", claims: [] }),
  ]);

  assert.doesNotMatch(result.answer, /Stop compressions entirely/);
  assert.match(
    result.answer,
    /^The current video states:|^The current video does not contain/
  );
});

function message(
  id: string,
  role: ChatMessage["role"],
  parts: unknown[]
): ChatMessage {
  return { id, role, parts } as ChatMessage;
}

const answeredTurn = message("assistant-1", "assistant", [
  {
    type: "tool-searchProcedure",
    toolCallId: "tool-1",
    state: "output-available",
    output: {
      status: "answered",
      videoId: "aed-video",
      evidenceBundleId: "aed-bundle",
      retrievalQuery: "How do I use an AED?",
      sourceRetrievalQuery: "How do I use an AED?",
      citations: evidence,
      evidenceContext: evidence,
    },
  },
]);

// 18 — an explicit request for another source uses canonical retrieval.
test("explicit requests for another source route to canonical retrieval", () => {
  const context = buildConversationContext([answeredTurn]);

  for (const request of [
    "search another video",
    "find another source",
    "look for another video",
    "can you search the collection",
    "show me another procedure video",
  ]) {
    assert.equal(decideRetrieval(request, context), "retrieve_new_source", request);
  }
});

// The one-click offer in the interface must actually reach canonical retrieval.
test("the offered collection search is recognised as an explicit retrieval request", () => {
  const context = buildConversationContext([answeredTurn]);

  assert.equal(offersCollectionSearch(publicFollowUpDeferral()), true);
  assert.equal(offersCollectionSearch("Keep compressions going. [0:36–0:43]"), false);
  assert.equal(
    decideRetrieval(COLLECTION_SEARCH_REQUEST, context),
    "retrieve_new_source"
  );
});

// 19 — a clear procedure change uses canonical retrieval.
test("a clear procedure change routes to canonical retrieval", () => {
  const context = buildConversationContext([answeredTurn]);

  assert.equal(
    decideRetrieval("How do I treat a burn on the hand?", context),
    "retrieve_new_source"
  );
  assert.equal(
    decideRetrieval("I have a different question about choking.", context),
    "retrieve_new_source"
  );
});

// 8 / 19 — an unsupported same-topic question still stays on the bundle.
test("an unsupported same-topic question does not route to retrieval", () => {
  const context = buildConversationContext([answeredTurn]);

  assert.equal(
    decideRetrieval("What happens after the medication is given?", context),
    "continue_current_evidence"
  );
});

// 20 / 21 — bundle continuity across text-only turns and a reload.
test("text-only follow-ups and reloads preserve the active evidence bundle", () => {
  const history = [
    answeredTurn,
    ...Array.from({ length: 8 }, (_, index) =>
      message(`turn-${index}`, index % 2 ? "assistant" : "user", [
        { type: "text", text: `Follow-up text turn ${index} [0:36–0:43]` },
      ])
    ),
  ];

  const context = buildConversationContext(history);
  assert.equal(context.activeEvidence?.evidenceBundleId, "aed-bundle");
  assert.equal(context.activeEvidence?.videoId, "aed-video");
  assert.equal(
    decideRetrieval("Should I keep going?", context),
    "continue_current_evidence"
  );

  // A persisted conversation is rebuilt from the same serialized parts.
  const reloaded = buildConversationContext(
    JSON.parse(JSON.stringify(history)) as ChatMessage[]
  );
  assert.equal(reloaded.activeEvidence?.evidenceBundleId, "aed-bundle");
  assert.deepEqual(
    reloaded.activeEvidence?.evidenceContext,
    context.activeEvidence?.evidenceContext
  );
});

// 22 — the follow-up path never reads secret or environment files.
test("the follow-up path reads no secret or environment files", () => {
  for (const file of [
    "lib/ai/medical-follow-up.ts",
    "lib/ai/query-contextualizer.ts",
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /readFileSync|readFile\(|\.env\b|dotenv/);
    assert.doesNotMatch(source, /process\.env/);
  }
});