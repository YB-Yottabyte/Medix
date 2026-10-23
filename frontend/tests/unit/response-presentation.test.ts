import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResponseLink,
  ResponseListItem,
  ResponseParagraph,
} from "../../components/chat/response-markdown";
import {
  distinctSupportedClaims,
  improvesResponseCoverage,
  medicalSourceFooter,
  planResponse,
  renderResponseParts,
  renumberReferenceLinks,
} from "../../lib/ai/response-composition";

const part = (
  text: string,
  role: "answer" | "step" | "action" | "warning"
) => ({ referenceOnly: false, role, text });

test("explicit steps form one coherent list without stock headings or altered citations", () => {
  const result = renderResponseParts(
    [
      part(
        "Check circulation beyond the bandage. [1](https://example.test/a)",
        "answer"
      ),
      part("Press for five seconds. [0:10–0:15]", "step"),
      part("Release and watch for colour to return. [0:15–0:20]", "step"),
      part(
        "If it is slow to return, loosen the bandage. [1](https://example.test/a)",
        "action"
      ),
      part(
        "Seek help if the warning signs persist. [2](https://example.test/b)",
        "warning"
      ),
    ],
    { layout: "steps" }
  );
  assert.equal((result.match(/^- /gm) ?? []).length, 3);
  assert(!result.includes("\n\n- Release"));
  assert(!result.includes("What to do") && !result.includes("Watch for"));
  assert(
    result.endsWith(
      "Seek help if the warning signs persist. [2](https://example.test/b)"
    )
  );
  assert(result.includes("[0:10–0:15]"));
});

test("warnings retain their narrative position rather than regrouping remote steps", () => {
  const result = renderResponseParts(
    [
      part("Opening.", "answer"),
      part("First instruction.", "step"),
      part("Stop condition.", "warning"),
      part("Conditional next action.", "action"),
      part("Then reassess.", "step"),
    ],
    { layout: "steps" }
  );
  assert(
    result.indexOf("First instruction") < result.indexOf("Stop condition")
  );
  assert(
    result.indexOf("Stop condition") < result.indexOf("Conditional next action")
  );
  assert(result.includes("- Conditional next action.\n- Then reassess."));
});

test("short follow-ups and why explanations stay in prose instead of one-item lists", () => {
  assert.equal(
    renderResponseParts([
      part("Direct answer.", "answer"),
      part("One useful detail.", "step"),
    ]),
    "Direct answer. One useful detail."
  );
  assert.equal(
    renderResponseParts([
      part("The supported reason.", "answer"),
      part("A supported explanation.", "answer"),
    ]),
    "The supported reason. A supported explanation."
  );
});

test("reference numbering is consecutive and globally consistent without touching video timestamps", () => {
  const sources = [
    { title: "Second source", url: "https://example.test/b" },
    { title: "First source", url: "https://example.test/a" },
    { title: "Duplicate", url: "https://example.test/b" },
  ];
  const answer = renumberReferenceLinks(
    "First [1](https://example.test/a). Second [5](https://example.test/b). Video [1:24–1:31]. Other [9](https://example.test/other).",
    sources
  );
  assert(answer.includes("[2](https://example.test/a)"));
  assert(answer.includes("[1](https://example.test/b)"));
  assert(answer.includes("[1:24–1:31]"));
  assert(answer.includes("[9](https://example.test/other)"));
  assert.equal(
    medicalSourceFooter(sources),
    "\n\nSources: [1. Second source](https://example.test/b) · [2. First source](https://example.test/a)"
  );
});

test("numeric source links are quiet accessible badges while ordinary links remain text", () => {
  const html = renderToStaticMarkup(
    createElement(ResponseLink, {
      children: "2",
      href: "https://example.test/source",
    })
  );
  assert(html.includes("medix-reference-citation"));
  assert(html.includes("[2]"));
  assert(html.includes('aria-label="Open medical reference 2"'));
  assert(html.includes('href="https://example.test/source"'));
  const normal = renderToStaticMarkup(
    createElement(ResponseLink, {
      children: "Medical source",
      href: "https://example.test/source",
    })
  );
  assert(!normal.includes("medix-reference-citation"));
  const timestamp = renderToStaticMarkup(
    createElement(ResponseLink, {
      children: "1:24–1:31",
      href: "#medix-clip=test",
    })
  );
  assert(!timestamp.includes("medix-reference-citation"));
});

