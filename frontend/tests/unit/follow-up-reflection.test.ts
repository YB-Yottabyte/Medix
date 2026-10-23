/**
 * Regression tests for the SELF-multi-RAG reflection signals adopted in the
 * follow-up pipeline (Roy et al., 2024, arXiv:2409.15515):
 * the three-way retrieval relation, graded groundedness, and the utility gate.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModel } from "ai";
import {
  buildFollowUpCues,
  generateVerifiedFollowUp,
  parseClaimVerification,
  parseSemanticAssessment,
  publicFollowUpDeferral,
  validateConversationalReply,
  validateFollowUpAnswer,
} from "../../lib/ai/medical-follow-up";
import { QWEN_CHAT_MODEL } from "../../lib/ai/models";
import type {
  ProcedureToolOutput,
  TranscriptCitation,
} from "../../lib/ai/tools/search-procedure";

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
];

const cues = buildFollowUpCues(evidence);

function activeEvidence(): ProcedureToolOutput {
  return {
    abstentionReason: null,
    answer: null,
    answerable: true,
    citations: evidence,
    clipUrl: "http://localhost/clip.mp4",
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
    videoUrl: "http://localhost/video.mp4",
  };
}

type ScriptedModel = LanguageModel & { calls: string[] };

function scriptedModel(responses: string[]): ScriptedModel {
  const calls: string[] = [];
  let index = 0;
  const model = {
    doGenerate: async ({ prompt }: { prompt: unknown }) => {
      calls.push(JSON.stringify(prompt));
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
  } as unknown as ScriptedModel;
  (model as { calls: string[] }).calls = calls;
  return model;
}

async function runFollowUp(responses: string[], question: string) {
  const model = scriptedModel(responses);
  const result = await generateVerifiedFollowUp({
    activeEvidence: activeEvidence(),
    model,
    question,
    recentConversation: "user: How do I use an AED?",
  });
  return { model, result };
}

const continueAssessment = JSON.stringify({
  relatedCueIds: [],
  relation: "continue_to_use_evidence",
  sufficiency: "sufficient",
  supportingCueIds: ["T002"],
});
const twoClaims = JSON.stringify({
  claims: [
    {
      cueIds: ["T002"],
      text: "Keep chest compressions going while the AED is prepared",
    },
    { cueIds: ["T002"], text: "Expose the chest before the pads go on" },
  ],
});

// --- Three-way retrieval relation ([Retrieve] / [No Retrieve] / [Continue]) ---

test("the assessment parser accepts the three-way relation and the legacy alias", () => {
  const relations = [
    "continue_to_use_evidence",
    "no_retrieval_needed",
    "topic_change",
  ];
  for (const relation of relations) {
    const parsed = parseSemanticAssessment(
      JSON.stringify({
        relatedCueIds: [],
        relation,
        sufficiency: "sufficient",
        supportingCueIds: [],
      }),
      cues
    );
    assert.equal(parsed?.relation, relation);
  }

  const legacy = parseSemanticAssessment(
    JSON.stringify({
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "sufficient",
      supportingCueIds: [],
    }),
    cues
  );
  assert.equal(legacy?.relation, "continue_to_use_evidence");

  assert.equal(
    parseSemanticAssessment(
      JSON.stringify({
        relatedCueIds: [],
        relation: "definitely_maybe",
        sufficiency: "sufficient",
        supportingCueIds: [],
      }),
      cues
    ),
    null
  );
});

test("a [No Retrieve] turn gets a conversational reply, not a medical deferral", async () => {
  const { result, model } = await runFollowUp(
    [
      JSON.stringify({
        relatedCueIds: [],
        relation: "no_retrieval_needed",
        sufficiency: "insufficient",
        supportingCueIds: [],
      }),
      "You're welcome. Let me know if anything else comes up.",
    ],
    "could you say that a bit more simply?"
  );

  assert.equal(result.relation, "no_retrieval_needed");
  assert.equal(result.taxonomy, "conversational");
  assert.equal(result.verified, true);
  assert.notEqual(result.answer, publicFollowUpDeferral());
  assert.doesNotMatch(
    result.answer,
    /does not contain enough verified evidence/
  );
  // Assessment plus one conversational generation: no grounded generation and
  // no verification pass for an ungrounded turn.
  assert.equal(model.calls.length, 2);
});

test("deterministic small talk skips the evidence assessment entirely", async () => {
  for (const greeting of ["Hi", "thanks!", "What can you do?"]) {
    const { result, model } = await runFollowUp(
      ["Happy to help — ask me a first-aid question any time."],
      greeting
    );

    assert.equal(result.relation, "no_retrieval_needed", greeting);
    assert.equal(result.taxonomy, "conversational", greeting);
    assert.notEqual(result.answer, publicFollowUpDeferral());
    // One call: no assessment, no grounded generation, no verification.
    assert.equal(model.calls.length, 1, greeting);
  }
});

test("a conversational reply may not smuggle in medical content", () => {
  assert.equal(
    validateConversationalReply("You're welcome, glad it helped."),
    "You're welcome, glad it helped."
  );
  // Medical instruction, a timestamp, over-length, and internal IDs are all
  // replaced with the fixed acknowledgement.
  for (const unsafe of [
    "You're welcome. Remember to keep doing chest compressions until help arrives.",
    "Glad it helped. Rewatch the pad placement at [0:31–0:36].",
    "Sure thing, see cue T002 for details.",
    `Absolutely. ${"word ".repeat(60)}`,
  ]) {
    const reply = validateConversationalReply(unsafe);
    assert.match(
      reply,
      /^What else would you like to know about this medical procedure\?/
    );
    assert.doesNotMatch(reply, /compressions|\[0:31|T002/);
  }
});

test("a model-reported topic change defers and never retrieves", async () => {
  const { result, model } = await runFollowUp(
    [
      JSON.stringify({
        relatedCueIds: [],
        relation: "topic_change",
        sufficiency: "insufficient",
        supportingCueIds: [],
      }),
    ],
    "How do I treat a burn?"
  );

  assert.equal(result.relation, "topic_change");
  assert.equal(result.answer, publicFollowUpDeferral());
  assert.equal(model.calls.length, 1);
});

// --- Graded groundedness ([Fully] / [Partially] / [No support]) ---

test("the verification parser accepts graded support and the legacy boolean", () => {
  const graded = parseClaimVerification(
    JSON.stringify({
      claims: [
        { claimIndex: 0, cueIds: ["T002"], support: "full" },
        { claimIndex: 1, cueIds: [], support: "partial" },
        { claimIndex: 2, cueIds: [], support: "none" },
      ],
      utility: 4,
      verdict: "refine",
    }),
    ["T002"]
  );
  assert.deepEqual(
    graded?.claims.map((claim) => claim.support),
    ["full", "partial", "none"]
  );
  assert.equal(graded?.utility, 4);

  const legacy = parseClaimVerification(
    JSON.stringify({
      claims: [
        { claimIndex: 0, cueIds: [], supported: true },
        { claimIndex: 1, cueIds: [], supported: false },
      ],
      verdict: "accept",
    }),
    ["T002"]
  );
  assert.deepEqual(
    legacy?.claims.map((claim) => claim.support),
    ["full", "none"]
  );
  assert.equal(legacy?.utility, undefined);

  // An out-of-range utility invalidates the whole verification.
  assert.equal(
    parseClaimVerification(
      JSON.stringify({ claims: [], utility: 9, verdict: "accept" }),
      ["T002"]
    ),
    null
  );
});

test("a partially grounded claim is replaced by a limited source quotation", async () => {
  const { result } = await runFollowUp(
    [
      continueAssessment,
      JSON.stringify({
        claims: [
          {
            cueIds: ["T002"],
            text: "Keep chest compressions going while the AED is prepared",
          },
        ],
      }),
      JSON.stringify({
        claims: [{ claimIndex: 0, cueIds: ["T002"], support: "partial" }],
        utility: 4,
        verdict: "refine",
      }),
    ],
    "Should compressions continue while the AED is readied?"
  );

  assert.doesNotMatch(result.answer, /Keep chest compressions going/);
  assert.match(result.answer, /^The current video states:/);
  // A partial claim is not shown as verified guidance.
  assert.equal(result.evidenceSufficiency, "partial");
  assert.equal(result.taxonomy, "helpful_deferral");
  assert.match(result.answer, /\[0:36–0:43\]/);
  assert.doesNotMatch(result.answer, /left out details I couldn’t verify/);
  assert.equal(validateFollowUpAnswer(result.answer, evidence).valid, true);
});

test("an unsupported claim is dropped and downgrades the remaining answer", async () => {
  const { result } = await runFollowUp(
    [
      continueAssessment,
      twoClaims,
      JSON.stringify({
        claims: [
          { claimIndex: 0, cueIds: ["T002"], support: "full" },
          { claimIndex: 1, cueIds: [], support: "none" },
        ],
        utility: 4,
        verdict: "refine",
      }),
    ],
    "Should compressions continue while the AED is readied?"
  );

  assert.doesNotMatch(result.answer, /Expose the chest/);
  assert.match(result.answer, /Keep chest compressions going/);
  assert.equal(result.evidenceSufficiency, "partial");
});

test("fully grounded claims keep the sufficient classification", async () => {
  const { result } = await runFollowUp(
    [
      continueAssessment,
      JSON.stringify({
        claims: [
          {
            cueIds: ["T002"],
            text: "Keep chest compressions going while the AED is prepared",
          },
        ],
      }),
      JSON.stringify({
        claims: [{ claimIndex: 0, cueIds: ["T002"], support: "full" }],
        utility: 5,
        verdict: "accept",
      }),
    ],
    "Should compressions continue while the AED is readied?"
  );

  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.equal(result.taxonomy, "answerable");
  assert.equal(result.relation, "continue_to_use_evidence");
  assert.doesNotMatch(result.answer, /does not provide enough verified/);
});

// --- Utility gate ---

test("a grounded answer that does not address the question is not shown", async () => {
  const { result } = await runFollowUp(
    [
      continueAssessment,
      JSON.stringify({
        claims: [{ cueIds: ["T002"], text: "The AED pads go on a bare chest" }],
      }),
      JSON.stringify({
        claims: [{ claimIndex: 0, cueIds: ["T002"], support: "full" }],
        utility: 1,
        verdict: "accept",
      }),
    ],
    "How long should I keep going?"
  );

  // Low utility falls back to the neutral quotation or the deferral, never the
  // confidently-worded but unresponsive draft.
  assert.doesNotMatch(result.answer, /The AED pads go on a bare chest \[/);
  assert.match(
    result.answer,
    /^The current video states:|^The current video does not contain/
  );
});

test("a missing utility score does not block a supported answer", async () => {
  const { result } = await runFollowUp(
    [
      continueAssessment,
      JSON.stringify({
        claims: [
          {
            cueIds: ["T002"],
            text: "Keep chest compressions going while the AED is prepared",
          },
        ],
      }),
      JSON.stringify({
        claims: [{ claimIndex: 0, cueIds: ["T002"], support: "full" }],
        verdict: "accept",
      }),
    ],
    "Should compressions continue while the AED is readied?"
  );

  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.match(result.answer, /Keep chest compressions going/);
});

// --- Invariants that must survive the new reflection signals ---

test("no reflection path reaches the retrieval endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    requests.push(String(input));
    throw new Error("fetch must not be called during a follow-up");
  }) as typeof fetch;

  try {
    await runFollowUp(
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
    await runFollowUp(
      [
        JSON.stringify({
          relatedCueIds: [],
          relation: "topic_change",
          sufficiency: "insufficient",
          supportingCueIds: [],
        }),
      ],
      "How do I treat a burn?"
    );
    await runFollowUp(
      [continueAssessment, twoClaims, JSON.stringify({ verdict: "reject" })],
      "Should compressions continue?"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, []);
});
