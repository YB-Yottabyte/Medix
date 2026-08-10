/**
 * Before/after evaluation of the Qwen follow-up generation prompt.
 *
 * Both arms run the SAME pipeline — cue selection, verification, deterministic
 * citation rendering, and validation are held constant. Only the generation
 * system prompt differs, so any delta is attributable to the prompt change.
 *
 * Metrics are the measurable subset of the Med-PaLM 2 long-form rubric
 * (Singhal et al., 2023, §3.5). Axes needing clinicians — alignment with
 * medical consensus, extent/likelihood of harm — are NOT scored here; a
 * blinded pairwise Qwen judge is reported separately and is a weak signal.
 *
 * Run: pnpm exec tsx tests/eval/followup-style-eval.ts
 * Requires Ollama serving OLLAMA_CHAT_MODEL (default qwen3.5:9b-q4_K_M).
 */
import { generateText } from "ai";
import {
  buildFollowUpCues,
  type GroundedClaim,
  parseClaimVerification,
  parseGroundedClaims,
  parseUnsupportedAspect,
  renderGroundedClaims,
  validateFollowUpAnswer,
} from "../../lib/ai/medical-follow-up";
import { getFollowUpModel } from "../../lib/ai/providers";
import type { TranscriptCitation } from "../../lib/ai/tools/search-procedure";

const EVIDENCE: TranscriptCitation[] = [
  {
    cue_id: "S1",
    start_seconds: 24,
    end_seconds: 31,
    clip_start_seconds: 24,
    clip_end_seconds: 31,
    text: "Once the AED arrives, turn it on and it will talk you through every step.",
  },
  {
    cue_id: "S2",
    start_seconds: 31,
    end_seconds: 36,
    clip_start_seconds: 31,
    clip_end_seconds: 36,
    text: "Attach the AED pads to the patient's bare chest, one below the right collarbone and one on the left side below the armpit.",
  },
  {
    cue_id: "S3",
    start_seconds: 36,
    end_seconds: 43,
    clip_start_seconds: 36,
    clip_end_seconds: 43,
    text: "Keep doing chest compressions the whole time the second rescuer is preparing the AED.",
  },
  {
    cue_id: "S4",
    start_seconds: 43,
    end_seconds: 49,
    clip_start_seconds: 43,
    clip_end_seconds: 49,
    text: "When the machine says stand clear, make sure nobody is touching the patient before the shock is delivered.",
  },
  {
    cue_id: "S5",
    start_seconds: 49,
    end_seconds: 56,
    clip_start_seconds: 49,
    clip_end_seconds: 56,
    text: "Straight after the shock, go back to chest compressions without waiting.",
  },
  {
    cue_id: "S6",
    start_seconds: 56,
    end_seconds: 63,
    clip_start_seconds: 56,
    clip_end_seconds: 63,
    text: "If the chest is very hairy, use the razor in the AED kit so the pads stick properly.",
  },
];

/** Each case fixes the selected cues so only generation wording varies. */
const CASES: Array<{
  question: string;
  cueIds: string[];
  sufficiency: "sufficient" | "partial";
}> = [
  {
    question: "Should I keep doing compressions while the AED is being set up?",
    cueIds: ["T003"],
    sufficiency: "sufficient",
  },
  {
    question: "Where exactly do the pads go?",
    cueIds: ["T002"],
    sufficiency: "sufficient",
  },
  {
    question: "What do I do right after the shock is delivered?",
    cueIds: ["T005"],
    sufficiency: "sufficient",
  },
  {
    question: "What if the person has a really hairy chest?",
    cueIds: ["T006"],
    sufficiency: "sufficient",
  },
  {
    question: "Is it safe for me to be touching them when it shocks?",
    cueIds: ["T004"],
    sufficiency: "sufficient",
  },
  {
    question: "Do I need to know how to use the machine before it arrives?",
    cueIds: ["T001"],
    sufficiency: "sufficient",
  },
  {
    question: "How many compressions per minute should I be doing?",
    cueIds: ["T003"],
    sufficiency: "partial",
  },
  {
    question: "How long do I keep going before I can stop?",
    cueIds: ["T003", "T005"],
    sufficiency: "partial",
  },
];

const BEFORE_PROMPT = `You answer a medical-procedure follow-up using ONLY the supplied transcript cues.
Produce at most 3 short claims, at most 90 words in total.
Every claim must be stated in plain language and be entailed by the cues you cite.
Do not diagnose, prescribe, or add general medical knowledge that is not in the cues.
Do not write timestamps, cue IDs, headings, bullets, or disclaimers. Application code adds citations.
Return JSON only:
{"claims":[{"text":"...","cueIds":["T001"]}]}`;

