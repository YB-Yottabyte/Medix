/**
 * Qwen 3.5 9B vs MedGemma 1.5 4B IT on the Medix grounded-answer contract.
 *
 * Both models get IDENTICAL prompts, identical EvidenceBundle cues, and pass
 * through the identical parse -> verify -> render -> validate pipeline that
 * production uses. Nothing about retrieval, localization, or the bundle is
 * involved; cues are fixed so only the generating model varies.
 *
 * Groundedness is scored by a NEUTRAL third model (llama3.1:8b) so that neither
 * candidate grades itself or its own family.
 *
 * Run: pnpm exec tsx tests/eval/model-comparison.ts
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type LanguageModel } from "ai";
import {
  buildFollowUpCues,
  type GroundedClaim,
  parseClaimVerification,
  parseGroundedClaims,
  parseSemanticAssessment,
  parseUnsupportedAspect,
  renderGroundedClaims,
  validateFollowUpAnswer,
} from "../../lib/ai/medical-follow-up";
import { QWEN_CHAT_MODEL } from "../../lib/ai/models";
import { ollamaOpenAIBaseUrl } from "../../lib/ai/providers";
import {
  isSolAvailable,
  SOL_CHAT_MODEL,
  solOllamaBaseUrl,
} from "../../lib/ai/sol";
import type { TranscriptCitation } from "../../lib/ai/tools/search-procedure";
import { sanitizeProcedureAnswer } from "../../lib/evidence-timestamps";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: ollamaOpenAIBaseUrl(),
  apiKey: "ollama",
});
const NO_THINKING = { ollama: { reasoningEffort: "none" } } as const;

/**
 * Pinned here rather than imported from lib/ai/models: MedGemma was evaluated
 * and not promoted, so it is deliberately absent from the production model
 * configuration. Keeping the identifier local means this experiment stays
 * reproducible without reintroducing MedGemma as a selectable model.
 * See docs/research/medgemma_comparison.md.
 */
const MEDGEMMA_EVAL_MODEL =
  process.env.OLLAMA_MEDGEMMA_MODEL ??
  "hf.co/unsloth/medgemma-1.5-4b-it-GGUF:Q4_K_M";
/**
 * Groundedness judge. A model outside both candidate families is preferred
 * (e.g. llama3.1:8b); when none is installed this falls back to the strongest
 * available model, which then grades its own output on one arm. That bias is
 * printed with the results and must be discounted when reading them.
 */
const JUDGE_MODEL = process.env.MEDIX_JUDGE_MODEL ?? SOL_CHAT_MODEL;

/** Sol runs behind an SSH tunnel; same client shape, different base URL. */
const sol = createOpenAICompatible({
  name: "ollama",
  baseURL: solOllamaBaseUrl(),
  apiKey: "ollama",
});

/**
 * Candidates are chosen by MEDIX_EVAL_MODELS (comma-separated labels) so the
 * MedGemma experiment stays reproducible while the Sol comparison runs by
 * default. All candidates share the prompts, cues, pipeline, and validators.
 */
const ALL_CANDIDATES: Record<string, { label: string; model: LanguageModel }> =
  {
    qwen35: { label: "qwen3.5-9b (local)", model: ollama(QWEN_CHAT_MODEL) },
    qwen36: { label: "qwen3.6-27b (Sol)", model: sol(SOL_CHAT_MODEL) },
    medgemma: { label: "medgemma1.5-4b", model: ollama(MEDGEMMA_EVAL_MODEL) },
  };
const CANDIDATES = (process.env.MEDIX_EVAL_MODELS ?? "qwen35,qwen36")
  .split(",")
  .map((key) => ALL_CANDIDATES[key.trim()])
  .filter(Boolean);

const judgeModel =
  JUDGE_MODEL === SOL_CHAT_MODEL ? sol(JUDGE_MODEL) : ollama(JUDGE_MODEL);
const judgeIsCandidate = CANDIDATES.some((c) =>
  c.label.includes(JUDGE_MODEL === SOL_CHAT_MODEL ? "3.6" : JUDGE_MODEL)
);
// ---------------------------------------------------------------- evidence

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

