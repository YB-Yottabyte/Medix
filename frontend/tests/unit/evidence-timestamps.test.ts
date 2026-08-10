import assert from "node:assert/strict";
import test from "node:test";
import {
  type EvidenceCitation,
  evidenceMomentTitle,
  formatPublicCitations,
  limitNumberedSteps,
  mapCitationsToClip,
  parseTimestampCitationHref,
  sanitizeProcedureAnswer,
  timestampAnswerCitations,
} from "../../lib/evidence-timestamps";

const citations: EvidenceCitation[] = [
  {
    cue_id: "T005",
    start_seconds: 43,
    end_seconds: 46,
    text: "Pack the wound with gauze.",
  },
  {
    cue_id: "T006",
    start_seconds: 47,
    end_seconds: 51,
    text: "Continue adding gauze.",
  },
];

test("maps source timestamps to the extracted clip clock", () => {
  const mapped = mapCitationsToClip(citations, 27, 117);

  assert.equal(mapped[0]?.clipStartSeconds, 16);
  assert.equal(mapped[0]?.clipEndSeconds, 19);
  assert.equal(mapped[1]?.clipStartSeconds, 20);
});

test("clamps overlapping transcript cues to the clip boundary", () => {
  const mapped = mapCitationsToClip(
    [
      {
        cue_id: "T001",
        start_seconds: 24,
        end_seconds: 30,
        text: "A cue beginning before the clip.",
      },
    ],
    27,
    117
  );

  assert.equal(mapped[0]?.clipStartSeconds, 0);
  assert.equal(mapped[0]?.clipEndSeconds, 3);
});

test("replaces internal cue IDs with stable public citation numbers", () => {
  const answer = "1. Pack the wound. [T005 T006]";

  assert.equal(
    formatPublicCitations(answer, citations),
    "1. Pack the wound. [1, 2]"
  );
  assert.doesNotMatch(formatPublicCitations(answer, citations), /T\d{3}/);
});

test("renders numeric citation arrays as clickable clip-relative timestamps", () => {
  const mapped = mapCitationsToClip(citations, 27, 117);

  assert.equal(
    timestampAnswerCitations("Pack the wound. [1, 2]", mapped),
    "Pack the wound. [0:16–0:24](#medix-clip=16,24)"
  );
  assert.deepEqual(parseTimestampCitationHref("#medix-clip=16,24"), {
    startSeconds: 16,
    endSeconds: 24,
  });
});

test("converts internal citations directly to timestamp links", () => {
  const mapped = mapCitationsToClip(citations, 27, 117);

  assert.equal(
    timestampAnswerCitations("Continue packing. [T006]", mapped),
    "Continue packing. [0:20–0:24](#medix-clip=20,24)"
  );
});

test("keeps a standalone timestamp citation on the instruction line", () => {
  const mapped = mapCitationsToClip(citations, 27, 117);
  const answer =
    "1. **Prepare the gauze**\nGather clean gauze or a clean cloth.\n\n[0:16–0:19]";

  assert.equal(
    timestampAnswerCitations(answer, mapped),
    "1. **Prepare the gauze**\nGather clean gauze or a clean cloth. [0:16–0:19](#medix-clip=16,19)"
  );
});

test("derives short contextual moment titles from transcript meaning", () => {
  assert.equal(
    evidenceMomentTitle(
      "If that doesn't stop the bleeding, move to packing the wound with gauze."
    ),
    "Begin wound packing"
  );
  assert.equal(
    evidenceMomentTitle(
      "We're going to pack it until you cannot pack any more."
    ),
    "Pack until filled"
  );
  assert.doesNotMatch(
    evidenceMomentTitle(citations[0]?.text ?? ""),
    /Evidence|T005/
  );
});

test("removes duplicated warning and evidence metadata but keeps instructions", () => {
  const warning = "Call emergency services immediately.";
  const answer = `Emergency warning\n\n${warning}\n\n## Steps to pack a wound\n\n1. Apply pressure first. [0:16]\n\nEvidence: The procedure is described in a verified medical video (source: T005–T011).`;

  const cleaned = sanitizeProcedureAnswer(answer, warning);

  assert.match(cleaned, /1\. Apply pressure first\. \[0:16\]/);
  assert.doesNotMatch(cleaned, /Emergency warning|Evidence:|T005/);
  // Report scaffolding is stripped: the answer is a chat reply, not a document.
  assert.doesNotMatch(cleaned, /Steps to pack a wound|^#/m);
});

test("strips leftover headings and the old closing filler line", () => {
  const cleaned = sanitizeProcedureAnswer(
    "## How to Perform CPR While Using an AED\n\nKeep compressions going. [0:16]\n\nSupporting video guidance is shown below."
  );

  assert.equal(cleaned, "Keep compressions going. [0:16]");
  assert.doesNotMatch(cleaned, /How to Perform|Supporting video guidance/);
  assert.equal(
    sanitizeProcedureAnswer(
      "Keep going. [0:16] Supporting video guidance is shown below."
    ),
    "Keep going. [0:16]"
  );
});

test("removes internal cue and validation diagnostics from saved responses", () => {
  const cleaned = sanitizeProcedureAnswer(
    "Keep CPR going (cue T021).\n\nGeneration output failed grounding validation: lexical support was low."
  );
  assert.equal(cleaned, "Keep CPR going.");
});

test("limits a procedure answer to four numbered steps", () => {
  const answer = `## Steps to pack a wound

1. **First** — Apply pressure. [0:16]
2. **Second** — Choose gauze. [0:20]
3. **Third** — Pack the wound. [0:25]
4. **Fourth** — Continue packing. [0:31]
5. **Fifth** — This must not render. [0:35]
Extra explanation belonging to step five.
6. **Sixth** — This must not render either. [0:38]

Supporting video guidance is shown below.`;

  const limited = limitNumberedSteps(answer);

  assert.match(limited, /4\. \*\*Fourth\*\*/);
  assert.doesNotMatch(limited, /5\. \*\*Fifth|6\. \*\*Sixth|step five/);
  assert.match(limited, /Supporting video guidance is shown below\./);
});
