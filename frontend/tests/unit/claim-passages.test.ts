import assert from "node:assert/strict";
import test from "node:test";
import {
  preservesEscalationLevel,
  resolveClaimPassages,
} from "../../lib/ai/claim-passages";
import { parseClaimVerification } from "../../lib/ai/medical-follow-up";
import { retrieveMedicalReferences } from "../../lib/ai/medical-knowledge";
import {
  explicitCriticalDetails,
  selectClaimEvidence,
} from "../../lib/ai/response-composition";

const references = new Map(
  retrieveMedicalReferences("arm bandage", "", new Date("2026-10-21")).map(
    (source) => [source.id, source]
  )
);

test("claim passage addresses cannot borrow an unrelated fact from the same reference", () => {
  const text = resolveClaimPassages(
    [{ sentence: 1, sourceId: "K005" }],
    ["K005"],
    references
  )!;
  assert.match(text, /numbness/);
  assert.doesNotMatch(text, /difficulty moving|misshapen/);
  assert.equal(
    resolveClaimPassages(
      [{ sentence: 999, sourceId: "K005" }],
      ["K005"],
      references
    ),
    null
  );
  assert.equal(
    resolveClaimPassages(
      [{ sentence: 1, sourceId: "K005" }],
      ["K001"],
      references
    ),
    null
  );
  assert.equal(resolveClaimPassages([], ["K001"], references), null);
  assert.equal(
    resolveClaimPassages(undefined, ["K001"], references),
    undefined
  );
});
test("condition antecedents are retained in sentence-level support", () => {
  const text = resolveClaimPassages(
    [{ sentence: 3, sourceId: "K001" }],
    ["K001"],
    references
  )!;
  assert.match(text, /2 seconds/);
  assert.match(text, /If not, loosen/);
});
test("urgency cannot be promoted, softened, or borrowed from another selected sentence", () => {
  assert(
    !preservesEscalationLevel(
      "Seek emergency care for difficulty moving",
      "Seek urgent medical advice for difficulty moving."
    )
  );
  assert(
    !preservesEscalationLevel(
      "Seek emergency care for numbness or difficulty moving",
      "Numbness needs emergency care. Difficulty moving needs urgent advice."
    )
  );
  assert(
    !preservesEscalationLevel(
      "Seek urgent advice for blue skin",
      "Blue skin requires emergency care."
    )
  );
  assert(
    preservesEscalationLevel(
      "Seek emergency care for blue skin",
      "Blue skin requires emergency care."
    )
  );
  assert(
    preservesEscalationLevel(
      "Seek emergency care for blue skin. Seek urgent advice for difficulty moving.",
      "Blue skin requires emergency care. Difficulty moving needs urgent advice."
    )
  );
});
test("verifier review fields reject invalid scores and unproposed source addresses", () => {
  const base = {
    claims: [
      {
        claimIndex: 0,
        cueIds: ["K005"],
        passages: [{ sentence: 1, sourceId: "K005" }],
        support: "full",
      },
    ],
    verdict: "accept",
  };
  assert(parseClaimVerification(JSON.stringify(base), ["K005"]));
  assert.equal(
    parseClaimVerification(
      JSON.stringify({
        ...base,
        presentation: { feedback: "", needsRewrite: true, score: 6 },
      }),
      ["K005"]
    ),
    null
  );
  assert.equal(
    parseClaimVerification(
      JSON.stringify({
        ...base,
        claims: [
          { ...base.claims[0], passages: [{ sentence: 1, sourceId: "K001" }] },
        ],
      }),
      ["K001", "K005"]
    ),
    null
  );
});

test("a sentence-specific citation cannot support bleeding absent from that passage", () => {
  const support = resolveClaimPassages(
    [{ sentence: 2, sourceId: "K005" }],
    ["K005"],
    references
  )!;
  assert(
    !explicitCriticalDetails(
      "Seek emergency care for a misshapen part or bleeding that will not stop",
      support
    )
  );
  assert(
    explicitCriticalDetails(
      "Seek emergency assessment if the injured part is misshapen",
      support
    )
  );
});

test("citation alternatives do not duplicate a statement in the reviewer input", () => {
  const claims = [
    { cueIds: ["T001", "K001", "K002"], text: "A supported action" },
    { cueIds: ["T002"], text: "A video-only detail" },
  ];
  const references = new Set(["K001", "K002"]);
  const care = selectClaimEvidence(claims, references, "What should I do?");
  assert.equal(care.length, claims.length);
  assert.deepEqual(care[0].cueIds, ["K001", "K002"]);
  assert.deepEqual(care[1].cueIds, ["T002"]);
  const video = selectClaimEvidence(
    claims,
    references,
    "What does the video demonstrate?"
  );
  assert.deepEqual(video[0].cueIds, ["T001"]);
  assert.equal(video[0].draftIndex, 0);
});

test("reference applicability retains core circulation safety without importing unrelated trauma advice", async () => {
  const { scopeMedicalReferences, medicalPassages } = await import(
    "../../lib/ai/medical-knowledge"
  );
  const scoped = scopeMedicalReferences(
    [...references.values()],
    "How do I check whether an arm bandage is too tight?"
  );
  const injury = scoped.find((s) => s.id === "K005")!;
  assert.match(injury.summary, /numbness.*emergency/);
  assert.doesNotMatch(injury.summary, /misshapen|difficulty moving|swelling/);
  const addressed = resolveClaimPassages(
    [{ sentence: 1, sourceId: "K005" }],
    ["K005"],
    new Map(scoped.map((s) => [s.id, s]))
  );
  assert.equal(addressed, medicalPassages(injury)[0]);
  const pain = scopeMedicalReferences(
    [...references.values()],
    "My bandaged arm has worsening pain and swelling"
  );
  assert.match(
    pain.find((s) => s.id === "K005")!.summary,
    /urgent medical advice/
  );
  const shape = scopeMedicalReferences(
    [...references.values()],
    "The injured arm is misshapen"
  );
  assert.match(shape.find((s) => s.id === "K005")!.summary, /odd angle/);
});

test("applicability metadata works for other sources and preserves conditional antecedents", async () => {
  const { scopeMedicalReferences } = await import(
    "../../lib/ai/medical-knowledge"
  );
  const custom = {
    checkedAt: "2026-10-21",
    id: "K900",
    passageApplicability: { 1: /other/i, 3: /other/i },
    scope: "Test",
    summary:
      "Observe the result. If not normal, seek advice. Other-topic advice.",
    title: "Test",
    topics: /check/i,
    url: "https://example.org",
  };
  const result = scopeMedicalReferences([custom], "Check the result");
  assert.equal(
    result[0].summary,
    "Observe the result. If not normal, seek advice."
  );
});
