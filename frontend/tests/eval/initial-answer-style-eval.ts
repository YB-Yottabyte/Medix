/**
 * Before/after evaluation of the initial-answer style rules (prompts.ts
 * `regularPrompt` + the tool's responseInstructions), run on local Qwen.
 *
 * The retrieval backend is not involved: a fixed synthetic searchProcedure
 * result stands in for it, so only the response-style instructions vary.
 * Metrics target the presentation requirements directly — no headings, no
 * closing filler, sparing bold, answer-first — plus the Med-PaLM 2 axes that
 * can be measured without clinicians (§3.5).
 *
 * Run: pnpm exec tsx tests/eval/initial-answer-style-eval.ts
 */
import { generateText } from "ai";
import { getFollowUpModel } from "../../lib/ai/providers";
import { sanitizeProcedureAnswer } from "../../lib/evidence-timestamps";

const LOCAL_MODEL_OPTIONS = { ollama: { reasoningEffort: "none" } } as const;
const model = getFollowUpModel();

const BEFORE_RULES = `Response rules:
- Write a cohesive GPT-style explanation rather than concatenating or lightly paraphrasing transcript snippets.
- Follow this compact structure: the separately rendered emergency warning, a clear procedure heading such as "Steps to pack a wound," and no more than four numbered actions.
- Each action must use one compact line in this form: "1. **Short action title** — Plain-language instruction. [0:16–0:31]"
- Include at most four evidence-supported steps. Combine closely related actions when needed; if the evidence supports fewer than four steps, do not invent extra steps.
- End every evidence-supported action with a clip-relative timestamp citation on the same line, formatted exactly like [0:16–0:31].
- End an answered procedure response with exactly: "Supporting video guidance is shown below."
- Preserve important warnings and stop conditions. Do not diagnose, prescribe, or invent medication dosages.`;

const AFTER_RULES = `Response rules:
- Answer the question the user actually asked, in your first sentence, in plain language. Do not open with a restatement, a preamble, or a title.
- Write like a knowledgeable clinician talking to someone in a chat, not like a report. No headings, no section titles such as "How to Perform CPR While Using an AED", no "Steps to..." line.
- Use a short numbered list only when the answer really is a sequence of actions, and at most four items. Otherwise answer in two or three sentences.
- Be useful and complete within the evidence: include the supported details that matter for doing this safely, and leave out anything the evidence does not establish.
- Do not paraphrase transcript lines one by one and do not use transcript-style wording. Explain the procedure as continuous guidance.
- Use bold at most once or twice, and only for a genuine warning or a critical action. Never bold a whole line as a title.
- End every evidence-supported action with a clip-relative timestamp citation on the same line, formatted exactly like [0:16–0:31].
- Do not end with a sign-off, a summary line, or filler such as "Supporting video guidance is shown below."
- If the evidence covers only part of the question, answer that part and say plainly what the video does not cover. Never fill the gap from general knowledge.
- Preserve important warnings and stop conditions. Do not diagnose, prescribe, or invent medication dosages.`;

const PREAMBLE = `You are Medix, a hands-free assistant for medical procedures and first aid.
The searchProcedure tool has already returned verified evidence. Write the user-facing answer now.
Use only the supplied transcript citations for procedural claims. Never print cue IDs.`;

type Scenario = { question: string; evidence: string };

