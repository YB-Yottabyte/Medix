import assert from "node:assert/strict";
import test from "node:test";
import {
  expandsMediaWorkspace,
  mountsMediaWorkspace,
  responsePhaseForWriting,
  shouldRenderEvidenceWorkspace,
  showsRealMedia,
} from "../../lib/evidence-visibility";

test("thinking and streaming phases never mount a media container", () => {
  const thinking = responsePhaseForWriting(true, false, true);
  const streaming = responsePhaseForWriting(true, true, true);

  assert.equal(thinking, "thinking");
  assert.equal(streaming, "streaming");
  assert.equal(mountsMediaWorkspace(thinking), false);
  assert.equal(mountsMediaWorkspace(streaming), false);
});

test("completed writing finalizes before media can mount or expand", () => {
  const finalizing = responsePhaseForWriting(false, true, true);

  assert.equal(finalizing, "finalizing");
  assert.equal(mountsMediaWorkspace(finalizing), false);
  assert.equal(mountsMediaWorkspace("revealing-media"), true);
  assert.equal(expandsMediaWorkspace("revealing-media"), false);
  assert.equal(expandsMediaWorkspace("loading-media"), true);
  assert.equal(showsRealMedia("loading-media"), false);
  assert.equal(showsRealMedia("ready"), true);
});

test("follow-ups and limited-evidence responses never create another workspace", () => {
  assert.equal(
    shouldRenderEvidenceWorkspace({
      status: "answered",
      retrievalDecision: "continue_current_evidence",
      hasMedia: true,
      hasCitations: true,
    }),
    false
  );
  assert.equal(
    shouldRenderEvidenceWorkspace({
      status: "abstained",
      hasMedia: true,
      hasCitations: false,
    }),
    false
  );
  assert.equal(
    shouldRenderEvidenceWorkspace({
      status: "answered",
      retrievalDecision: "retrieve_new_source",
      hasMedia: true,
      hasCitations: true,
    }),
    true
  );
});