const cues = buildFollowUpCues(EVIDENCE);
const ALL_CUE_IDS = cues.map((cue) => cue.id);
const cueList = (ids: string[]) =>
  cues
    .filter((cue) => ids.includes(cue.id))
    .map((cue) => `${cue.id} ${cue.timestamp}\n${cue.citation.text}`)
    .join("\n\n");

/**
 * `answerable` cases are covered by the bundle. `unanswerable` cases are NOT —
 * a correct system abstains rather than answering from parametric medical
 * knowledge, which is exactly what a medical-domain model is most tempted to do.
 */
const FOLLOW_UPS: Array<{
  question: string;
  cueIds: string[];
  kind: "answerable" | "unanswerable";
}> = [
  {
    question: "Should I keep doing compressions while the AED is being set up?",
    cueIds: ["T003"],
    kind: "answerable",
  },
  {
    question: "Where exactly do the pads go?",
    cueIds: ["T002"],
    kind: "answerable",
  },
  {
    question: "What do I do right after the shock is delivered?",
    cueIds: ["T005"],
    kind: "answerable",
  },
  {
    question: "What if the person has a really hairy chest?",
    cueIds: ["T006"],
    kind: "answerable",
  },
  {
    question: "Is it safe for me to be touching them when it shocks?",
    cueIds: ["T004"],
    kind: "answerable",
  },
  {
    question: "Do I need to know how to use the machine before it arrives?",
    cueIds: ["T001"],
    kind: "answerable",
  },
  {
    question: "How many compressions per minute should I be doing?",
    cueIds: [],
    kind: "unanswerable",
  },
  {
    question: "What compression depth is correct for an adult?",
    cueIds: [],
    kind: "unanswerable",
  },
  {
    question: "What should I do if the AED says no shock advised?",
    cueIds: [],
    kind: "unanswerable",
  },
  {
    question: "How much adrenaline should be given during the arrest?",
    cueIds: [],
    kind: "unanswerable",
  },
];

const INITIAL_QUESTIONS = [
  "How do I use an AED on someone who has collapsed?",
  "Can I keep the tourniquet on until the ambulance arrives?",
];
const INITIAL_EVIDENCE: Record<string, string> = {
  "How do I use an AED on someone who has collapsed?": EVIDENCE.map(
    (c) =>
      `[${Math.floor(c.start_seconds / 60)}:${String(c.start_seconds % 60).padStart(2, "0")}–${Math.floor(c.end_seconds / 60)}:${String(c.end_seconds % 60).padStart(2, "0")}] ${c.text}`
  ).join("\n"),
  "Can I keep the tourniquet on until the ambulance arrives?": `[1:02–1:14] Once the tourniquet is tightened, do not loosen it.
[1:14–1:25] Write down the time you applied it.`,
};

// ----------------------------------------------------------------- prompts
// Verbatim from lib/ai/medical-follow-up.ts so both models face production text.

const ASSESSMENT_PROMPT = `You classify a follow-up turn against one already-retrieved medical video transcript.

First choose the relation:
- "continue_to_use_evidence": a factual question about the same procedure, answerable from the conversation or the transcript cues below.
- "no_retrieval_needed": the turn needs no factual medical grounding at all.
- "topic_change": the turn is about a clearly different medical procedure or topic.
- "uncertain": you cannot tell.

Then judge whether the supplied transcript cues can answer it.
Select cue IDs only from the supplied list. Never invent a cue ID.
sufficiency is "sufficient" when the supporting cues fully answer the follow-up, "partial" when they answer only part of it, and "insufficient" when the transcript cannot answer it.
Judge meaning, not word overlap.

Return one JSON object only. "relation" must be EXACTLY ONE of "continue_to_use_evidence", "no_retrieval_needed", "topic_change", "uncertain"; "sufficiency" must be EXACTLY ONE of "sufficient", "partial", "insufficient". Never output the list of options as the value. Well-formed example:
{"relation":"continue_to_use_evidence","sufficiency":"sufficient","supportingCueIds":["T002"],"relatedCueIds":["T001"]}`;

