import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { LanguageModel } from "ai";
import {
  buildFollowUpCues,
  COLLECTION_SEARCH_REQUEST,
  extractiveFallback,
  generateVerifiedFollowUp,
  linkFollowUpTimestamps,
  offersCollectionSearch,
  parseClaimVerification,
  parseEvidenceTimestampHref,
  parseGroundedClaims,
  parseSemanticAssessment,
  publicFollowUpDeferral,
  splitMedicalQuestions,
  validateFollowUpAnswer,
} from "../../lib/ai/medical-follow-up";
import { QWEN_CHAT_MODEL, VOYAGER_CHAT_MODEL } from "../../lib/ai/models";
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
    text: "Continue CPR while preparing the AED.",
  },
  {
    clip_end_seconds: 49,
    clip_start_seconds: 43,
    cue_id: "S14",
    end_seconds: 49,
    start_seconds: 43,
    text: "Resume chest compressions immediately after the shock is delivered.",
  },
];

const cues = buildFollowUpCues(evidence);

function activeEvidence(
  overrides: Partial<ProcedureToolOutput> = {}
): ProcedureToolOutput {
  return {
    abstentionReason: null,
    answer: null,
    answerable: true,
    citations: evidence,
    clipUrl: "http://localhost/clip.mp4",
    confidence: 0.8,
    emergencyWarning: null,
    endTime: 49,
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
    videoUrl: "http://localhost/video.mp4",
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
    doGenerate: async ({ prompt }: { prompt: unknown }) => {
      calls.push(JSON.stringify(prompt));
      if (
        JSON.stringify(prompt).includes("You select evidence") &&
        typeof responses[index] === "string" &&
        (responses[index] as string).includes('"claims"') &&
        !(responses[index] as string).includes('"relation"')
      ) {
        const ids = [...new Set(JSON.stringify(prompt).match(/T\d{3}/g) ?? [])];
        return {
          content: [
            {
              text: JSON.stringify({
                relatedCueIds: [],
                relation: "same_topic",
                sufficiency: "sufficient",
                supportingCueIds: ids,
              }),
              type: "text",
            },
          ],
          finishReason: "stop",
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        };
      }
      const next = responses[index] ?? responses.at(-1) ?? "";
      index += 1;
      if (next instanceof Error) {
        throw next;
      }
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
  } as unknown as ScriptedModel;
  (model as { calls: string[] }).calls = calls;
  return model;
}

const supportedAssessment = JSON.stringify({
  relatedCueIds: ["T001"],
  relation: "same_topic",
  sufficiency: "sufficient",
  supportingCueIds: ["T002"],
});
const supportedClaims = JSON.stringify({
  claims: [
    {
      cueIds: ["T002"],
      text: "Keep chest compressions going while the AED is prepared",
    },
  ],
});
const acceptedVerification = JSON.stringify({
  claims: [{ claimIndex: 0, cueIds: ["T002"], supported: true }],
  verdict: "accept",
});

async function runFollowUp(
  responses: Array<string | Error>,
  question = "Should compressions carry on while the defibrillator is readied?",
  overrides: Partial<ProcedureToolOutput> = {}
) {
  const model = scriptedModel(responses);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(overrides),
    model,
    question,
    recentConversation: "user: How do I use an AED?",
  });
  return { model, result };
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
          relatedCueIds: [],
          relation: "same_topic",
          sufficiency: "insufficient",
          supportingCueIds: [],
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