test("source footer is collapsed, deduplicated and preserves clickable attribution", () => {
  const link = createElement(ResponseLink, {
    children: "1. Checked reference",
    href: "https://example.test/source",
    key: "first",
  });
  const duplicate = createElement(ResponseLink, {
    children: "1. Checked reference",
    href: "https://example.test/source",
    key: "duplicate",
  });
  const html = renderToStaticMarkup(
    createElement(ResponseParagraph, {
      children: ["Sources: ", link, " · ", duplicate],
    })
  );
  assert(html.startsWith('<details class="medix-response-sources">'));
  assert(html.includes("(1)"));
  assert(!html.includes(" open"));
  assert.equal((html.match(/href=/g) ?? []).length, 1);
  assert(html.includes("Checked reference"));
});

test("ordinary answer paragraphs are not collapsed or rewritten", () => {
  const html = renderToStaticMarkup(
    createElement(ResponseParagraph, {
      children: "Sources can disagree; this sentence is ordinary guidance.",
    })
  );
  assert(html.startsWith("<p>"));
  assert(!html.includes("<details"));
});

test("a mislabeled first step remains a direct opening without fabricated framing", () => {
  const result = renderResponseParts(
    [
      part("First verified action. [0:10–0:15]", "step"),
      part("Second verified action.", "step"),
      part("Third verified action.", "action"),
    ],
    { layout: "steps" }
  );
  assert(result.startsWith("First verified action. [0:10–0:15]\n\n"));
  assert(
    result.includes("- Second verified action.\n- Third verified action.")
  );
});

test("a citation stays with the final word of a paragraph without pinning the sentence", () => {
  const html = renderToStaticMarkup(
    createElement(ResponseParagraph, {
      children: [
        "A long supported instruction ends here. ",
        createElement(ResponseLink, {
          children: "1",
          href: "https://example.test/a",
          key: "reference",
        }),
      ],
    })
  );
  assert(
    html.includes('instruction ends <span class="medix-citation-anchor">here.')
  );
  assert(html.includes('href="https://example.test/a"'));
  assert(!html.includes('class="medix-citation-anchor">A long'));
});

test("tight Markdown list items attach references and keep ordered-list values", () => {
  const html = renderToStaticMarkup(
    createElement(ResponseListItem, {
      children: [
        "A practical instruction.\n",
        createElement(ResponseLink, {
          children: "2",
          href: "https://example.test/a",
          key: "reference",
        }),
      ],
      value: 3,
    })
  );
  assert(html.startsWith('<li value="3">'));
  assert(html.includes('class="medix-citation-anchor">instruction.'));
  assert(!html.includes("py-1"));
});

test("ordinary links, timestamps and source-only paragraphs are not glued to prose", () => {
  for (const [href, label] of [
    ["https://example.test/a", "source"],
    ["#medix-clip=test", "0:10–0:15"],
  ]) {
    const html = renderToStaticMarkup(
      createElement(ResponseParagraph, {
        children: [
          "See ",
          createElement(ResponseLink, { children: label, href, key: "link" }),
        ],
      })
    );
    assert(!html.includes("medix-citation-anchor"));
    assert(html.includes(label));
  }
  const html = renderToStaticMarkup(
    createElement(ResponseParagraph, {
      children: createElement(ResponseLink, {
        children: "1",
        href: "https://example.test/a",
      }),
    })
  );
  assert(html.startsWith("<p><a"));
});

test("conversational follow-ups combine related verified sentences and separate warning context", () => {
  const result = renderResponseParts([
    part(
      "Take the supported next action. [1](https://example.test/a)",
      "answer"
    ),
    part("Then reassess the observation. [0:15–0:20]", "action"),
    part(
      "Seek help for the stated warning condition. [2](https://example.test/b)",
      "warning"
    ),
    part(
      "Keep this second warning with its own condition. [2](https://example.test/b)",
      "warning"
    ),
  ]);
  const paragraphs = result.split("\n\n");
  assert.equal(paragraphs.length, 2);
  assert.equal(
    paragraphs[0],
    "Take the supported next action. [1](https://example.test/a) Then reassess the observation. [0:15–0:20]"
  );
  assert(
    paragraphs[1].includes("warning condition.") &&
      paragraphs[1].includes("second warning")
  );
  assert(!result.includes("- "));
});

test("paragraph breaks keep longer answers readable without removing verified content", () => {
  const texts = Array.from(
    { length: 7 },
    (_, index) =>
      `Verified sentence ${index}. [${index + 1}](https://example.test/${index})`
  );
  const result = renderResponseParts(texts.map((text) => part(text, "answer")));
  assert.equal(result.split("\n\n").length, 3);
  for (const text of texts) {
    assert(result.includes(text));
  }
  assert.equal(result.replace(/\s+/g, " "), texts.join(" "));
});