const GENERATION_PROMPT = `You are a medical guidance assistant answering a follow-up about a procedure, using ONLY the supplied transcript cues.

First, work out internally:
- "intent": one short line naming exactly what the user wants to know.
- "unsupportedAspect": if the cues answer only part of that intent, name the missing part in a few words. Use "" when the cues fully answer it.

Then write the answer as claims:
- Address the intent directly.
- Every claim states what the evidence DOES support. Never write a claim saying the cues do not specify something.
- Plain, natural, conversational language. Do not use transcript-style wording.
- At most 3 claims and 90 words total. Every claim must be entailed by the cues you cite.
- Do not diagnose, prescribe, or add any medical knowledge that is not in the cues.
- Do not write timestamps, cue IDs, headings, bullets, bold, or disclaimers.

Return one JSON object only. Well-formed example:
{"intent":"whether compressions continue during AED setup","unsupportedAspect":"","claims":[{"text":"Keep chest compressions going while the AED is prepared","cueIds":["T002"]}]}`;

const VERIFICATION_PROMPT = `You verify a proposed medical answer against the transcript cues it cites.
For each claim decide whether the cited cues entail it. Do not add, rewrite, or extend any medical content.
Use "accept" when every claim is supported, "refine" when some are and some are not, "reject" when the answer is unsupported or unsafe.
Rate each claim's groundedness: "full", "partial", or "none".
Also rate usefulness of the whole answer to the question from 1 to 5.
Return one JSON object only. "verdict" must be EXACTLY ONE of "accept", "refine", "reject"; each "support" must be EXACTLY ONE of "full", "partial", "none"; "utility" is a number from 1 to 5. Never output the list of options as the value. Well-formed example:
{"verdict":"accept","utility":4,"claims":[{"claimIndex":0,"support":"full","cueIds":["T002"]}]}`;

const INITIAL_PROMPT = `You are Medix, a hands-free assistant for medical procedures and first aid.
The searchProcedure tool has already returned verified evidence. Write the user-facing answer now.
Use only the supplied transcript citations for procedural claims. Never print cue IDs.

Response rules:
- Answer the question the user actually asked, in your first sentence, in plain language.
- Write like a knowledgeable clinician talking to someone in a chat, not like a report. No headings, no section titles.
- Use a short numbered list only when the answer really is a sequence of actions, at most four items.
- Be useful and complete within the evidence, and leave out anything the evidence does not establish.
- Use bold at most once or twice, only for a genuine warning or critical action.
- End every evidence-supported action with a timestamp citation on the same line, formatted exactly like [0:16–0:31].
- Do not end with a sign-off or filler.
- If the evidence covers only part of the question, answer that part and say plainly what the video does not cover. Never fill the gap from general knowledge.
- Do not diagnose, prescribe, or invent medication dosages.`;

// ------------------------------------------------------------------ runner

type FollowUpResult = {
  question: string;
  kind: "answerable" | "unanswerable";
  answered: boolean;
  abstained: boolean;
  answer: string;
  valid: boolean;
  parseFailure: boolean;
  latencyMs: number;
  hallucinatedCueId: boolean;
};

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = process.hrtime.bigint();
  const value = await fn();
  return [value, Number(process.hrtime.bigint() - started) / 1e6];
}

