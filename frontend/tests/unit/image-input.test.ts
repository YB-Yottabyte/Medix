import assert from "node:assert/strict";
import test from "node:test";
import { imageBase64FromParts } from "../../lib/ai/image-input";

test("accepts one inline image and leaves text-only messages unchanged", () => {
  assert.equal(imageBase64FromParts([{ type: "text" }]), undefined);
  assert.equal(
    imageBase64FromParts([{ type: "file", url: "data:image/png;base64,YWJj" }]),
    "YWJj"
  );
});
test("rejects remote URLs, malformed data and multiple images", () => {
  for (const url of [
    "http://127.0.0.1/secret",
    "https://example.com/image.png",
    "data:image/png;base64,!",
    "data:text/html;base64,YWJj",
  ]) {
    assert.throws(() => imageBase64FromParts([{ type: "file", url }]));
  }
  assert.throws(() =>
    imageBase64FromParts([{ type: "file" }, { type: "file" }])
  );
});
