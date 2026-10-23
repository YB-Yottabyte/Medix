import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { LanguageModel } from "ai";
import { generateVerifiedFollowUp } from "../../lib/ai/medical-follow-up";
import {
  DATASET_INTENT_EXAMPLES,
  datasetIntentExamples,
  questionIntent,
  questionIntentGuidance,
} from "../../lib/ai/question-intent";
import type { ProcedureToolOutput } from "../../lib/ai/tools/search-procedure";

const source = (text: string) =>
  ({
    answerable: true,
    citations: [],
    evidenceBundleId: "test",
    evidenceContext: [
      {
        clip_end_seconds: 4,
        clip_start_seconds: 0,
        cue_id: "T001",
        end_seconds: 14,
        start_seconds: 10,
        text,
      },
    ],
    renderMediaWorkspace: true,
    retrievalQuery: "Demonstration of bowl placement",
    safetyDisposition: "supported",
    sourceRetrievalQuery: "Demonstration of bowl placement",
    status: "answered",
  }) as unknown as ProcedureToolOutput;
function model(outputs: unknown[]) {
  const calls: string[] = [];
  return {
    calls,
    model: {
      doGenerate: async ({ prompt }: { prompt: unknown }) => {
        calls.push(JSON.stringify(prompt));
        return {
          content: [{ text: JSON.stringify(outputs.shift()), type: "text" }],
          finishReason: "stop",
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        };
      },
      modelId: "test",
      provider: "test",
      specificationVersion: "v3",
      supportedUrls: {},
    } as unknown as LanguageModel,
  };
}
const selected = {
  relatedCueIds: [],
  relation: "continue_to_use_evidence",
  sufficiency: "sufficient",
  supportingCueIds: ["T001"],
};
const claim = (text: string) => ({
  claims: [{ cueIds: ["T001"], role: "answer", text }],
  followUpQuestion: null,
  intent: "rationale",
  unsupportedAspect: "",
});
const accepted = {
  claims: [
    { claimIndex: 0, cueIds: ["T001"], relevant: true, support: "full" },
  ],
  complete: true,
  utility: 5,
  verdict: "accept",
};

test("question intents cover training questions and derived why questions", () => {
  const train = JSON.parse(readFileSync("../MedVidQA/train.json", "utf8"));
  const examples = JSON.parse(
    readFileSync("lib/ai/dataset-question-examples.json", "utf8")
  );
  for (const e of examples.examples) {
    assert.equal(
      e.question,
      train.find(
        (r: { sample_id: number }) => String(r.sample_id) === e.sample_id
      ).question
    );
    assert.equal(questionIntent(e.question), e.intent);
  }
  for (const q of [
    "Why is that step needed?",
    "What is the purpose of cooling?",
    "How does pressure help?",
  ]) {
    assert.equal(questionIntent(q), "rationale");
  }
  assert.equal(questionIntent("How long should I press?"), "quantity");
  assert.equal(
    questionIntent("What if the colour doesn't return?"),
    "contingency"
  );
  assert(DATASET_INTENT_EXAMPLES.includes("not medical evidence"));
  assert(!DATASET_INTENT_EXAMPLES.includes("answer_start"));
  assert(questionIntentGuidance("Why?").includes("An instruction alone"));
});

test("supported rationale is generated and keeps exact clickable video provenance", async () => {
  const scripted = model([
    selected,
    claim("The bowl catches the drops."),
    accepted,
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source(
      "Place the bowl below the bottle to catch the drops."
    ),
    model: scripted.model,
    question: "Why place the bowl below the bottle?",
    recentConversation:
      "user: Where does the bowl go?\nassistant: Below the bottle.",
  });
  assert(result.verified);
  assert.match(result.answer, /catches the drops/);
  assert.equal(result.citedCues.length, 1);
  assert.equal(result.citedCues[0].startSeconds, 0);
  assert(scripted.calls.some((c) => c.includes("Question intent: rationale")));
  assert(
    !scripted.calls.some((c) =>
      c.includes("What are the symptoms of a broken finger?")
    )
  );
});

test("action-only answer to why is repaired and cannot survive as a partial quote", async () => {
  const incomplete = {
    ...accepted,
    complete: false,
    missingInformation: "The passage states placement but gives no reason.",
  };
  const scripted = model([
    selected,
    claim("Place the bowl below the bottle."),
    incomplete,
    claim("Place the bowl below the bottle."),
    incomplete,
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source("Place the bowl below the bottle."),
    model: scripted.model,
    question: "Why place the bowl below the bottle?",
    recentConversation: "assistant: Place the bowl below the bottle.",
  });
  assert.equal(result.taxonomy, "nonanswerable");
  assert.equal(result.citedCues.length, 0);
  assert.doesNotMatch(result.answer, /current video states|Place the bowl/);
  assert(scripted.calls.length >= 5);
});

test("unsupported causal claim is rejected even when its citation ID exists", async () => {
  const rejected = {
    claims: [
      { claimIndex: 0, cueIds: ["T001"], relevant: true, support: "none" },
    ],
    complete: false,
    missingInformation: "The causal relationship is not in T001.",
    utility: 1,
    verdict: "reject",
  };
  const scripted = model([
    selected,
    claim("The bowl sterilizes the drops."),
    rejected,
    claim("The bowl sterilizes the drops."),
    rejected,
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source("Place the bowl below the bottle."),
    model: scripted.model,
    question: "Why place the bowl below the bottle?",
    recentConversation: "",
  });
  assert.equal(result.citedCues.length, 0);
  assert.doesNotMatch(result.answer, /sterilizes/);
});

test("browser evidence helpers remain independent of model and server timing modules", () => {
  const helper = readFileSync("lib/ai/evidence-links.ts", "utf8");
  assert.doesNotMatch(
    helper,
    /from ["'](?:node:|.*performance|.*timed-generation)/
  );
  for (const file of [
    "components/chat/message.tsx",
    "components/chat/active-source-bar.tsx",
  ]) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /from ["'].*medical-follow-up/
    );
  }
});

test("why requires an explicit completeness decision rather than assuming an omitted flag", async () => {
  const { complete: _unused, ...unknownCompleteness } = accepted;
  const scripted = model([
    selected,
    claim("The bowl catches the drops."),
    unknownCompleteness,
    claim("The bowl catches the drops."),
    unknownCompleteness,
  ]);
  const result = await generateVerifiedFollowUp({
    activeEvidence: source(
      "Place the bowl below the bottle to catch the drops."
    ),
    model: scripted.model,
    question: "Why place the bowl below the bottle?",
    recentConversation: "",
  });
  assert.equal(result.taxonomy, "nonanswerable");
  assert.equal(result.citedCues.length, 0);
});

test("conversational recognition questions do not route to a full procedure", () => {
  for (const question of [
    "How can I tell if it is too tight?",
    "How do I know if it is too tight?",
    "How should we check circulation?",
    "How to check circulation?",
  ]) {
    assert.equal(questionIntent(question), "recognition");
  }
  assert.equal(questionIntent("How do I apply a dressing?"), "procedure");
  assert.equal(questionIntent("Why do I check?"), "rationale");
  assert.equal(datasetIntentExamples("Why do I check?"), "");
  assert.match(
    datasetIntentExamples("How can I tell if it is too tight?"),
    /symptoms of a broken finger/
  );
  assert.doesNotMatch(
    datasetIntentExamples("How can I tell if it is too tight?"),
    /shock|soaks|pressure bandage/
  );
});