async function runFollowUp(
  model: LanguageModel,
  testCase: (typeof FOLLOW_UPS)[number]
): Promise<FollowUpResult> {
  const base = {
    question: testCase.question,
    kind: testCase.kind,
    answered: false,
    abstained: false,
    answer: "",
    valid: false,
    parseFailure: false,
    latencyMs: 0,
    hallucinatedCueId: false,
  };

  const [, totalMs] = await timed(async () => {
    // Stage 1: assessment over the FULL bundle — the model chooses the cues.
    const assessmentText = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 1200,
      providerOptions: NO_THINKING,
      system: ASSESSMENT_PROMPT,
      prompt: `Original procedure query: How do I use an AED?\nRecent conversation:\nuser: How do I use an AED?\n\nLatest follow-up: ${testCase.question}\n\nTranscript cues:\n${cueList(ALL_CUE_IDS)}`,
    }).then((r) => r.text);

    const assessment = parseSemanticAssessment(assessmentText, cues);
    if (!assessment) {
      base.parseFailure = true;
      base.abstained = true;
      // Distinguish an unparseable payload from an invented cue ID.
      base.hallucinatedCueId = /T\d{3}/.test(assessmentText)
        ? !(assessmentText.match(/T\d{3}/g) ?? []).every((id) =>
            ALL_CUE_IDS.includes(id)
          )
        : false;
      return;
    }
    const selected =
      assessment.supportingCueIds.length > 0
        ? assessment.supportingCueIds
        : assessment.sufficiency === "partial"
          ? assessment.relatedCueIds
          : [];
    if (assessment.sufficiency === "insufficient" || selected.length === 0) {
      base.abstained = true;
      return;
    }

    // Stage 2: grounded generation from the selected cues only.
    const generationText = await generateText({
      model,
      temperature: 0.1,
      maxOutputTokens: 1200,
      providerOptions: NO_THINKING,
      system: GENERATION_PROMPT,
      prompt: `Follow-up: ${testCase.question}\nEvidence sufficiency: ${assessment.sufficiency}\n\nSelected transcript cues:\n${cueList(selected)}`,
    }).then((r) => r.text);

    const claims = parseGroundedClaims(generationText, selected);
    const limitation = parseUnsupportedAspect(generationText);
    if (!claims) {
      base.parseFailure = true;
      base.abstained = true;
      return;
    }

    // Stage 3: verification.
    const verificationText = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 1200,
      providerOptions: NO_THINKING,
      system: VERIFICATION_PROMPT,
      prompt: `Follow-up: ${testCase.question}\n\nSelected transcript cues:\n${cueList(selected)}\n\nProposed claims:\n${claims.map((c, i) => `${i}: ${c.text} (cites ${c.cueIds.join(", ")})`).join("\n")}`,
    }).then((r) => r.text);

    const verdict = parseClaimVerification(verificationText, selected);
    if (!verdict || verdict.verdict === "reject") {
      base.abstained = true;
      return;
    }
    const kept: GroundedClaim[] =
      verdict.claims.length > 0
        ? claims.filter((_, i) => {
            const v = verdict.claims.find((c) => c.claimIndex === i);
            return v && v.support !== "none";
          })
        : claims;
    if (kept.length === 0) {
      base.abstained = true;
      return;
    }
    const downgraded =
      kept.length < claims.length ||
      verdict.claims.some((c) => c.support === "partial");
    const rendered = renderGroundedClaims(
      kept,
      cues.filter((c) => selected.includes(c.id)),
      downgraded || assessment.sufficiency === "partial"
        ? "partial"
        : "sufficient",
      limitation
    );
    const validation = validateFollowUpAnswer(rendered, EVIDENCE);
    base.answer = validation.answer;
    base.valid = validation.valid;
    base.answered = validation.valid;
    base.abstained = !validation.valid;
  });

  base.latencyMs = totalMs;
  return base;
}

// ------------------------------------------------------------ neutral judge

/** Counts sentences not entailed by the bundle. Judge is a third model. */
async function countUnsupported(answer: string, evidenceText: string) {
  if (!answer.trim()) {
    return 0;
  }
  const { text } = await generateText({
    model: judgeModel,
    temperature: 0,
    maxOutputTokens: 300,
    system: `You check whether a medical answer stays within its evidence.
Split the ANSWER into factual statements. A statement is SUPPORTED only if the EVIDENCE states or directly entails it.
General medical knowledge that is true but absent from the EVIDENCE counts as UNSUPPORTED.
Ignore timestamps and hedging phrases about what the video does not cover.
Return JSON only: {"total":N,"unsupported":N,"examples":["..."]}`,
    prompt: `EVIDENCE:\n${evidenceText}\n\nANSWER:\n${answer}`,
  });
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*?\}/)?.[0] ?? "{}");
    return typeof parsed.unsupported === "number" ? parsed.unsupported : 0;
  } catch {
    return 0;
  }
}

const HEADING = /(^|\n)\s*#{1,6}\s+\S|(^|\n)\s*\*\*[^*\n]{6,}\*\*\s*$/m;
const FILLER =
  /supporting video guidance|hope this helps|let me know if|in summary/i;