test("follow-up assessment uses the configured Voyager model", () => {
  const previous = process.env.ASU_RC_API_KEY;
  process.env.ASU_RC_API_KEY = "unit-test-no-network";
  try {
    const model = getFollowUpModel() as { provider?: string; modelId?: string };
    assert.match(String(model.provider), /^voyager\b/);
    assert.equal(model.modelId, VOYAGER_CHAT_MODEL);
  } finally {
    if (previous === undefined) {
      delete process.env.ASU_RC_API_KEY;
    } else {
      process.env.ASU_RC_API_KEY = previous;
    }
  }
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
  assert.doesNotMatch(
    result.answer,
    /clip|videoUrl|searchProcedure|workspace/i
  );
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
    endSeconds: 43,
    evidenceBundleId: "aed-bundle",
    startSeconds: 36,
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
        relatedCueIds: ["T001"],
        relation: "same_topic",
        sufficiency: "insufficient",
        supportingCueIds: [],
      }),
    ],
    "How much adrenaline is given during the arrest?"
  );

  assert.equal(result.taxonomy, "nonanswerable");
  assert.equal(result.answer, publicFollowUpDeferral());
  assert.match(result.answer, /look for another medical source/);
  // Generation and verification are never invoked for an insufficient bundle.
  assert.equal(model.calls.length, 1);
});