const AFTER_PROMPT = `You are a medical guidance assistant answering a follow-up about a procedure, using ONLY the supplied transcript cues.

First, work out internally:
- "intent": one short line naming exactly what the user wants to know.
- "unsupportedAspect": if the cues answer only part of that intent, name the missing part in a few words, phrased from the user's question. Use "" when the cues fully answer it. Never put medical advice here.

Then write the answer as claims:
- Address the intent directly. The first claim must answer what was actually asked, not background.
- Every claim states what the evidence DOES support. Never write a claim saying the cues do not specify, do not mention, or do not cover something — that belongs only in "unsupportedAspect". When the cues answer only part of the question, still answer that part in the claims.
- Be useful and complete within the cues: include the supported details that matter, and nothing else.
- Include no content that is inaccurate or irrelevant to the question.
- Plain, natural, conversational language, as if speaking to the person doing this. Do not quote or paraphrase the transcript line by line, and do not use transcript-style wording.
- At most 3 claims and 90 words total. Every claim must be entailed by the cues you cite.
- Do not diagnose, prescribe, or add any medical knowledge that is not in the cues.
- Do not write timestamps, cue IDs, headings, bullets, bold, or disclaimers. Application code adds citations.

Return JSON only:
{"intent":"...","unsupportedAspect":"","claims":[{"text":"...","cueIds":["T001"]}]}`;

const VERIFICATION_PROMPT = `You verify a proposed medical answer against the transcript cues it cites.
For each claim decide whether the cited cues entail it. Do not add, rewrite, or extend any medical content.
Use "accept" when every claim is supported, "refine" when some claims are supported and others are not, and "reject" when the answer is unsupported or unsafe.
Rate each claim's groundedness: "full" when the cited cues state it outright, "partial" when they imply part of it, "none" when they do not support it.
Also rate the usefulness of the whole answer to the user's question from 1 to 5, where 1 means it does not address the question and 5 means it answers it directly.
Cite only cue IDs from the supplied list.
Return JSON only:
{"verdict":"accept|refine|reject","utility":4,"claims":[{"claimIndex":0,"support":"full|partial|none","cueIds":["T001"]}]}`;

// Same thinking-disable the production pipeline uses; without it Qwen 3.5
// returns empty content and BOTH arms score zero.
const LOCAL_MODEL_OPTIONS = { ollama: { reasoningEffort: "none" } } as const;

const cues = buildFollowUpCues(EVIDENCE);
const model = getFollowUpModel();

function formatCues(ids: string[]) {
  return cues
    .filter((cue) => ids.includes(cue.id))
    .map((cue) => `${cue.id} ${cue.timestamp}\n${cue.citation.text}`)
    .join("\n\n");
}

type Outcome = {
  question: string;
  answer: string;
  valid: boolean;
  utility: number | null;
  claimCount: number;
  droppedClaims: number;
  failure: string;
};

async function runArm(
  systemPrompt: string,
  testCase: (typeof CASES)[number]
): Promise<Outcome> {
  const cueList = formatCues(testCase.cueIds);
  const generation = await generateText({
    model,
    temperature: 0.1,
    maxOutputTokens: 400,
    providerOptions: LOCAL_MODEL_OPTIONS,
    system: systemPrompt,
    prompt: `Follow-up: ${testCase.question}\nEvidence sufficiency: ${testCase.sufficiency}\n\nSelected transcript cues:\n${cueList}`,
  });

  const claims = parseGroundedClaims(generation.text, testCase.cueIds);
  const limitation = parseUnsupportedAspect(generation.text);
  if (!claims) {
    return {
      question: testCase.question,
      answer: "",
      valid: false,
      utility: null,
      claimCount: 0,
      droppedClaims: 0,
      failure: `unparseable claims: ${generation.text.slice(0, 120)}`,
    };
  }

  const verification = await generateText({
    model,
    temperature: 0,
    maxOutputTokens: 400,
    providerOptions: LOCAL_MODEL_OPTIONS,
    system: VERIFICATION_PROMPT,
    prompt: `Follow-up: ${testCase.question}\n\nSelected transcript cues:\n${cueList}\n\nProposed claims:\n${claims
      .map((c, i) => `${i}: ${c.text} (cites ${c.cueIds.join(", ")})`)
      .join("\n")}`,
  });
  const verdict = parseClaimVerification(verification.text, testCase.cueIds);

  const kept: GroundedClaim[] =
    verdict && verdict.claims.length > 0
      ? claims.filter((_, i) => {
          const v = verdict.claims.find((c) => c.claimIndex === i);
          return v && v.support !== "none";
        })
      : claims;
  const downgraded =
    kept.length < claims.length ||
    Boolean(verdict?.claims.some((c) => c.support === "partial"));
  const sufficiency = downgraded ? "partial" : testCase.sufficiency;

  const rendered = renderGroundedClaims(
    kept,
    cues.filter((c) => testCase.cueIds.includes(c.id)),
    sufficiency,
    limitation
  );
  const validation = validateFollowUpAnswer(rendered, EVIDENCE);

  return {
    question: testCase.question,
    answer: validation.answer,
    valid: validation.valid,
    utility: verdict?.utility ?? null,
    claimCount: claims.length,
    droppedClaims: claims.length - kept.length,
    failure: validation.valid ? "" : `invalid render: ${rendered.slice(0, 160)}`,
  };
}