test("presentation follows the question rather than medical topic or input modality", () => {
  for (const question of [
    "What if it still hurts?",
    "Why do I need to check?",
    "What does my photo show?",
    "How do I cool a burn?",
  ]) {
    assert.equal(planResponse(question, false).layout, "paragraphs");
  }
  for (const question of [
    "Give me numbered steps",
    "Make a checklist",
    "Explain step by step",
  ]) {
    assert.equal(planResponse(question, true).layout, "steps");
  }
});

test("repair selection preserves broader supported coverage instead of preferring the latest draft", () => {
  const previous = {
    requestedClaims: 4,
    roles: ["answer", "step", "warning"] as const,
    sufficient: false,
    supportedClaims: 3,
    utility: 4,
  };
  const thinner = {
    requestedClaims: 3,
    roles: ["answer"] as const,
    sufficient: false,
    supportedClaims: 1,
    utility: 4,
  };
  assert.equal(improvesResponseCoverage(thinner, previous), false);
  // A tiny draft can have every one of its claims supported while still
  // omitting most of the answer; its survival ratio alone must not win.
  assert.equal(
    improvesResponseCoverage({ ...thinner, requestedClaims: 1 }, previous),
    false
  );
  assert.equal(improvesResponseCoverage(previous, thinner), true);
  assert.equal(improvesResponseCoverage(previous, previous), false);
  assert.equal(
    improvesResponseCoverage({ ...thinner, sufficient: true }, previous),
    true
  );
  assert.equal(
    improvesResponseCoverage({ ...previous, utility: 5 }, previous),
    true
  );
});

test("duplicate filtering preserves distinct facts and never depends on an unsupported target", () => {
  const claims = [
    { candidateIndex: 0, draftIndex: 0, text: "Observation at two seconds." },
    {
      candidateIndex: 1,
      draftIndex: 1,
      text: "Same observation, different wording.",
    },
    { candidateIndex: 2, draftIndex: 2, text: "A separate warning condition." },
    { candidateIndex: 3, draftIndex: 3, text: "A separate warning condition." },
    {
      candidateIndex: 4,
      draftIndex: 4,
      text: "A different observation at ten minutes.",
    },
  ];
  const kept = distinctSupportedClaims(
    claims,
    new Map([
      [1, 0],
      [4, 99],
    ])
  );
  assert.deepEqual(
    kept.map((claim) => claim.candidateIndex),
    [0, 2, 4]
  );
  assert.deepEqual(
    distinctSupportedClaims(claims.slice(1, 2), new Map([[1, 0]])),
    claims.slice(1, 2)
  );
});

test("a prose paragraph shares a reference only when every adjacent statement has the same support", () => {
  const source = "[1](https://example.test/a)";
  const parts = [
    {
      referenceOnly: true,
      role: "answer" as const,
      text: `First supported fact. ${source}`,
    },
    {
      referenceOnly: true,
      role: "step" as const,
      text: `A related supported fact. ${source}`,
    },
    {
      referenceOnly: true,
      role: "action" as const,
      text: "Different support. [2](https://example.test/b)",
    },
  ];
  assert.equal(
    renderResponseParts(parts),
    `First supported fact. A related supported fact. ${source} Different support. [2](https://example.test/b)`
  );
  assert.equal(
    renderResponseParts([
      parts[0],
      { referenceOnly: false, role: "step", text: "Video fact. [0:10–0:15]" },
      parts[1],
    ]),
    `First supported fact. ${source} Video fact. [0:10–0:15] A related supported fact. ${source}`
  );
});

test("main recognition guidance uses an opening and practical bullets while follow-ups stay conversational", () => {
  assert.equal(
    planResponse("How can I tell if their bandage is too tight?", true).layout,
    "steps"
  );
  assert.equal(
    planResponse("How do I apply a dressing step by step?", true).layout,
    "steps"
  );
  assert.equal(
    planResponse("What if the colour doesn't come back quickly?", false).layout,
    "paragraphs"
  );
  assert.equal(
    planResponse("How can I check it? Use prose, no bullets.", true).layout,
    "paragraphs"
  );
  assert(
    planResponse("Why do I need to check?", false).maxClaims <
      planResponse("How do I check?", true).maxClaims
  );
});

test("consecutive reference badges share one no-wrap group with the preceding word", () => {
  const html = renderToStaticMarkup(
    createElement(ResponseParagraph, {
      children: [
        "A supported sentence. ",
        createElement(ResponseLink, {
          children: "1",
          href: "https://example.test/a",
          key: "a",
        }),
        " ",
        createElement(ResponseLink, {
          children: "2",
          href: "https://example.test/b",
          key: "b",
        }),
      ],
    })
  );
  assert.equal((html.match(/class="medix-citation-anchor"/g) ?? []).length, 1);
  assert(html.indexOf("https://example.test/b") < html.indexOf("</span>"));
});