const SCENARIOS: Scenario[] = [
  {
    question: "How do I use an AED on someone who has collapsed?",
    evidence: `[0:24–0:31] Once the AED arrives, turn it on and it will talk you through every step.
[0:31–0:36] Attach the AED pads to the patient's bare chest, one below the right collarbone and one on the left side below the armpit.
[0:36–0:43] Keep doing chest compressions the whole time the second rescuer is preparing the AED.
[0:43–0:49] When the machine says stand clear, make sure nobody is touching the patient before the shock is delivered.
[0:49–0:56] Straight after the shock, go back to chest compressions without waiting.`,
  },
  {
    question: "How should I pack a bleeding wound?",
    evidence: `[0:16–0:31] If direct pressure does not stop the bleeding, move to packing the wound with gauze.
[0:31–0:44] Push the gauze right down into the wound, as deep as it will go.
[0:44–0:58] Keep packing until you cannot fit any more gauze in.
[0:58–1:10] Then press down hard on top of the packed wound with both hands.`,
  },
  {
    question: "What should I do if someone is choking?",
    evidence: `[0:12–0:20] Ask them if they are choking and encourage them to cough it out.
[0:20–0:33] If they cannot cough, give five sharp back blows between the shoulder blades.
[0:33–0:47] If that does not clear it, give five abdominal thrusts.`,
  },
  {
    question: "Can I keep the tourniquet on until the ambulance arrives?",
    evidence: `[1:02–1:14] Once the tourniquet is tightened, do not loosen it.
[1:14–1:25] Write down the time you applied it.`,
  },
];

async function answer(rules: string, scenario: Scenario) {
  const { text } = await generateText({
    model,
    temperature: 0.3,
    maxOutputTokens: 600,
    providerOptions: LOCAL_MODEL_OPTIONS,
    system: `${PREAMBLE}\n\n${rules}`,
    prompt: `User question: ${scenario.question}\n\nVerified transcript citations:\n${scenario.evidence}`,
  });
  // Answers pass through the same sanitizer the app applies before display.
  return sanitizeProcedureAnswer(text);
}

const HEADING = /(^|\n)\s*#{1,6}\s+\S|(^|\n)\s*\*\*[^*\n]{6,}\*\*\s*$/m;
const TITLE_LINE = /\b(?:how to (?:perform|use|pack|treat)|steps to)\b/i;
const FILLER =
  /supporting video guidance is shown below|hope this helps|let me know if|in summary|to summari[sz]e/i;
const PREAMBLE_OPENER =
  /^(?:here(?:'s| is)|the video (?:shows|explains)|according to|based on the|this (?:video|procedure)|to answer)/i;

function boldCount(text: string) {
  return (text.match(/\*\*[^*]+\*\*/g) ?? []).length;
}

function firstSentence(text: string) {
  return (
    text
      .replace(/\[[^\]]*\]/g, "")
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? ""
  );
}

function summarize(label: string, answers: string[]) {
  const rate = (predicate: (a: string) => boolean) =>
    (answers.filter(predicate).length / answers.length) * 100;
  return {
    arm: label,
    "heading%": rate((a) => HEADING.test(a)).toFixed(0),
    "title-phrase%": rate((a) => TITLE_LINE.test(a)).toFixed(0),
    "filler%": rate((a) => FILLER.test(a)).toFixed(0),
    "preamble-open%": rate((a) =>
      PREAMBLE_OPENER.test(firstSentence(a))
    ).toFixed(0),
    "mean-bold": (
      answers.reduce((sum, a) => sum + boldCount(a), 0) / answers.length
    ).toFixed(1),
    "mean-words": (
      answers.reduce(
        (sum, a) => sum + a.split(/\s+/).filter(Boolean).length,
        0
      ) / answers.length
    ).toFixed(0),
  };
}

async function main() {
  const before: string[] = [];
  const after: string[] = [];

  for (const scenario of SCENARIOS) {
    process.stdout.write(`· ${scenario.question}\n`);
    before.push(await answer(BEFORE_RULES, scenario));
    after.push(await answer(AFTER_RULES, scenario));
  }

  console.log(
    "\n=== Initial-answer presentation metrics (lower is better) ==="
  );
  console.table([summarize("before", before), summarize("after", after)]);

  for (let i = 0; i < SCENARIOS.length; i++) {
    console.log(`\n──────── ${SCENARIOS[i].question}`);
    console.log(`\n[BEFORE]\n${before[i]}`);
    console.log(`\n[AFTER]\n${after[i]}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
