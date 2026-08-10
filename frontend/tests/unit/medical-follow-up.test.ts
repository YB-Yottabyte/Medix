import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMedicalFollowUp,
  linkFollowUpTimestamps,
  parseEvidenceTimestampHref,
  sanitizeFollowUpAnswer,
  validateFollowUpAnswer,
} from "../../lib/ai/medical-follow-up";
import type { TranscriptCitation } from "../../lib/ai/tools/search-procedure";

const aedEvidence: TranscriptCitation[] = [
  {
    cue_id: "T021",
    start_seconds: 33,
    end_seconds: 39,
    clip_start_seconds: 33,
    clip_end_seconds: 39,
    text: "Keep doing CPR while the second person hooks up the AED.",
  },
  {
    cue_id: "T031",
    start_seconds: 51,
    end_seconds: 58,
    clip_start_seconds: 51,
    clip_end_seconds: 58,
    text: "If they have a hairy chest, use the razor in the kit.",
  },
  {
    cue_id: "T041",
    start_seconds: 60,
    end_seconds: 68,
    clip_start_seconds: 60,
    clip_end_seconds: 68,
    text: "Place one pad on the right upper chest below the collarbone.",
  },
  {
    cue_id: "T042",
    start_seconds: 68,
    end_seconds: 76,
    clip_start_seconds: 68,
    clip_end_seconds: 76,
    text: "Place the second pad on the left side below the nipple near the armpit.",
  },
];

test("classifies directly supported AED follow-ups without new retrieval", () => {
  for (const question of [
    "Where exactly should I place the AED pads?",
    "What if the person has a hairy chest?",
    "Should I stop CPR while attaching the AED pads?",
  ]) {
    const assessment = assessMedicalFollowUp(question, aedEvidence);
    assert.notEqual(assessment.taxonomy, "nonanswerable");
    assert.equal(assessment.evidenceSufficiency, "sufficient");
  }
});

test("classifies missing no-shock and post-shock guidance conservatively", () => {
  for (const question of [
    "What should I do if the AED says no shock advised?",
    "What should I do after the AED delivers a shock?",
  ]) {
    const assessment = assessMedicalFollowUp(question, aedEvidence);
    assert.equal(assessment.taxonomy, "nonanswerable");
    assert.equal(assessment.evidenceSufficiency, "insufficient");
  }
});

test("keeps an elliptical next-step question in the current evidence context", () => {
  const assessment = assessMedicalFollowUp(
    "What should I do next?",
    aedEvidence
  );
  assert.equal(assessment.taxonomy, "helpful_deferral");
  assert.equal(assessment.evidenceSufficiency, "partial");
});

test("rejects diagnosis and medication requests before generation", () => {
  const assessment = assessMedicalFollowUp(
    "What medication dose should I take next?",
    aedEvidence
  );
  assert.equal(assessment.taxonomy, "nonanswerable");
});

test("follow-up validation removes internal metadata and requires known citations", () => {
  const cleaned = sanitizeFollowUpAnswer(
    "## Answer\n\n- **Keep compressions going.** (cue T021) [0:33-0:39]\n\nGeneration output failed grounding validation."
  );
  assert.equal(cleaned, "Keep compressions going. [0:33–0:39]");
  assert.equal(validateFollowUpAnswer(cleaned, aedEvidence).valid, true);
  assert.equal(
    validateFollowUpAnswer("Pause CPR. [9:00–9:10]", aedEvidence).valid,
    false
  );
});

test("follow-up timestamps target the existing evidence workspace", () => {
  const linked = linkFollowUpTimestamps(
    "Keep compressions going. [0:33–0:39]",
    "bundle/aed"
  );
  assert.equal(
    linked,
    "Keep compressions going. [0:33–0:39](#medix-evidence=bundle%2Faed&clip=33,39)"
  );
  assert.deepEqual(
    parseEvidenceTimestampHref("#medix-evidence=bundle%2Faed&clip=33,39"),
    {
      evidenceBundleId: "bundle/aed",
      startSeconds: 33,
      endSeconds: 39,
    }
  );
});