test("compact step-layout prose shares identical references without dropping safety conditions", () => {
  const citation = "[1](https://example.test/checked-source)";
  const result = renderResponseParts(
    [
      {
        referenceOnly: true,
        role: "answer",
        text: `Take the supported action. ${citation}`,
      },
      {
        referenceOnly: true,
        role: "answer",
        text: `Then reassess the result. ${citation}`,
      },
      {
        referenceOnly: true,
        role: "warning",
        text: "If the danger sign persists, seek emergency care. [2](https://example.test/escalation)",
      },
    ],
    { layout: "steps" }
  );
  assert.equal(
    result,
    `Take the supported action. Then reassess the result. ${citation}\n\nIf the danger sign persists, seek emergency care. [2](https://example.test/escalation)`
  );
  assert.equal((result.match(/checked-source/g) ?? []).length, 1);
  assert(!result.includes("- "));
});

test("a complete fluent repair can replace more fragmented claims; style never outranks completeness", () => {
  const original = {
    presentation: 2,
    requestedClaims: 5,
    roles: ["answer", "step", "warning"] as const,
    sufficient: true,
    supportedClaims: 5,
    utility: 5,
  };
  const fluent = {
    ...original,
    presentation: 5,
    requestedClaims: 3,
    supportedClaims: 3,
  };
  assert(improvesResponseCoverage(fluent, original));
  assert(!improvesResponseCoverage({ ...fluent, sufficient: false }, original));
});

test("a partial repair retains verified action and safety coverage before subjective utility", () => {
  assert(
    improvesResponseCoverage(
      {
        presentation: 4,
        requestedClaims: 3,
        roles: ["action", "warning"],
        sufficient: false,
        supportedClaims: 2,
        utility: 4,
      },
      {
        presentation: 5,
        requestedClaims: 3,
        roles: ["action"],
        sufficient: false,
        supportedClaims: 1,
        utility: 5,
      }
    )
  );
});

test("main practical guidance keeps its personal opening, distinct bullet points and safety note", () => {
  const layout = planResponse("How can I check this?", true).layout;
  const text = renderResponseParts(
    [
      part(
        "You can use the supported check for the situation you described.",
        "answer"
      ),
      part("Perform the supported check. [0:10–0:15]", "step"),
      part(
        "Interpret the result and take the supported action. [1](https://example.test/source)",
        "action"
      ),
      part(
        "Seek the supported level of help for the relevant warning signs. [2](https://example.test/safety)",
        "warning"
      ),
    ],
    { layout }
  );
  assert(text.startsWith("You can use"));
  assert.equal((text.match(/^- /gm) ?? []).length, 2);
  assert.match(text, /\n\n- Perform/);
  assert.match(text, /\n\nSeek the supported/);
  assert.match(text, /\[0:10–0:15\]/);
  assert.equal(
    planResponse("Why is the check useful?", true).layout,
    "paragraphs"
  );
  assert.equal(planResponse("What if it fails?", false).layout, "paragraphs");
});

test("compact main guidance groups adjacent verified instructions without altering text or citation provenance", () => {
  const instructions = [
    part("Perform the check. [0:10–0:15]", "step"),
    part("Observe the result. [0:15–0:20]", "step"),
    {
      ...part("Interpret the result. [1](https://example.test/source)", "step"),
      referenceOnly: true,
    },
    {
      ...part(
        "Take the conditional action. [1](https://example.test/source)",
        "action"
      ),
      referenceOnly: true,
    },
    {
      ...part(
        "Monitor as supported. [2](https://example.test/monitor)",
        "step"
      ),
      referenceOnly: true,
    },
  ];
  const parts = [
    part("Personal opening.", "answer"),
    ...instructions,
    part("Essential safety note.", "warning"),
  ];
  const compact = renderResponseParts(
    parts,
    planResponse("How can I check this?", true)
  );
  assert.equal((compact.match(/^- /gm) ?? []).length, 3);
  for (const instruction of instructions) {
    const body = instruction.text.replace(/ \[.*$/s, "");
    assert(compact.includes(body));
  }
  assert(compact.includes("[0:10–0:15] Observe the result. [0:15–0:20]"));
  assert(
    compact.includes("Interpret the result. Take the conditional action. [1]")
  );
  assert(compact.endsWith("Essential safety note."));
  const explicit = renderResponseParts(
    parts,
    planResponse("Give me step-by-step instructions", true)
  );
  assert.equal((explicit.match(/^- /gm) ?? []).length, 5);
});