// --- Deterministic metrics, derived from the Med-PaLM 2 rubric axes ---

function stripCitations(text: string) {
  return text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
}

function words(text: string) {
  return stripCitations(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Longest verbatim run shared with any cue: proxy for transcript-style copying. */
function longestCueEcho(answer: string) {
  const answerWords = words(answer);
  let longest = 0;
  for (const cue of EVIDENCE) {
    const cueWords = words(cue.text);
    for (let i = 0; i < answerWords.length; i++) {
      for (let j = i + longest; j < answerWords.length; j++) {
        const span = answerWords.slice(i, j + 1).join(" ");
        if (cueWords.join(" ").includes(span)) {
          longest = Math.max(longest, j - i + 1);
        } else {
          break;
        }
      }
    }
  }
  return longest;
}

/** "Inclusion of irrelevant content": transcript-referential framing. */
/** A cited claim asserting absence of information: a grounding defect. */
const ABSENCE_CLAIM =
  /\b(?:cues?|transcript|video)\b[^.]{0,40}\bdo(?:es)? not (?:specify|mention|state|indicate|cover)\b/i;

const TRANSCRIPT_VOICE =
  /\b(?:the (?:video|transcript|clip)|according to|as (?:shown|mentioned|stated)|the speaker|it says|this segment)\b/i;

/** Report scaffolding the answer should never contain. */
const SCAFFOLDING = /(^|\n)\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*$)|Supporting video guidance/im;

function firstSentence(answer: string) {
  return stripCitations(answer).split(/(?<=[.!?])\s/)[0] ?? "";
}

/** "Addresses the intent": first sentence carries the question's content words. */
function intentOverlap(question: string, answer: string) {
  const stop = new Set([
    "what", "how", "when", "where", "should", "the", "and", "for", "you",
    "your", "are", "was", "can", "could", "with", "that", "this", "into",
    "does", "did", "have", "has", "will", "would", "them", "they", "there",
    "here", "very", "much", "many", "need", "know", "safe", "before", "after",
    "while", "being", "doing", "keep", "going", "right", "really", "person",
  ]);
  const q = new Set(words(question).filter((w) => w.length > 2 && !stop.has(w)));
  if (q.size === 0) {
    return 1;
  }
  const first = new Set(words(firstSentence(answer)));
  return [...q].filter((w) => first.has(w)).length / q.size;
}

type ArmSummary = {
  label: string;
  validRate: number;
  meanUtility: number;
  meanWords: number;
  meanIntentOverlap: number;
  transcriptVoiceRate: number;
  scaffoldingRate: number;
  meanLongestEcho: number;
  absenceClaimRate: number;
  limitationRate: number;
  droppedClaimRate: number;
};

function summarize(label: string, outcomes: Outcome[]): ArmSummary {
  const valid = outcomes.filter((o) => o.valid && o.answer);
  const mean = (nums: number[]) =>
    nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  const partialCases = outcomes.filter((_, i) => CASES[i].sufficiency === "partial");
  return {
    label,
    validRate: outcomes.filter((o) => o.valid).length / outcomes.length,
    meanUtility: mean(
      outcomes.map((o) => o.utility).filter((u): u is number => u !== null)
    ),
    meanWords: mean(valid.map((o) => words(o.answer).length)),
    meanIntentOverlap: mean(
      valid.map((o) => intentOverlap(o.question, o.answer))
    ),
    transcriptVoiceRate:
      valid.filter((o) => TRANSCRIPT_VOICE.test(o.answer)).length /
      Math.max(1, valid.length),
    scaffoldingRate:
      valid.filter((o) => SCAFFOLDING.test(o.answer)).length /
      Math.max(1, valid.length),
    meanLongestEcho: mean(valid.map((o) => longestCueEcho(o.answer))),
    absenceClaimRate:
      valid.filter((o) => ABSENCE_CLAIM.test(o.answer)).length /
      Math.max(1, valid.length),
    limitationRate:
      partialCases.filter((o) =>
        /does not (?:contain|provide) enough verified/i.test(o.answer)
      ).length / Math.max(1, partialCases.length),
    droppedClaimRate: mean(outcomes.map((o) => o.droppedClaims)),
  };
}

/** Blinded pairwise judge on four Med-PaLM 2 axes. Weak: judge is the same 9B. */
async function judge(
  question: string,
  answerA: string,
  answerB: string,
  flipped: boolean
) {
  const { text } = await generateText({
    model,
    temperature: 0,
    maxOutputTokens: 200,
    providerOptions: LOCAL_MODEL_OPTIONS,
    system: `You compare two answers to the same medical question. For each axis pick "A", "B", or "tie".
Axes: addressesIntent (which better answers what was asked), completeness (which omits less important information), irrelevantContent (which contains LESS content it shouldn't — pick the better one), naturalness (which reads more like a person explaining, less like a transcript).
Return JSON only: {"addressesIntent":"A|B|tie","completeness":"A|B|tie","irrelevantContent":"A|B|tie","naturalness":"A|B|tie"}`,
    prompt: `Question: ${question}\n\nAnswer A:\n${answerA}\n\nAnswer B:\n${answerB}`,
  });
  const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Record<
    string,
    string
  >;
  // Undo the presentation flip so "before"/"after" is recovered.
  const resolve = (verdict?: string) => {
    if (verdict !== "A" && verdict !== "B") {
      return "tie";
    }
    const isFirst = verdict === "A";
    return (flipped ? !isFirst : isFirst) ? "before" : "after";
  };
  return {
    addressesIntent: resolve(parsed.addressesIntent),
    completeness: resolve(parsed.completeness),
    irrelevantContent: resolve(parsed.irrelevantContent),
    naturalness: resolve(parsed.naturalness),
  };
}

async function main() {
  const before: Outcome[] = [];
  const after: Outcome[] = [];

  for (const testCase of CASES) {
    process.stdout.write(`· ${testCase.question}\n`);
    before.push(await runArm(BEFORE_PROMPT, testCase));
    after.push(await runArm(AFTER_PROMPT, testCase));
  }

  const summaries = [summarize("before", before), summarize("after", after)];

  console.log("\n=== Deterministic metrics (Med-PaLM 2 rubric proxies) ===");
  console.table(
    summaries.map((s) => ({
      arm: s.label,
      "valid%": (s.validRate * 100).toFixed(0),
      utility: s.meanUtility.toFixed(2),
      words: s.meanWords.toFixed(1),
      "intent-overlap": s.meanIntentOverlap.toFixed(2),
      "transcript-voice%": (s.transcriptVoiceRate * 100).toFixed(0),
      "scaffolding%": (s.scaffoldingRate * 100).toFixed(0),
      "longest-echo": s.meanLongestEcho.toFixed(1),
      "absence-claim%": (s.absenceClaimRate * 100).toFixed(0),
      "limitation-stated%": (s.limitationRate * 100).toFixed(0),
      "claims-dropped": s.droppedClaimRate.toFixed(2),
    }))
  );

  console.log("\n=== Blinded pairwise judge (secondary; same 9B is the judge) ===");
  const tally: Record<string, Record<string, number>> = {};
  for (let i = 0; i < CASES.length; i++) {
    if (!(before[i].answer && after[i].answer)) {
      continue;
    }
    const flipped = i % 2 === 1;
    const [a, b] = flipped
      ? [after[i].answer, before[i].answer]
      : [before[i].answer, after[i].answer];
    const verdicts = await judge(CASES[i].question, a, b, flipped);
    for (const [axis, winner] of Object.entries(verdicts)) {
      tally[axis] ??= { before: 0, after: 0, tie: 0 };
      tally[axis][winner] += 1;
    }
  }
  console.table(tally);

  console.log("\n=== Sample answers ===");
  for (let i = 0; i < CASES.length; i++) {
    console.log(`\nQ: ${CASES[i].question}`);
    console.log(`  before: ${before[i].answer || "(failed validation)"}`);
    console.log(`  after : ${after[i].answer || "(failed validation)"}`);
    if (before[i].failure) {
      console.log(`    [before] ${before[i].failure}`);
    }
    if (after[i].failure) {
      console.log(`    [after ] ${after[i].failure}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