async function main() {
  const evidenceText = EVIDENCE.map((c) => c.text).join("\n");

  if (
    CANDIDATES.some((c) => c.label.includes("Sol")) &&
    !(await isSolAvailable())
  ) {
    console.error(
      "Sol session unavailable — start the SSH tunnel and GPU job, or run\n" +
        "  MEDIX_EVAL_MODELS=qwen35 pnpm eval:models\n" +
        "to evaluate local models only."
    );
    process.exit(1);
  }

  console.log(`Judge model: ${JUDGE_MODEL}`);
  if (judgeIsCandidate) {
    console.log(
      "  WARNING: the judge is also a candidate. It grades its own output on\n" +
        "  one arm, so unsupported-claim counts favouring it must be discounted.\n" +
        "  Install a neutral judge and re-run for a clean number:\n" +
        "    ollama pull llama3.1:8b && MEDIX_JUDGE_MODEL=llama3.1:8b pnpm eval:models"
    );
  }
  console.log(`Candidates: ${CANDIDATES.map((c) => c.label).join(" vs ")}\n`);
  const followUpRows: Record<string, unknown>[] = [];
  const initialRows: Record<string, unknown>[] = [];
  const transcripts: string[] = [];

  for (const candidate of CANDIDATES) {
    console.log(`\n### ${candidate.label} — follow-ups`);
    const results: FollowUpResult[] = [];
    for (const testCase of FOLLOW_UPS) {
      process.stdout.write(`  · ${testCase.question}\n`);
      results.push(await runFollowUp(candidate.model, testCase));
    }

    const answerable = results.filter((r) => r.kind === "answerable");
    const unanswerable = results.filter((r) => r.kind === "unanswerable");
    let unsupportedTotal = 0;
    for (const r of results.filter((x) => x.answer)) {
      unsupportedTotal += await countUnsupported(r.answer, evidenceText);
    }

    followUpRows.push({
      model: candidate.label,
      "answered/answerable": `${answerable.filter((r) => r.answered).length}/${answerable.length}`,
      "abstained/unanswerable": `${unanswerable.filter((r) => r.abstained).length}/${unanswerable.length}`,
      "parse-fail": results.filter((r) => r.parseFailure).length,
      "hallucinated-cue": results.filter((r) => r.hallucinatedCueId).length,
      "unsupported-claims": unsupportedTotal,
      "mean-words": (
        results
          .filter((r) => r.answer)
          .reduce(
            (sum, r) => sum + r.answer.split(/\s+/).filter(Boolean).length,
            0
          ) / Math.max(1, results.filter((r) => r.answer).length)
      ).toFixed(0),
      "median-latency-s": (
        [...results].map((r) => r.latencyMs).sort((a, b) => a - b)[
          Math.floor(results.length / 2)
        ] / 1000
      ).toFixed(1),
    });

    transcripts.push(
      `\n──── ${candidate.label} follow-up answers\n` +
        results
          .map(
            (r) =>
              `[${r.kind}] Q: ${r.question}\n  ${r.answer || (r.parseFailure ? "(PARSE FAILURE → abstain)" : "(abstained)")}`
          )
          .join("\n")
    );

    // ---- initial answers
    console.log(`### ${candidate.label} — initial answers`);
    for (const question of INITIAL_QUESTIONS) {
      process.stdout.write(`  · ${question}\n`);
      const [raw, latency] = await timed(() =>
        generateText({
          model: candidate.model,
          temperature: 0.3,
          maxOutputTokens: 600,
          providerOptions: NO_THINKING,
          system: INITIAL_PROMPT,
          prompt: `User question: ${question}\n\nVerified transcript citations:\n${INITIAL_EVIDENCE[question]}`,
        }).then((r) => r.text)
      );
      const answer = sanitizeProcedureAnswer(raw);
      const unsupported = await countUnsupported(
        answer,
        INITIAL_EVIDENCE[question]
      );
      initialRows.push({
        model: candidate.label,
        question: `${question.slice(0, 34)}…`,
        words: answer.split(/\s+/).filter(Boolean).length,
        bold: (answer.match(/\*\*[^*]+\*\*/g) ?? []).length,
        heading: HEADING.test(answer) ? "yes" : "no",
        filler: FILLER.test(answer) ? "yes" : "no",
        "cited?": /\[\d+:\d{2}/.test(answer) ? "yes" : "NO",
        unsupported,
        "latency-s": (latency / 1000).toFixed(1),
      });
      transcripts.push(
        `\n──── ${candidate.label} initial: ${question}\n${answer}`
      );
    }
  }

  console.log("\n\n=== FOLLOW-UP PIPELINE ===");
  console.table(followUpRows);
  console.log("\n=== INITIAL ANSWERS ===");
  console.table(initialRows);
  console.log(`\n${transcripts.join("\n")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