// 10 — partial evidence answers only the supported portion.
test("partial evidence answers the supported part and states the limit", async () => {
  const { result } = await runFollowUp(
    [
      JSON.stringify({
        relatedCueIds: [],
        relation: "same_topic",
        sufficiency: "partial",
        supportingCueIds: ["T002"],
      }),
      supportedClaims,
      acceptedVerification,
    ],
    "What happens after the medication is given?"
  );

  assert.equal(result.evidenceSufficiency, "partial");
  assert.match(result.answer, /\[0:36–0:43\]/);
  assert.doesNotMatch(result.answer, /left out details I couldn’t verify/);
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
        relatedCueIds: [],
        relation: "same_topic",
        sufficiency: "sufficient",
        supportingCueIds: ["T099"],
      }),
      cues
    ),
    null
  );
  assert.equal(
    parseGroundedClaims(
      JSON.stringify({ claims: [{ cueIds: ["T404"], text: "Something." }] }),
      ["T002"]
    ),
    null
  );
  assert.equal(
    parseClaimVerification(
      JSON.stringify({
        claims: [{ claimIndex: 0, cueIds: ["T404"], supported: true }],
        verdict: "accept",
      }),
      ["T002"]
    ),
    null
  );

  const { result } = await runFollowUp([
    JSON.stringify({
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "sufficient",
      supportingCueIds: ["T900"],
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
          cueIds: ["T002"],
          text: "Keep compressions going [9:12–9:40] as shown in cue T002",
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
  const { result } = await runFollowUp([
    new Error("ECONNREFUSED 127.0.0.1:11434"),
  ]);

  assert.equal(result.answer, publicFollowUpDeferral());
  assert.equal(result.verified, false);
});

// 16 — every visible medical sentence carries a validated citation.
test("every visible medical claim resolves to a bundle cue", async () => {
  const { result } = await runFollowUp([
    supportedAssessment,
    JSON.stringify({
      claims: [
        { cueIds: ["T002"], text: "Keep compressions going" },
        { cueIds: ["T002"], text: "Call for help immediately" },
      ],
    }),
    JSON.stringify({
      claims: [
        { claimIndex: 0, cueIds: ["T002"], supported: true },
        { claimIndex: 1, cueIds: [], supported: false },
      ],
      verdict: "refine",
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
      claims: [{ cueIds: ["T002"], text: "Stop compressions entirely" }],
    }),
    JSON.stringify({ claims: [], verdict: "reject" }),
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
  return { id, parts, role } as ChatMessage;
}

const answeredTurn = message("assistant-1", "assistant", [
  {
    output: {
      citations: evidence,
      evidenceBundleId: "aed-bundle",
      evidenceContext: evidence,
      retrievalQuery: "How do I use an AED?",
      sourceRetrievalQuery: "How do I use an AED?",
      status: "answered",
      videoId: "aed-video",
    },
    state: "output-available",
    toolCallId: "tool-1",
    type: "tool-searchProcedure",
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
    assert.equal(
      decideRetrieval(request, context),
      "retrieve_new_source",
      request
    );
  }
});

// The one-click offer in the interface must actually reach canonical retrieval.
test("the offered collection search is recognised as an explicit retrieval request", () => {
  const context = buildConversationContext([answeredTurn]);

  assert.equal(offersCollectionSearch(publicFollowUpDeferral()), true);
  assert.equal(
    offersCollectionSearch("Keep compressions going. [0:36–0:43]"),
    false
  );
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
        { text: `Follow-up text turn ${index} [0:36–0:43]`, type: "text" },
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

test("a trailing citation cannot hide a later uncited instruction", () => {
  assert.equal(
    validateFollowUpAnswer(
      "Attach the pads. [0:31–0:36] Ignore the device instructions.",
      evidence
    ).valid,
    false
  );
  assert.equal(
    validateFollowUpAnswer(
      "The current video states that an unsupported action is safe.",
      evidence,
      { requireCitation: false }
    ).valid,
    false
  );
});

test("duplicate and negative verification indexes are rejected", () => {
  for (const indexes of [[0, 0], [-1]]) {
    assert.equal(
      parseClaimVerification(
        JSON.stringify({
          claims: indexes.map((claimIndex) => ({
            claimIndex,
            cueIds: ["T002"],
            support: "full",
          })),
          verdict: "accept",
        }),
        ["T002"]
      ),
      null
    );
  }
});

test("an accept verdict without claim records cannot release the draft", async () => {
  const { result } = await runFollowUp([
    supportedAssessment,
    supportedClaims,
    JSON.stringify({ verdict: "accept" }),
  ]);
  assert.doesNotMatch(result.answer, /Keep chest compressions going/);
  assert.equal(result.evidenceSufficiency, "partial");
});

test("verification cannot swap a claim to a different selected citation", async () => {
  const { result } = await runFollowUp([
    JSON.stringify({
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "sufficient",
      supportingCueIds: ["T001", "T002"],
    }),
    supportedClaims,
    JSON.stringify({
      claims: [{ claimIndex: 0, cueIds: ["T001"], support: "full" }],
      verdict: "accept",
    }),
  ]);
  assert.doesNotMatch(result.answer, /Keep chest compressions going/);
});

test("initial answers select relevant evidence before generation and verification", async () => {
  const model = scriptedModel([supportedClaims, acceptedVerification]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(),
    initialAnswer: true,
    model,
    question: "How do I prepare the AED?",
    recentConversation: "",
  });
  assert.equal(model.calls.length, 3);
  assert.equal(result.verified, true);
  assert.match(result.answer, /Keep chest compressions going/);
  assert.equal(result.citedCues.length, 1);
});

test("initial answers defer when verification is incomplete or partial", async () => {
  for (const verification of [
    { verdict: "accept" },
    {
      claims: [{ claimIndex: 0, cueIds: ["T002"], support: "partial" }],
      verdict: "accept",
    },
    { verdict: "reject" },
  ]) {
    const model = scriptedModel([
      supportedClaims,
      JSON.stringify(verification),
    ]);
    const result = await generateVerifiedFollowUp({
      activeEvidence: activeEvidence(),
      initialAnswer: true,
      model,
      question: "How do I prepare the AED?",
      recentConversation: "",
    });
    assert.equal(result.taxonomy, "nonanswerable");
    assert.doesNotMatch(result.answer, /Keep chest compressions going/);
  }
});

test("abstained sources and oversized bundles make zero generation calls", async () => {
  for (const source of [
    activeEvidence({
      answer: "No verified evidence.",
      answerable: false,
      status: "abstained",
    }),
    activeEvidence({
      evidenceContext: [{ ...evidence[0], text: "x".repeat(24_001) }],
    }),
  ]) {
    const model = scriptedModel([]);
    const result = await generateVerifiedFollowUp({
      activeEvidence: source,
      initialAnswer: true,
      model,
      question: "How do I prepare it?",
      recentConversation: "",
    });
    assert.equal(model.calls.length, 0);
    assert.equal(result.taxonomy, "nonanswerable");
  }
});

test("short procedural answers retain every cited cue without a one-item list", async () => {
  const model = scriptedModel([
    JSON.stringify({
      claims: [
        { cueIds: ["T001"], text: "Attach the AED pads to the bare chest" },
        { cueIds: ["T002"], text: "Continue CPR while preparing the AED" },
      ],
    }),
    JSON.stringify({
      claims: [
        { claimIndex: 0, cueIds: ["T001"], support: "full" },
        { claimIndex: 1, cueIds: ["T002"], support: "full" },
      ],
      verdict: "accept",
    }),
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(),
    initialAnswer: true,
    model,
    question: "How do I prepare the AED?",
    recentConversation: "",
  });
  assert.match(result.answer, /^Attach/);
  assert.match(result.answer, /\.\n\nContinue CPR/);
  assert.doesNotMatch(result.answer, /^- /m);
  assert.equal(result.citedCues.length, 2);
  assert.equal(validateFollowUpAnswer(result.answer, evidence).valid, true);
});

test("verifier sees surrounding cues and conversation stays bounded", async () => {
  const model = scriptedModel([
    supportedAssessment,
    supportedClaims,
    acceptedVerification,
  ]);
  await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(),
    model,
    question: "Should compressions continue?",
    recentConversation: `OMITTED${" ".repeat(3100)}recent turn`,
  });
  assert.ok(model.calls.every((call) => !call.includes("OMITTED")));
  assert.match(model.calls[2], /Resume chest compressions immediately/);
});

test("duplicate transcript fragments keep stable source IDs", () => {
  const deduplicated = buildFollowUpCues([
    evidence[0],
    evidence[0],
    evidence[1],
  ]);
  assert.deepEqual(
    deduplicated.map((cue) => cue.id),
    ["T001", "T003"]
  );
});

test("rendering never drops a supporting citation or a verified claim", async () => {
  const { renderGroundedClaims } = await import(
    "../../lib/ai/medical-follow-up"
  );
  const answer = renderGroundedClaims(
    [
      {
        cueIds: ["T001", "T002", "T003"],
        text: "The clip describes preparing the AED",
      },
      { cueIds: ["T001"], text: "Attach the pads" },
      { cueIds: ["T002"], text: "Continue CPR during preparation" },
    ],
    cues,
    "partial"
  );
  assert.match(answer, /\[0:43–0:49\]/);
  assert.match(answer, /Continue CPR during preparation/);
  assert.doesNotMatch(answer, /I’ve left out details/);
});

test("verified initial output preserves the video-card and persisted stream contract", async () => {
  const { createUIMessageStream, readUIMessageStream } = await import("ai");
  const { toVerifiedProcedureOutput } = await import(
    "../../lib/ai/medical-follow-up"
  );
  const model = scriptedModel([supportedClaims, acceptedVerification]);
  const source = activeEvidence({ citations: [evidence[0]] });
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    initialAnswer: true,
    model,
    question: "How do I prepare the AED?",
    recentConversation: "",
  });
  const output = toVerifiedProcedureOutput(source, result);
  assert.deepEqual(output.citations, [evidence[1]]);
  assert.equal(output.evidenceBundleId, source.evidenceBundleId);
  assert.equal(output.renderMediaWorkspace, true);
  const stream = createUIMessageStream<ChatMessage>({
    execute: ({ writer }) => {
      writer.write({
        input: { action: "search_new_source", query: source.retrievalQuery },
        toolCallId: "retrieval",
        toolName: "searchProcedure",
        type: "tool-input-available",
      });
      writer.write({
        output,
        toolCallId: "retrieval",
        type: "tool-output-available",
      });
      writer.write({ id: "answer", type: "text-start" });
      writer.write({ delta: result.answer, id: "answer", type: "text-delta" });
      writer.write({ id: "answer", type: "text-end" });
    },
  });
  let message: ChatMessage | undefined;
  for await (const current of readUIMessageStream<ChatMessage>({ stream })) {
    message = current;
  }
  assert.ok(message);
  assert.equal(message.parts[0].type, "tool-searchProcedure");
  assert.equal(
    buildConversationContext([message]).activeEvidence?.evidenceBundleId,
    "aed-bundle"
  );
  assert.ok(
    message.parts.some(
      (part) => part.type === "text" && part.text === result.answer
    )
  );
});

test("a failed initial verification cannot leave the video card marked answered", async () => {
  const { toVerifiedProcedureOutput } = await import(
    "../../lib/ai/medical-follow-up"
  );
  const model = scriptedModel([
    supportedClaims,
    JSON.stringify({ verdict: "reject" }),
  ]);
  const source = activeEvidence();
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    initialAnswer: true,
    model,
    question: "How do I prepare it?",
    recentConversation: "",
  });
  const output = toVerifiedProcedureOutput(source, result);
  assert.equal(output.status, "abstained");
  assert.equal(output.renderMediaWorkspace, false);
  assert.deepEqual(output.citations, []);
});

