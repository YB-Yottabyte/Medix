import assert from "node:assert/strict";
import test from "node:test";
import { prepareSpeechText } from "../../lib/speech-text";

test("prepares a cited Markdown response for natural speech", () => {
  const response = `## Steps to pack a wound

1. **Apply pressure** — Press firmly. [0:16–0:19](#medix-clip=16,19)
2. Continue packing. [T005 T006]`;

  assert.equal(
    prepareSpeechText(response),
    "Steps to pack a wound 1. Apply pressure — Press firmly. 2. Continue packing."
  );
});

test("does not read follow-up evidence timestamps aloud", () => {
  assert.equal(
    prepareSpeechText(
      "Keep compressions going [0:36–0:43](#medix-evidence=aed-bundle&clip=36,43). The current video does not provide enough verified information in this segment."
    ),
    "Keep compressions going. The current video does not provide enough verified information in this segment."
  );
  assert.doesNotMatch(
    prepareSpeechText(
      "Resume compressions [0:43–0:49](#medix-evidence=bundle%2Faed&clip=43,49)."
    ),
    /0:43|medix/
  );
});
