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
];

const cues = buildFollowUpCues(evidence);

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
    videoUrl: "http://localhost/video.mp4",
    clipUrl: "http://localhost/clip.mp4",
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

type ScriptedModel = LanguageModel & { calls: string[] };

function scriptedModel(responses: string[]): ScriptedModel {
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

async function runFollowUp(responses: string[], question: string) {
  const model = scriptedModel(responses);
  const result = await generateVerifiedFollowUp({
    model,
    question,
    activeEvidence: activeEvidence(),
    recentConversation: "user: How do I use an AED?",
  });
  return { result, model };
}

const continueAssessment = JSON.stringify({
  relation: "continue_to_use_evidence",
  sufficiency: "sufficient",
  supportingCueIds: ["T002"],
  relatedCueIds: [],
});
const twoClaims = JSON.stringify({
  claims: [
    {
      text: "Keep chest compressions going while the AED is prepared",
      cueIds: ["T002"],
    },
    { text: "Expose the chest before the pads go on", cueIds: ["T002"] },
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
        relation,
        sufficiency: "sufficient",
        supportingCueIds: [],
        relatedCueIds: [],
      }),
      cues
    );
    assert.equal(parsed?.relation, relation);
  }

  const legacy = parseSemanticAssessment(
    JSON.stringify({
      relation: "same_topic",
      sufficiency: "sufficient",
      supportingCueIds: [],
      relatedCueIds: [],
    }),
    cues
  );
  assert.equal(legacy?.relation, "continue_to_use_evidence");

  assert.equal(
    parseSemanticAssessment(
      JSON.stringify({
        relation: "definitely_maybe",
        sufficiency: "sufficient",
        supportingCueIds: [],
        relatedCueIds: [],
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
        relation: "no_retrieval_needed",
        sufficiency: "insufficient",
        supportingCueIds: [],
        relatedCueIds: [],
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
    assert.match(reply, /^Happy to help\./);
    assert.doesNotMatch(reply, /compressions|\[0:31|T002/);
  }
});

test("a model-reported topic change defers and never retrieves", async () => {
  const { result, model } = await runFollowUp(
    [
      JSON.stringify({
        relation: "topic_change",
        sufficiency: "insufficient",
        supportingCueIds: [],
        relatedCueIds: [],
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
      verdict: "refine",
      utility: 4,
      claims: [
        { claimIndex: 0, support: "full", cueIds: ["T002"] },
        { claimIndex: 1, support: "partial", cueIds: [] },
        { claimIndex: 2, support: "none", cueIds: [] },
      ],
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
      verdict: "accept",
      claims: [
        { claimIndex: 0, supported: true, cueIds: [] },
        { claimIndex: 1, supported: false, cueIds: [] },
      ],
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
      JSON.stringify({ verdict: "accept", utility: 9, claims: [] }),
      ["T002"]
    ),
    null
  );
});

test("a partially grounded claim is kept but forced to state its limits", async () => {
  const { result } = await runFollowUp(
    [
      continueAssessment,
      JSON.stringify({
        claims: [
          {
            text: "Keep chest compressions going while the AED is prepared",
            cueIds: ["T002"],
          },
        ],
      }),
      JSON.stringify({
        verdict: "refine",
        utility: 4,
        claims: [{ claimIndex: 0, support: "partial", cueIds: ["T002"] }],
      }),
    ],
    "Should compressions continue while the AED is readied?"
  );

  // The assessment said "sufficient", but partial groundedness downgrades it.
  assert.equal(result.evidenceSufficiency, "partial");
  assert.equal(result.taxonomy, "helpful_deferral");
  assert.match(result.answer, /\[0:36–0:43\]/);
  assert.match(
    result.answer,
    /does not provide enough verified information in this segment/
  );
  assert.equal(validateFollowUpAnswer(result.answer, evidence).valid, true);
});

test("an unsupported claim is dropped and downgrades the remaining answer", async () => {
  const { result } = await runFollowUp(
    [
      continueAssessment,
      twoClaims,
      JSON.stringify({
        verdict: "refine",
        utility: 4,
        claims: [
          { claimIndex: 0, support: "full", cueIds: ["T002"] },
          { claimIndex: 1, support: "none", cueIds: [] },
        ],
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
            text: "Keep chest compressions going while the AED is prepared",
            cueIds: ["T002"],
          },
        ],
      }),
      JSON.stringify({
        verdict: "accept",
        utility: 5,
        claims: [{ claimIndex: 0, support: "full", cueIds: ["T002"] }],
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
        claims: [{ text: "The AED pads go on a bare chest", cueIds: ["T002"] }],
      }),
      JSON.stringify({
        verdict: "accept",
        utility: 1,
        claims: [{ claimIndex: 0, support: "full", cueIds: ["T002"] }],
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
            text: "Keep chest compressions going while the AED is prepared",
            cueIds: ["T002"],
          },
        ],
      }),
      JSON.stringify({
        verdict: "accept",
        claims: [{ claimIndex: 0, support: "full", cueIds: ["T002"] }],
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
          relation: "no_retrieval_needed",
          sufficiency: "insufficient",
          supportingCueIds: [],
          relatedCueIds: [],
        }),
        "You're welcome.",
      ],
      "thanks"
    );
    await runFollowUp(
      [
        JSON.stringify({
          relation: "topic_change",
          sufficiency: "insufficient",
          supportingCueIds: [],
          relatedCueIds: [],
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
