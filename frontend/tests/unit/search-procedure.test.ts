import assert from "node:assert/strict";
import test from "node:test";
import {
  createSearchProcedureTool,
  type ProcedureToolOutput,
  type ProcedureResponse,
  toContinuedProcedureToolOutput,
  toProcedureToolOutput,
} from "../../lib/ai/tools/search-procedure";

function response(status: "answered" | "abstained"): ProcedureResponse {
  return {
    pipeline: "canonical-medix",
    query: "How do I pack a wound?",
    response: "1. Compact evidence claim. [1]",
    status,
    confidence: 0.8,
    safety_disposition: "supported",
    safety_warning: "Call emergency services for severe bleeding.",
    citations: [],
  };
}

test("answered tool output hides the compact canonical summary", () => {
  const output = toProcedureToolOutput(
    response("answered"),
    "How do I pack a wound?"
  );

  assert.equal(output.answer, null);
  assert.equal(output.answerable, true);
  assert.match(output.responseInstructions, /user-facing answer/);
  // Conversational shape, not a report: no heading, no closing filler.
  assert.match(output.responseInstructions, /No heading, no title/);
  assert.match(output.responseInstructions, /at most four items/);
  assert.match(output.responseInstructions, /on the same line/);
  assert.doesNotMatch(
    output.responseInstructions,
    /Supporting video guidance is shown below/
  );
  assert.equal(output.renderMediaWorkspace, false);
  assert.doesNotMatch(JSON.stringify(output), /Compact evidence claim/);
});

test("abstentions preserve the canonical limitation message", () => {
  const output = toProcedureToolOutput(
    response("abstained"),
    "How do I pack a wound?"
  );

  assert.equal(output.answer, "1. Compact evidence claim. [1]");
  assert.equal(output.answerable, false);
});

test("continued evidence preserves the bundle, video, clip, and transcript", () => {
  const initial = toProcedureToolOutput(
    {
      ...response("answered"),
      video_id: "wound-video",
      clip_url: "http://localhost/clip.mp4",
      evidence_bundle_id: "wound-bundle",
      evidence_context: [
        {
          cue_id: "T001",
          start_seconds: 16,
          end_seconds: 31,
          clip_start_seconds: 0,
          clip_end_seconds: 15,
          text: "Pack the wound with gauze or a clean shirt.",
        },
      ],
    },
    "How do I pack a wound?"
  );

  const continued = toContinuedProcedureToolOutput(
    initial,
    "Can I use a shirt instead?"
  );

  assert.equal(continued.retrievalDecision, "continue_current_evidence");
  assert.equal(continued.evidenceBundleId, "wound-bundle");
  assert.equal(continued.videoId, "wound-video");
  assert.equal(continued.clipUrl, "http://localhost/clip.mp4");
  assert.deepEqual(continued.evidenceContext, initial.evidenceContext);
  assert.deepEqual(continued.citations, initial.evidenceContext);
  assert.equal(continued.followUpQuestion, "Can I use a shirt instead?");
  assert.equal(continued.renderMediaWorkspace, false);
});

test("the first follow-up tool call reuses evidence even if new search is requested", async () => {
  const initial = toProcedureToolOutput(
    {
      ...response("answered"),
      video_id: "wound-video",
      clip_url: "http://localhost/clip.mp4",
      evidence_bundle_id: "wound-bundle",
      evidence_context: [
        {
          cue_id: "T001",
          start_seconds: 16,
          end_seconds: 31,
          clip_start_seconds: 0,
          clip_end_seconds: 15,
          text: "Pack the wound with gauze.",
        },
      ],
    },
    "How do I pack a wound?"
  );
  const procedureTool = createSearchProcedureTool({
    activeEvidence: initial,
    continueCurrentEvidenceFirst: true,
    followUpQuestion: "What should I do next?",
  });

  assert.ok(procedureTool.execute);
  const output = (await procedureTool.execute(
    {
      query: "Completely unrelated retrieval query",
      action: "search_new_source",
    },
    {
      toolCallId: "follow-up-tool-call",
      messages: [],
    }
  )) as ProcedureToolOutput;

  assert.equal(output.retrievalDecision, "continue_current_evidence");
  assert.equal(output.videoId, "wound-video");
  assert.equal(output.evidenceBundleId, "wound-bundle");
});
