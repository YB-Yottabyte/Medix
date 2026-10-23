import assert from "node:assert/strict";
import test from "node:test";
import {
  createSearchProcedureTool,
  type ProcedureResponse,
  type ProcedureToolOutput,
  toContinuedProcedureToolOutput,
  toProcedureToolOutput,
} from "../../lib/ai/tools/search-procedure";

function response(status: "answered" | "abstained"): ProcedureResponse {
  return {
    citations: [],
    confidence: 0.8,
    pipeline: "canonical-medix",
    query: "How do I pack a wound?",
    response: "1. Compact evidence claim. [1]",
    safety_disposition: "supported",
    safety_warning: "Call emergency services for severe bleeding.",
    status,
  };
}

test("answered tool output hides the compact canonical summary", () => {
  const output = toProcedureToolOutput(
    response("answered"),
    "How do I pack a wound?"
  );

  assert.equal(output.answer, null);
  assert.equal(output.answerable, true);
  assert.match(output.responseInstructions, /direct, conversational answer/);
  assert.match(output.responseInstructions, /Adapt detail to the question/);
  assert.match(
    output.responseInstructions,
    /timestamps only to video-supported claims/
  );
  assert.match(output.responseInstructions, /checked source link/);
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
      clip_url: "http://localhost/clip.mp4",
      evidence_bundle_id: "wound-bundle",
      evidence_context: [
        {
          clip_end_seconds: 15,
          clip_start_seconds: 0,
          cue_id: "T001",
          end_seconds: 31,
          start_seconds: 16,
          text: "Pack the wound with gauze or a clean shirt.",
        },
      ],
      video_id: "wound-video",
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
      clip_url: "http://localhost/clip.mp4",
      evidence_bundle_id: "wound-bundle",
      evidence_context: [
        {
          clip_end_seconds: 15,
          clip_start_seconds: 0,
          cue_id: "T001",
          end_seconds: 31,
          start_seconds: 16,
          text: "Pack the wound with gauze.",
        },
      ],
      video_id: "wound-video",
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
      action: "search_new_source",
      query: "Completely unrelated retrieval query",
    },
    {
      messages: [],
      toolCallId: "follow-up-tool-call",
    }
  )) as ProcedureToolOutput;

  assert.equal(output.retrievalDecision, "continue_current_evidence");
  assert.equal(output.videoId, "wound-video");
  assert.equal(output.evidenceBundleId, "wound-bundle");
});

test("search uses the resolved query and returns a compatible safe failure", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_input: unknown, init: RequestInit) => {
    bodies.push(String(init.body));
    throw new Error("private upstream diagnostic");
  }) as typeof fetch;
  try {
    const procedureTool = createSearchProcedureTool({
      retrievalQuery: "How do I use an AED?",
    });
    assert.ok(procedureTool.execute);
    const output = (await procedureTool.execute(
      { action: "search_new_source", query: "model changed the question" },
      { messages: [], toolCallId: "test" }
    )) as ProcedureToolOutput;
    assert.deepEqual(
      bodies.map((body) => JSON.parse(body).query),
      ["How do I use an AED?"]
    );
    assert.equal(output.status, "abstained");
    assert.equal(output.answerable, false);
    assert.deepEqual(output.citations, []);
    assert.doesNotMatch(JSON.stringify(output), /private upstream diagnostic/);
    assert.match(
      output.answer ?? "",
      /evidence server is unavailable or the request timed out/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image questions send bytes to the multimodal backend", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPath = "";
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestedPath = String(input);
    sentBody = JSON.parse(String(init?.body));
    return Response.json(response("answered"));
  };
  try {
    const tool = createSearchProcedureTool({
      imageBase64: "YWJj",
      retrievalQuery: "How to wrap?",
    });
    await tool.execute?.(
      { action: "search_new_source", query: "How to wrap?" },
      { messages: [], toolCallId: "image-test" }
    );
    assert.ok(requestedPath.endsWith("/api/multimodal/query"));
    assert.deepEqual(sentBody, { image_base64: "YWJj", query: "How to wrap?" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image observations remain bounded, unverified context and never become citations", () => {
  const output = toProcedureToolOutput(
    {
      ...response("answered"),
      visual_observation: {
        visible_actions: ["wrapping"],
        visible_objects: ["bandage", "arm"],
      },
    },
    "What can I check?"
  );
  assert.deepEqual(output.imageContext, ["bandage", "arm", "wrapping"]);
  assert.equal(output.evidenceContext.length, 0);
  assert.equal(output.citations.length, 0);
});