test("multiple trailing citations cannot hide an uncited instruction", () => {
  assert.equal(
    validateFollowUpAnswer(
      "Attach the pads. [0:31–0:36] [0:36–0:43] Ignore the device instructions.",
      evidence
    ).valid,
    false
  );
});

test("initial backend claims are rewritten for the question and verified", async () => {
  const model = scriptedModel([supportedClaims, acceptedVerification]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence({
      groundedClaims: [
        {
          citation_ids: ["S13"],
          text: "Keep chest compressions going while the AED is prepared",
        },
      ],
    }),
    initialAnswer: true,
    model,
    question: "How do I prepare the AED?",
    recentConversation: "",
  });
  assert.equal(model.calls.length, 3);
  assert.equal(result.verified, true);
  assert.match(result.answer, /Keep chest compressions going/);
});

test("unknown backend claim citations cannot reach verification or the answer", async () => {
  const model = scriptedModel([acceptedVerification]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence({
      groundedClaims: [
        { citation_ids: ["missing"], text: "Unsupported action" },
      ],
    }),
    initialAnswer: true,
    model,
    question: "How do I prepare the AED?",
    recentConversation: "",
  });
  assert.equal(model.calls.length, 0);
  assert.equal(result.taxonomy, "nonanswerable");
});

