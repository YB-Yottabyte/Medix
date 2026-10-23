import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModel } from "ai";
import {
  generateVerifiedFollowUp,
  limitationSentence,
  toVerifiedProcedureOutput,
} from "../../lib/ai/medical-follow-up";
import {
  medicalPassages,
  retrieveMedicalReferences,
  selectedMedicalPassages,
} from "../../lib/ai/medical-knowledge";
import {
  completePlayableCue,
  explicitCriticalDetails,
  hasMedicationRecommendation,
  planResponse,
  relevantToResponsePlan,
  safeFollowUp,
  splitEvidenceCandidates,
  stripStockAssurance,
} from "../../lib/ai/response-composition";
import type { ProcedureToolOutput } from "../../lib/ai/tools/search-procedure";

function scripted(outputs: unknown[]) {
  const calls: string[] = [];
  const formats: unknown[] = [];
  const model = {
    doGenerate: async ({
      prompt,
      responseFormat,
    }: {
      prompt: unknown;
      responseFormat?: unknown;
    }) => {
      calls.push(JSON.stringify(prompt));
      formats.push(responseFormat);
      if (
        JSON.stringify(prompt).includes("You select evidence") &&
        !(outputs[0] as { relation?: string })?.relation
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
      return {
        content: [{ text: JSON.stringify(outputs.shift()), type: "text" }],
        finishReason: "stop",
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      };
    },
    modelId: "medical-test",
    provider: "test",
    specificationVersion: "v3",
    supportedUrls: {},
  } as unknown as LanguageModel;
  return { calls, formats, model };
}
const source = {
  answerable: true,
  citations: [],
  evidenceBundleId: "bandage-bundle",
  evidenceContext: [
    {
      clip_end_seconds: 84.42,
      clip_start_seconds: 78.5,
      cue_id: "T001",
      end_seconds: 174.42,
      start_seconds: 168.5,
      text: "Press their nailbed or skin beyond the bandage for 5 seconds.",
    },
    {
      clip_end_seconds: 91.54,
      clip_start_seconds: 84.42,
      cue_id: "T002",
      end_seconds: 181.54,
      start_seconds: 174.42,
      text: "Release pressure. If colour does not return within two seconds, the bandage is too tight.",
    },
  ],
  renderMediaWorkspace: true,
  retrievalQuery: "How to check a bandage",
  safetyDisposition: "supported",
  sourceRetrievalQuery: "How to check a bandage",
  status: "answered",
  videoId: "test-video",
} as unknown as ProcedureToolOutput;
const question =
  "I just put this bandage on someone's arm. How do I know if it's too tight?";

test("source selection has explicit topic, scope and freshness boundaries", () => {
  assert.deepEqual(
    retrieveMedicalReferences(question).map((ref) => ref.id),
    ["K001", "K004", "K005"]
  );
  assert.equal(
    retrieveMedicalReferences("What about it now?", question).length,
    3
  );
  assert.deepEqual(
    retrieveMedicalReferences("How do I cool a burn?", question).map(
      (ref) => ref.id
    ),
    ["K003"]
  );
  assert.equal(
    retrieveMedicalReferences("How do I use an AED?", question).length,
    0
  );
  assert.equal(
    retrieveMedicalReferences("My surgical bandage is tight").length,
    0
  );
  assert.equal(
    retrieveMedicalReferences("My bandage is tight", "I had surgery").length,
    0
  );
  assert.equal(
    retrieveMedicalReferences(question, "", new Date("2027-05-01")).length,
    0
  );
});

test("response budgets adapt to complexity and explicit brevity", () => {
  assert.ok(
    planResponse(question, true).maxWords >
      planResponse("How long should I press?", false).maxWords
  );
  assert.equal(
    planResponse("Explain in one simple sentence", true).maxClaims,
    2
  );
});

test("mixed provenance creates independent support checks without invented timestamps", () => {
  const candidates = splitEvidenceCandidates(
    [{ cueIds: ["T001", "K001"], text: "Loosen it if needed" }],
    new Set(["K001"])
  );
  assert.deepEqual(
    candidates.map((claim) => claim.cueIds),
    [["T001"], ["K001"]]
  );
});

test("medical references are audited once and the reviewer selects the supporting subset", () => {
  const candidates = splitEvidenceCandidates(
    [{ cueIds: ["K001", "K004"], text: "A supported action" }],
    new Set(["K001", "K004"])
  );
  assert.deepEqual(
    candidates.map((claim) => claim.cueIds),
    [["K001", "K004"]]
  );
});

for (const hasImage of [false, true]) {
  test(`bandage answer preserves video, adds checked next actions and one useful question (image=${hasImage})`, async () => {
    const { model, calls } = scripted([
      {
        claims: [
          {
            cueIds: ["T001", "T002"],
            role: "answer",
            text: "You can check whether it's too tight by testing the circulation beyond their bandage",
          },
          {
            cueIds: ["T001", "T002"],
            role: "step",
            text: "Press their nailbed for 5 seconds, release, and check that colour returns within two seconds",
          },
          {
            cueIds: ["K001"],
            role: "action",
            text: "If the colour does not return within two seconds, loosen the bandage slightly",
          },
          {
            cueIds: ["K001"],
            role: "warning",
            text: "Loss of feeling or trouble moving near a cut needs emergency care",
          },
        ],
        followUpQuestion:
          "Are they having any numbness or trouble moving their fingers?",
        unsupportedAspect: "",
      },
      {
        claims: [
          { claimIndex: 0, cueIds: ["T001", "T002"], support: "full" },
          { claimIndex: 1, cueIds: ["T001", "T002"], support: "full" },
          { claimIndex: 2, cueIds: ["K001"], support: "full" },
          { claimIndex: 3, cueIds: ["K001"], support: "full" },
        ],
        followUpSafe: true,
        utility: 5,
        verdict: "accept",
      },
    ]);
    const answer = await generateVerifiedFollowUp({
      activeEvidence: source,
      hasImage,
      initialAnswer: true,
      model,
      question: `${question} The bandage covers a cut.`,
      recentConversation: "",
    });
    assert.equal(answer.evidenceSufficiency, "sufficient");
    assert.match(answer.answer, /^You can check/);
    assert.match(answer.answer, /5 seconds/);
    assert.doesNotMatch(answer.answer, /Additional medical guidance/);
    assert.match(
      answer.answer,
      /https:\/\/www.nhs.uk\/conditions\/cuts-and-grazes\//
    );
    assert.doesNotMatch(answer.answer, /loosen[^\n]*\[\d+:/i);
    assert.equal((answer.answer.match(/\?/g) ?? []).length, 1);
    assert.equal(answer.citedCues.length, 2);
    assert.equal(
      toVerifiedProcedureOutput(source, answer).renderMediaWorkspace,
      true
    );
    assert.match(
      calls[1],
      hasImage ? /Image attached: yes/ : /Image attached: no/
    );
    assert.equal(calls.length, 3);
  });
}

test("an additional action cannot inherit support from a video-only alternative", async () => {
  const { model } = scripted([
    {
      claims: [
        {
          cueIds: ["T002", "K001"],
          text: "If colour is slow to return, loosen the bandage slightly",
        },
      ],
    },
    {
      claims: [{ claimIndex: 0, cueIds: ["K001"], support: "full" }],
      utility: 5,
      verdict: "refine",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    initialAnswer: true,
    model,
    question,
    recentConversation: "",
  });
  assert.match(result.answer, /www.nhs.uk/);
  assert.doesNotMatch(result.answer, /\[1:/);
  assert.equal(result.evidenceSufficiency, "sufficient");
});

test("unknown medical source IDs are rejected before verification", async () => {
  const { model, calls } = scripted([
    { claims: [{ cueIds: ["K999"], text: "An unsupported recommendation" }] },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    initialAnswer: true,
    model,
    question,
    recentConversation: "",
  });
  assert.equal(result.taxonomy, "nonanswerable");
  assert.equal(calls.length, 3);
  assert(calls.every((call) => !call.includes("You verify")));
});

test("follow-ups require verification and cannot smuggle advice, links or multiple questions", () => {
  assert.equal(safeFollowUp("Does it feel numb?", false), null);
  assert.equal(safeFollowUp("Should you take medication?", true), null);
  assert.equal(safeFollowUp("Is it numb? Is it blue?", true), null);
  assert.equal(safeFollowUp("Does it feel numb?", true), "Does it feel numb?");
});

test("existing emergency/restricted gate cannot be overridden by extra references", async () => {
  const { model, calls } = scripted([]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: {
      ...source,
      answer: "Call emergency help now.",
      answerable: false,
      safetyDisposition: "emergency",
      status: "abstained",
    },
    initialAnswer: true,
    model,
    question,
    recentConversation: "",
  });
  assert.equal(result.answer, "Call emergency help now.");
  assert.equal(calls.length, 0);
});

test("critical action and quantity checks reject a plausible but misattributed timestamp", () => {
  assert.equal(
    explicitCriticalDetails(
      "Press for 5 seconds, then release",
      "Press for five seconds"
    ),
    false
  );
  assert.equal(
    explicitCriticalDetails("Press for 10 seconds", "Press for five seconds"),
    false
  );
  assert.equal(
    explicitCriticalDetails(
      "Press for 5 seconds, then release",
      "Press for five seconds. Release pressure."
    ),
    true
  );
});

test("burn guidance uses its checked source without manufacturing a playable clip", async () => {
  const { model } = scripted([
    {
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "insufficient",
      supportingCueIds: [],
    },
    {
      claims: [
        {
          cueIds: ["K003"],
          role: "answer",
          text: "Cool a thermal burn under cool running water for 20 minutes",
        },
        {
          cueIds: ["K003"],
          role: "warning",
          text: "Do not put butter, creams or oils on the burn",
        },
        {
          cueIds: ["K003"],
          role: "action",
          text: "Very large or deep burns need emergency care",
        },
      ],
      unsupportedAspect: "",
    },
    {
      claims: [0, 1, 2].map((claimIndex) => ({
        claimIndex,
        cueIds: ["K003"],
        support: "full",
      })),
      utility: 5,
      verdict: "accept",
    },
  ]);
  const burnSource = {
    ...source,
    retrievalQuery: "How to treat a thermal burn",
    sourceRetrievalQuery: "How to treat a thermal burn",
  };
  const result = await generateVerifiedFollowUp({
    activeEvidence: burnSource,
    initialAnswer: true,
    model,
    question: "I burned my arm on a pan. What should I do?",
    recentConversation: "",
  });
  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.match(result.answer, /20 minutes/);
  assert.match(
    result.answer,
    /https:\/\/www.nhs.uk\/conditions\/burns-and-scalds\//
  );
  assert.equal(result.citedCues.length, 0);
  assert.equal(toVerifiedProcedureOutput(burnSource, result).answerable, true);
  assert.equal(
    toVerifiedProcedureOutput(burnSource, result).renderMediaWorkspace,
    false
  );
});

test("a verifier cannot bless an invented duration into the final answer", async () => {
  const { model } = scripted([
    { claims: [{ cueIds: ["T001"], text: "Press for 30 seconds" }] },
    {
      claims: [{ claimIndex: 0, cueIds: ["T001"], support: "full" }],
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    initialAnswer: true,
    model,
    question,
    recentConversation: "",
  });
  assert.equal(result.taxonomy, "nonanswerable");
  assert.doesNotMatch(result.answer, /30 seconds/);
});

test("a medicine recommendation cannot pass merely because a transcript contains it", async () => {
  assert.equal(
    hasMedicationRecommendation(
      "Apply an over-the-counter antibiotic ointment"
    ),
    true
  );
  assert.equal(hasMedicationRecommendation("Do not apply ointments"), false);
  const { model } = scripted([
    { claims: [{ cueIds: ["T001"], text: "Apply an antibiotic ointment" }] },
    {
      claims: [{ claimIndex: 0, cueIds: ["T001"], support: "full" }],
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: {
      ...source,
      evidenceContext: [
        {
          cue_id: "T001",
          end_seconds: 4,
          start_seconds: 0,
          text: "Apply an antibiotic ointment.",
        },
      ],
      sourceRetrievalQuery: "Burn care",
    },
    initialAnswer: true,
    model,
    question: "How should I care for this burn?",
    recentConversation: "",
  });
  assert.equal(result.taxonomy, "nonanswerable");
  assert.doesNotMatch(result.answer, /Apply an antibiotic/);
});

test("a multi-part request gets at most one additional follow-up question", async () => {
  const { model } = scripted([
    {
      claims: [{ cueIds: ["T001"], text: "Press their nailbed for 5 seconds" }],
      followUpQuestion: "Is their hand numb?",
    },
    {
      claims: [{ claimIndex: 0, cueIds: ["T001"], support: "full" }],
      followUpSafe: true,
      utility: 5,
      verdict: "accept",
    },
    {
      claims: [
        {
          cueIds: ["T002"],
          text: "If colour does not return within two seconds, the bandage is too tight",
        },
      ],
      followUpQuestion: "Can they move their fingers?",
    },
    {
      claims: [{ claimIndex: 0, cueIds: ["T002"], support: "full" }],
      followUpSafe: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    initialAnswer: true,
    model,
    question: "How should I check the bandage? What should I watch for?",
    recentConversation: "",
  });
  assert.doesNotMatch(result.answer, /Is their hand numb/);
  assert.match(result.answer, /Can they move their fingers/);
});

test("immediate-care and escalation questions exclude unrelated aftercare", () => {
  const immediate = planResponse(
    "I just burned my arm. What do I do now?",
    true
  );
  assert.equal(
    relevantToResponsePlan(
      "Leave it uncovered for 24 hours",
      "step",
      immediate
    ),
    false
  );
  assert.equal(
    relevantToResponsePlan(
      "Cool with running water for 20 minutes",
      "step",
      immediate
    ),
    true
  );
  const escalation = planResponse("When would I need medical help?", true);
  assert.equal(
    relevantToResponsePlan("Keep the area uncovered", "step", escalation),
    false
  );
  assert.equal(
    relevantToResponsePlan(
      "Seek emergency care for a deep burn",
      "warning",
      escalation
    ),
    true
  );
});

test("screening evidence cannot become an overconfident diagnosis", () => {
  assert.equal(
    explicitCriticalDetails(
      "The bandage is cutting off circulation",
      "If colour does not return within two seconds, the bandage is too tight."
    ),
    false
  );
});

test("a follow-up does not ask for a body location already supplied", () => {
  assert.equal(
    safeFollowUp(
      "Is the burn on your face or your leg?",
      true,
      "I burned my arm on a pan."
    ),
    null
  );
  assert.equal(
    safeFollowUp(
      "Has it spread to any other areas?",
      true,
      "I burned my arm on a pan."
    ),
    "Has it spread to any other areas?"
  );
});

test("a clipped-off sentence cannot supply a misleading video timestamp", () => {
  assert.equal(
    completePlayableCue({
      clip_end_seconds: 90,
      clip_start_seconds: 84.42,
      end_seconds: 181.54,
      start_seconds: 174.42,
    }),
    false
  );
  assert.equal(
    completePlayableCue({
      clip_end_seconds: 91.54,
      clip_start_seconds: 84.42,
      end_seconds: 181.54,
      start_seconds: 174.42,
    }),
    true
  );
});

test("a truncated video alternative falls back to independently checked medical-reference support", async () => {
  const { model } = scripted([
    {
      claims: [
        {
          cueIds: ["T002", "K001"],
          text: "If colour does not return within two seconds, the bandage is too tight",
        },
      ],
    },
    {
      claims: [{ claimIndex: 0, cueIds: ["K001"], support: "full" }],
      utility: 5,
      verdict: "accept",
    },
  ]);
  const clipped = {
    ...source,
    evidenceContext: source.evidenceContext.map((cue, index) =>
      index === 1 ? { ...cue, clip_end_seconds: 90 } : cue
    ),
  };
  const result = await generateVerifiedFollowUp({
    activeEvidence: clipped,
    initialAnswer: true,
    model,
    question,
    recentConversation: "",
  });
  assert.match(result.answer, /www.nhs.uk/);
  assert.equal(result.citedCues.length, 0);
  assert.doesNotMatch(result.answer, /\[1:24/);
});

test("stock assurances are removed before verification without dropping the actual check", () => {
  assert.equal(
    stripStockAssurance(
      "Repeat the check every 10 minutes to ensure it remains safe."
    ),
    "Repeat the check every 10 minutes"
  );
  assert.equal(
    stripStockAssurance(
      "Repeat it to ensure it is safe unless told otherwise."
    ),
    "Repeat it to ensure it is safe unless told otherwise."
  );
});

test("a validated related video stays available without being presented as claim support", () => {
  const result = {
    answer: "Sourced medical guidance",
    citedCues: [],
    evidenceSufficiency: "sufficient" as const,
    medicalSources: [
      {
        checkedAt: "2026-10-15",
        id: "K001",
        title: "NHS",
        url: "https://www.nhs.uk/conditions/cuts-and-grazes/",
      },
    ],
    reason: "Reference supported",
    relation: "continue_to_use_evidence" as const,
    taxonomy: "answerable" as const,
    verified: true,
  };
  const output = toVerifiedProcedureOutput(
    {
      ...source,
      groundedClaims: [
        { citation_ids: ["T001"], text: "Press for five seconds" },
      ],
    },
    {
      ...result,
      demonstrationCues: [
        {
          endSeconds: 84.42,
          startSeconds: 78.5,
          text: source.evidenceContext[0].text,
        },
      ],
    }
  );
  assert.equal(output.evidenceRole, "related");
  assert.equal(output.renderMediaWorkspace, true);
  assert.equal(output.citations.length, 0);
  assert.equal(output.relatedEvidence?.length, 1);
});

test("the UI cannot infer related evidence from a successful video or stale card", () => {
  const output = toVerifiedProcedureOutput(
    {
      ...source,
      evidenceRole: "related",
      groundedClaims: [{ citation_ids: ["T001"], text: "old" }],
      relatedEvidence: source.evidenceContext,
    },
    {
      answer: "Supported reference answer",
      citedCues: [],
      evidenceSufficiency: "sufficient",
      medicalSources: [
        {
          checkedAt: "2026-10-15",
          id: "K001",
          title: "NHS",
          url: "https://www.nhs.uk/conditions/cuts-and-grazes/",
        },
      ],
      reason: "test",
      relation: "continue_to_use_evidence",
      taxonomy: "answerable",
      verified: true,
    }
  );
  assert.deepEqual(output.relatedEvidence, []);
  assert.equal(output.renderMediaWorkspace, false);
});

test("a failed-check follow-up repairs a grounded but incomplete answer using history", async () => {
  const { model, calls } = scripted([
    {
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "partial",
      supportingCueIds: ["T002"],
    },
    {
      claims: [
        {
          cueIds: ["T002"],
          role: "answer",
          text: "If colour does not return within two seconds, the bandage is too tight",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["T002"], relevant: true, support: "full" },
      ],
      complete: false,
      missingInformation:
        "K001 supports loosening the ordinary bandage; answer what to do next",
      utility: 4,
      verdict: "accept",
    },
    {
      claims: [
        {
          cueIds: ["K001"],
          role: "answer",
          text: "Loosen the bandage slightly if the colour does not return within two seconds",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation:
      "user: I put a bandage on their arm. assistant: Press for five seconds, then watch for colour returning within two seconds.",
  });
  assert.match(result.answer, /^Loosen/);
  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.doesNotMatch(result.answer, /left out details|Additional medical/);
  assert.match(calls[3], /Revision required/);
  assert.match(calls[3], /I put a bandage on their arm/);
  assert.equal(calls.length, 5);
});

test("references can answer without a video, but cannot bypass urgent follow-up triage", async () => {
  const { model, calls } = scripted([
    {
      claims: [
        {
          cueIds: ["K003"],
          role: "answer",
          text: "Cool a thermal burn under cool running water for 20 minutes",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K003"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const empty = {
    ...source,
    answerable: false,
    citations: [],
    evidenceContext: [],
    status: "abstained" as const,
    videoId: null,
  };
  const result = await generateVerifiedFollowUp({
    activeEvidence: empty,
    initialAnswer: true,
    model,
    question: "How long should I cool a thermal burn?",
    recentConversation: "",
  });
  assert.match(result.answer, /20 minutes/);
  assert.equal(
    toVerifiedProcedureOutput(empty, result).renderMediaWorkspace,
    false
  );
  const count = calls.length;
  const urgent = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "Now they are unconscious",
    recentConversation: "We were discussing an arm bandage",
  });
  assert.match(urgent.answer, /emergency services now/);
  assert.equal(calls.length, count);
});

test("a failed repair preserves verified advice without leaking verification diagnostics", async () => {
  const { model } = scripted([
    {
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "partial",
      supportingCueIds: ["T002"],
    },
    {
      claims: [
        {
          cueIds: ["T002"],
          text: "If colour does not return within two seconds, the bandage is too tight",
        },
      ],
    },
    {
      claims: [{ claimIndex: 0, cueIds: ["T002"], support: "full" }],
      complete: false,
      missingInformation: "The next action is missing",
      utility: 4,
      verdict: "accept",
    },
    { claims: [{ cueIds: ["K999"], text: "Invented advice" }] },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if it is slow?",
    recentConversation:
      "We are checking the circulation beyond an arm bandage.",
  });
  assert.match(result.answer, /bandage is too tight/);
  assert.doesNotMatch(
    result.answer,
    /Invented|left out details|verification|K999/
  );
  assert.equal(result.evidenceSufficiency, "partial");
});

test("one independently verified reference replaces redundant citations in the rendered answer", async () => {
  const { model } = scripted([
    {
      claims: [
        {
          cueIds: ["K001", "K004"],
          role: "answer",
          text: "Press their nail for five seconds",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "How long should I press their nail?",
    recentConversation: question,
  });
  assert.equal(result.verified, true);
  assert.deepEqual(
    result.medicalSources?.map((ref) => ref.id),
    ["K001"]
  );
  assert.doesNotMatch(result.answer, /\[4\]|St John/);
  assert.match(result.answer, /five seconds/);
});

test("reviewer diagnostics never become patient-facing uncertainty text", () => {
  assert.equal(
    limitationSentence("The transcript does not specify the cooling duration"),
    ""
  );
  assert.equal(
    limitationSentence(
      "Specific self-care steps are not detailed in the provided cues"
    ),
    ""
  );
  assert.match(
    limitationSentence("when to restart exercise"),
    /when to restart exercise/
  );
});

test("malformed conversational drafts get one JSON repair and full evidence verification", async () => {
  const { model, calls, formats } = scripted([
    { message: "A prose-shaped draft instead of verified claims" },
    {
      claims: [
        {
          cueIds: ["K001"],
          role: "answer",
          text: "Loosen the bandage slightly if the colour does not return within two seconds",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation: "user: I put a bandage on their arm.",
  });
  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.match(result.answer, /^Loosen/);
  assert.equal(calls.length, 4);
  assert.match(calls[2], /Revision required/);
  assert.match(calls[3], /You verify/);
  assert.equal((formats[1] as { type: string }).type, "json");
  assert.equal((formats[2] as { type: string }).type, "json");
});

test("a thinner repair cannot replace a fuller verified answer to the exact failed-check follow-up", async () => {
  const action = {
    cueIds: ["K001"],
    role: "answer",
    text: "Loosen the bandage slightly if the colour does not return within two seconds",
  };
  const unsupported = {
    cueIds: ["T002"],
    role: "step",
    text: "An unsupported extra instruction",
  };
  const { model, calls } = scripted([
    {
      claims: [
        action,
        {
          cueIds: ["T001"],
          role: "step",
          text: "Press their nailbed or skin beyond the bandage for 5 seconds",
        },
        {
          cueIds: ["T002"],
          role: "step",
          text: "Release pressure and watch for colour returning within two seconds",
        },
        unsupported,
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
        { claimIndex: 1, cueIds: ["T001"], relevant: true, support: "full" },
        { claimIndex: 2, cueIds: ["T002"], relevant: true, support: "full" },
        { claimIndex: 3, cueIds: ["T002"], relevant: true, support: "none" },
      ],
      complete: false,
      missingInformation: "Keep only supported instructions",
      utility: 4,
      verdict: "refine",
    },
    { claims: [action, unsupported] },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
        { claimIndex: 1, cueIds: ["T002"], relevant: true, support: "none" },
      ],
      complete: false,
      utility: 4,
      verdict: "refine",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation: "user: I just put a bandage on someone's arm.",
  });
  assert.match(result.answer, /^Loosen/);
  assert.match(result.answer, /5 seconds/);
  assert.match(result.answer, /Release pressure/);
  assert.match(result.answer, /\[1:18–1:24\]/);
  assert.match(result.answer, /\[1:24–1:31\]/);
  assert.doesNotMatch(result.answer, /unsupported extra/);
  assert.equal(result.evidenceSufficiency, "partial");
  assert.equal(calls.length, 5);
});

test("the repeated-threshold follow-up removes an audited duplicate without another generation", async () => {
  const { model, calls } = scripted([
    {
      claims: [
        {
          cueIds: ["K001"],
          role: "answer",
          text: "Loosen the bandage slightly",
        },
        {
          cueIds: ["K001"],
          role: "step",
          text: "The colour should return within two seconds after you release the pressure",
        },
        {
          cueIds: ["K001"],
          role: "answer",
          text: "After releasing pressure, colour should return within two seconds",
        },
        { cueIds: ["K001"], role: "step", text: "Check every 10 minutes" },
        {
          cueIds: ["K005"],
          role: "warning",
          text: "After an injury, blue, grey or cold skin needs emergency assessment",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
        { claimIndex: 1, cueIds: ["K001"], relevant: true, support: "full" },
        {
          claimIndex: 2,
          cueIds: ["K001"],
          duplicateOf: 1,
          relevant: true,
          support: "full",
        },
        { claimIndex: 3, cueIds: ["K001"], relevant: false, support: "full" },
        { claimIndex: 4, cueIds: ["K005"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation:
      "user: I just put a bandage on someone's arm. assistant: Check every ten minutes.",
  });
  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.equal((result.answer.match(/within two seconds/g) ?? []).length, 1);
  assert.doesNotMatch(
    result.answer,
    /Check every 10 minutes|After releasing pressure/
  );
  assert.match(result.answer, /emergency assessment/);
  assert.equal(calls.length, 3);
  assert.match(
    result.answer,
    /https:\/\/www.nhs.uk\/conditions\/cuts-and-grazes\//
  );
});

test("a lexical safety check accepts inflection changes without accepting an absent symptom", () => {
  assert(
    explicitCriticalDetails("Their fingers tingle", "Tingling in the fingers")
  );
  assert(
    explicitCriticalDetails(
      "Numbness needs emergency assessment",
      "Numb fingers need emergency assessment"
    )
  );
  assert.equal(
    explicitCriticalDetails(
      "Their fingers tingle",
      "Press their skin for five seconds"
    ),
    false
  );
});

test("medical passage selection preserves provenance and rejects invented sources or indexes", () => {
  const sources = retrieveMedicalReferences(question);
  const source = sources.find((item) => item.id === "K004")!;
  const selected = selectedMedicalPassages(
    [{ id: "K004", sentences: [1] }],
    sources
  )!;
  assert.equal(selected.length, 1);
  assert.equal(selected[0].summary, medicalPassages(source)[0]);
  assert.equal(selected[0].url, source.url);
  assert.equal(selected[0].scope, source.scope);
  assert.doesNotMatch(selected[0].summary, /seconds|10 minutes/);
  assert.equal(
    selectedMedicalPassages([{ id: "K999", sentences: [1] }], sources),
    null
  );
  assert.equal(
    selectedMedicalPassages([{ id: "K004", sentences: [999] }], sources),
    null
  );
  assert.equal(
    selectedMedicalPassages([{ id: "K004", sentences: [1.5] }], sources),
    null
  );
  assert.equal(selectedMedicalPassages(undefined, sources), undefined);
  assert.deepEqual(selectedMedicalPassages([], sources), []);
});

test("a selected conditional passage keeps its antecedent instead of changing the medical meaning", () => {
  const sources = retrieveMedicalReferences(question);
  const source = sources.find((item) => item.id === "K001")!;
  const selected = selectedMedicalPassages(
    [{ id: "K001", sentences: [3] }],
    sources
  )!;
  assert.equal(
    selected[0].summary,
    medicalPassages(source).slice(1, 3).join(" ")
  );
});

test("why generation cannot borrow procedural quantities from unselected passages of the same source", async () => {
  const reason = {
    cueIds: ["K004"],
    role: "answer",
    text: "A bandage that is too tight can restrict circulation",
  };
  const { model, calls } = scripted([
    {
      medicalPassages: [{ id: "K004", sentences: [1] }],
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "insufficient",
      supportingCueIds: [],
    },
    {
      claims: [
        reason,
        {
          cueIds: ["K004"],
          role: "step",
          text: "Press their finger for 5 seconds",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K004"], relevant: true, support: "full" },
        { claimIndex: 1, cueIds: ["K004"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
    { claims: [reason] },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K004"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "Why do I need to check their fingers after bandaging?",
    recentConversation:
      "assistant: The circulation check and monitoring were already explained.",
  });
  assert.match(result.answer, /can restrict circulation/);
  assert.doesNotMatch(result.answer, /5 seconds|10 minutes/);
  assert.match(
    calls[1],
    /A bandage that is wrapped too tightly can restrict circulation/
  );
  assert.doesNotMatch(calls[1], /Check circulation every 10 minutes/);
  assert.equal(result.evidenceSufficiency, "sufficient");
});

test("a repeat check must not be described as proof that circulation or fit is safe", () => {
  assert.equal(
    explicitCriticalDetails(
      "Watch for colour return to confirm the fit is now correct",
      "Watch for colour return within two seconds"
    ),
    false
  );
  assert.equal(
    explicitCriticalDetails(
      "This ensures blood flow is not blocked",
      "Leave fingers uncovered to check circulation"
    ),
    false
  );
  assert.equal(
    stripStockAssurance(
      "Watch for colour to return to confirm the fit is now correct."
    ),
    "Watch for colour to return"
  );
  assert.equal(
    stripStockAssurance(
      "Leave fingers uncovered to check circulation to ensure blood flow is not blocked."
    ),
    "Leave fingers uncovered to check circulation"
  );
});

for (const hasImage of [false, true]) {
  test(`concise action-first follow-up retains verified warning urgency and source boundaries (image=${hasImage})`, async () => {
    const { model, calls } = scripted([
      {
        claims: [
          {
            cueIds: ["K001"],
            role: "action",
            text: "Loosen the bandage slightly",
          },
          {
            cueIds: ["K005"],
            role: "warning",
            text: "After an injury, blue, grey or cold skin needs emergency assessment",
          },
          {
            cueIds: ["K001"],
            role: "step",
            text: "Check circulation every 10 minutes",
          },
        ],
      },
      {
        claims: [
          { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
          { claimIndex: 1, cueIds: ["K005"], relevant: true, support: "full" },
          { claimIndex: 2, cueIds: ["K001"], relevant: false, support: "full" },
        ],
        complete: true,
        utility: 5,
        verdict: "accept",
      },
    ]);
    const result = await generateVerifiedFollowUp({
      activeEvidence: source,
      hasImage,
      model,
      question: "What if the colour doesn't come back quickly?",
      recentConversation:
        "user: I bandaged an injured arm. assistant: Check circulation every ten minutes.",
    });
    assert(result.verified);
    assert.match(result.answer, /^Loosen the bandage slightly/);
    assert.match(
      result.answer,
      /blue, grey or cold skin needs emergency assessment/
    );
    assert.doesNotMatch(
      result.answer,
      /10 minutes|urgent assessment|safe now|\[0:/
    );
    assert.match(
      result.answer,
      /https:\/\/www.nhs.uk\/conditions\/cuts-and-grazes/
    );
    assert.match(
      result.answer,
      /https:\/\/www.nhs.uk\/conditions\/sprains-and-strains/
    );
    assert.equal(calls.length, 3);
  });
}

test("failed-check passage ranking cannot remove the scoped escalation context", async () => {
  const { model, calls } = scripted([
    {
      medicalPassages: [{ id: "K004", sentences: [4] }],
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "sufficient",
      supportingCueIds: [],
    },
    {
      claims: [
        {
          cueIds: ["K001"],
          role: "action",
          text: "Loosen the bandage slightly",
        },
        {
          cueIds: ["K005"],
          role: "warning",
          text: "After an injury, blue, grey or cold skin needs emergency assessment",
        },
      ],
    },
    {
      claims: [
        { claimIndex: 0, cueIds: ["K001"], relevant: true, support: "full" },
        { claimIndex: 1, cueIds: ["K005"], relevant: true, support: "full" },
      ],
      complete: true,
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation:
      "user: I bandaged an injured arm. assistant: We discussed the circulation check.",
  });
  assert.match(calls[1], /K005.*NHS: Injury warning signs/);
  assert.match(result.answer, /^Loosen/);
  assert.match(result.answer, /emergency assessment/);
  assert.equal(result.medicalSources?.length, 2);
});

test("whole-answer review repairs repeated warning phrasing without sacrificing conditions", async () => {
  const { model, calls } = scripted([
    {
      claims: [
        {
          cueIds: ["K001"],
          role: "action",
          text: "Loosen the bandage slightly",
        },
        {
          cueIds: ["K005"],
          role: "warning",
          text: "Seek emergency assessment if injured skin becomes blue or cold",
        },
        {
          cueIds: ["K005"],
          role: "warning",
          text: "Seek emergency assessment if the injured arm becomes numb or tingling",
        },
      ],
    },
    {
      claims: [
        {
          claimIndex: 0,
          cueIds: ["K001"],
          passages: [{ sentence: 3, sourceId: "K001" }],
          support: "full",
        },
        {
          claimIndex: 1,
          cueIds: ["K005"],
          passages: [{ sentence: 1, sourceId: "K005" }],
          support: "full",
        },
        {
          claimIndex: 2,
          cueIds: ["K005"],
          passages: [{ sentence: 1, sourceId: "K005" }],
          support: "full",
        },
      ],
      complete: true,
      presentation: {
        feedback:
          "Combine the two warnings sharing one action and urgency; retain every condition.",
        needsRewrite: true,
        score: 2,
      },
      utility: 5,
      verdict: "accept",
    },
    {
      claims: [
        {
          cueIds: ["K001"],
          role: "action",
          text: "Loosen the bandage slightly",
        },
        {
          cueIds: ["K005"],
          role: "warning",
          text: "Seek emergency assessment if the injured arm becomes blue, cold, numb or tingling",
        },
      ],
    },
    {
      claims: [
        {
          claimIndex: 0,
          cueIds: ["K001"],
          passages: [{ sentence: 3, sourceId: "K001" }],
          support: "full",
        },
        {
          claimIndex: 1,
          cueIds: ["K005"],
          passages: [{ sentence: 1, sourceId: "K005" }],
          support: "full",
        },
      ],
      complete: true,
      presentation: { feedback: "", needsRewrite: false, score: 5 },
      utility: 5,
      verdict: "accept",
    },
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation: "user: I bandaged an injured arm.",
  });
  assert.equal(calls.length, 5);
  assert.equal(
    (result.answer.match(/Seek emergency assessment/g) ?? []).length,
    1
  );
  assert.match(result.answer, /blue, cold, numb or tingling/);
  assert.equal(result.evidenceSufficiency, "sufficient");
  assert.match(calls[3], /Combine the two warnings/);
});

test("even an accepting verifier cannot promote urgent advice using emergency words elsewhere in a source", async () => {
  const bad = {
    cueIds: ["K005"],
    role: "warning",
    text: "Seek emergency care if the injured arm is difficult to move",
  };
  const draft = {
    claims: [
      { cueIds: ["K001"], role: "action", text: "Loosen the bandage slightly" },
      bad,
    ],
  };
  const review = {
    claims: [
      {
        claimIndex: 0,
        cueIds: ["K001"],
        passages: [{ sentence: 3, sourceId: "K001" }],
        support: "full",
      },
      {
        claimIndex: 1,
        cueIds: ["K005"],
        passages: [{ sentence: 3, sourceId: "K005" }],
        support: "full",
      },
    ],
    complete: true,
    utility: 5,
    verdict: "accept",
  };
  const { model } = scripted([draft, review, draft, review]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation: "user: I bandaged an injured arm.",
  });
  assert.match(result.answer, /Loosen/);
  assert.doesNotMatch(result.answer, /difficult to move/);
  assert.equal(result.evidenceSufficiency, "partial");
});

test("a failed-check repair retains supported escalation despite a lower reviewer score", async () => {
  const action = {
    cueIds: ["K001"],
    role: "action",
    text: "Loosen the bandage if the colour does not return within two seconds.",
  };
  const recheck = {
    cueIds: ["K001"],
    role: "step",
    text: "Recheck after loosening to ensure circulation has improved.",
  };
  const warning = {
    cueIds: ["K005"],
    role: "warning",
    text: "Seek emergency care if the fingers become cold, blue, or numb.",
  };
  const verdict = (utility: number, partial: boolean) => ({
    claims: [
      {
        claimIndex: 0,
        cueIds: ["K001"],
        passages: [{ sentence: 3, sourceId: "K001" }],
        support: "full",
      },
      {
        claimIndex: 1,
        cueIds: ["K001"],
        passages: [{ sentence: 1, sourceId: "K001" }],
        support: partial ? "partial" : "full",
      },
      {
        claimIndex: 2,
        cueIds: ["K005"],
        passages: [{ sentence: 1, sourceId: "K005" }],
        support: "full",
      },
    ],
    complete: true,
    utility,
    verdict: "refine",
  });
  const { model, calls } = scripted([
    {
      relatedCueIds: [],
      relation: "same_topic",
      sufficiency: "sufficient",
      supportingCueIds: ["T001"],
    },
    {
      claims: [
        action,
        recheck,
        {
          ...warning,
          text: "Seek emergency care if fingers remain cold, blue, or numb after loosening.",
        },
      ],
      unsupportedAspect: "",
    },
    verdict(5, false),
    { claims: [action, recheck, warning], unsupportedAspect: "" },
    verdict(4, true),
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source,
    model,
    question: "What if the colour doesn't come back quickly?",
    recentConversation:
      "user: I bandaged someone's arm. assistant: Check colour return beyond the bandage.",
  });
  assert.match(result.answer, /Loosen the bandage/);
  assert.match(result.answer, /Seek emergency care/);
  assert.doesNotMatch(result.answer, /ensure circulation|after loosening/);
  assert.equal(result.evidenceSufficiency, "partial");
  assert(
    calls.some((call) => call.includes("Rejected statements and reasons"))
  );
});