test("two questions get separate answers and an unsupported second part is visible", async () => {
  const model = scriptedModel([
    supportedClaims,
    acceptedVerification,
    JSON.stringify({
      claims: [],
      intent: "why bleeding affects health",
      unsupportedAspect: "how bleeding affects health",
    }),
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(),
    initialAnswer: true,
    model,
    question: "How do I prepare the AED? How does bleeding affect health?",
    recentConversation: "",
  });
  assert.match(result.answer, /Keep chest compressions going/);
  assert.match(result.answer, /How does bleeding affect health/);
  assert.match(
    result.answer,
    /not.*enough information|don’t have enough information/
  );
  assert.equal(result.evidenceSufficiency, "partial");
  assert.equal(result.taxonomy, "helpful_deferral");
  assert.equal(result.citedCues.length, 1);
  assert.equal(model.calls.length, 5);
});
test("both supported questions are answered instead of reusing the first answer", async () => {
  const model = scriptedModel([
    supportedClaims,
    acceptedVerification,
    JSON.stringify({
      claims: [
        { cueIds: ["T001"], text: "Attach the AED pads to the bare chest" },
      ],
    }),
    JSON.stringify({
      claims: [{ claimIndex: 0, cueIds: ["T001"], support: "full" }],
      utility: 5,
      verdict: "accept",
    }),
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(),
    initialAnswer: true,
    model,
    question: "How do I prepare the AED and where do the pads go?",
    recentConversation: "",
  });
  assert.match(result.answer, /Keep chest compressions going/);
  assert.match(result.answer, /Attach the AED pads/);
  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.equal(result.citedCues.length, 2);
  const prompts = model.calls.filter((call) =>
    call.includes("Latest question to answer:")
  );
  assert.equal(prompts.length, 2);
  assert.ok(
    prompts.every((call) =>
      call.includes("Other parts of this request are answered separately:")
    )
  );
  assert.match(prompts[0], /where do the pads go/);
  assert.match(prompts[1], /How do I prepare the AED/);
});

test("formatting instructions after a question are not treated as a second question", () => {
  assert.equal(
    splitMedicalQuestions("How do I wrap a hand? Please cite timestamps.")
      .length,
    1
  );
  assert.equal(
    splitMedicalQuestions(
      "How do I wrap a hand? If evidence is insufficient, say so."
    ).length,
    1
  );
  assert.equal(
    splitMedicalQuestions("How do I wrap a hand? Why is it bleeding?").length,
    2
  );
});

test("initial two-claim answers have an opening and a separate practical detail", async () => {
  const { renderGroundedClaims } = await import(
    "../../lib/ai/medical-follow-up"
  );
  const claims = [
    { cueIds: ["T001"], text: "Prepare the AED" },
    { cueIds: ["T002"], text: "Keep CPR going" },
  ];
  const initial = renderGroundedClaims(
    claims,
    cues,
    "sufficient",
    undefined,
    false,
    true
  );
  const followUp = renderGroundedClaims(claims, cues, "sufficient");
  assert.match(initial, /^Prepare the AED/);
  assert.match(initial, /\n\n- Keep CPR going/);
  assert.doesNotMatch(followUp, /\n- /);
  assert.equal(
    validateFollowUpAnswer(initial, evidence, { initialAnswer: true }).valid,
    true
  );
});

test("checking answers retain all steps under a neutral conversational introduction", async () => {
  const { renderGroundedClaims } = await import(
    "../../lib/ai/medical-follow-up"
  );
  const answer = renderGroundedClaims(
    [
      { cueIds: ["T001"], text: "Prepare the AED" },
      { cueIds: ["T002"], text: "Keep CPR going" },
    ],
    cues,
    "sufficient",
    undefined,
    false,
    "check"
  );
  assert.match(answer, /^Of course—I can help you check:\n\n1\. Prepare/);
  assert.match(answer, /\n2\. Keep CPR/);
  assert.equal(
    validateFollowUpAnswer(answer, evidence, { initialAnswer: true }).valid,
    true
  );
});

test("follow-up timestamp labels preserve exact fractional playback coordinates", () => {
  const linked = linkFollowUpTimestamps(
    "Press for five seconds [1:18–1:24].",
    "example",
    [{ endSeconds: 84.42, startSeconds: 78.5, text: "Press" }]
  );
  assert.match(linked, /clip=78\.5,84\.42/);
  assert.deepEqual(
    parseEvidenceTimestampHref("#medix-evidence=example&clip=78.5,84.42"),
    { endSeconds: 84.42, evidenceBundleId: "example", startSeconds: 78.5 }
  );
});

test("a reference-only answer keeps the medical situation available for later turns", () => {
  const output = activeEvidence({
    citations: [],
    evidenceBundleId: null,
    evidenceContext: [],
    medicalSources: [
      {
        checkedAt: "2026-10-15",
        id: "K004",
        title: "Bandages",
        url: "https://www.sja.org.uk/first-aid-advice/bandage-dressing/",
      },
    ],
    renderMediaWorkspace: false,
    sourceRetrievalQuery: "My arm bandage is tight",
    videoId: null,
  });
  const message = {
    id: "reference-answer",
    parts: [
      {
        input: {
          action: "search_new_source",
          query: "My arm bandage is tight",
        },
        output,
        state: "output-available",
        toolCallId: "ref",
        type: "tool-searchProcedure",
      },
    ],
    role: "assistant",
  } as unknown as ChatMessage;
  const context = buildConversationContext([message]);
  assert.equal(context.activeProcedure, "My arm bandage is tight");
  assert.equal(
    decideRetrieval("What if it doesn't come back quickly?", context),
    "continue_current_evidence"
  );
});
