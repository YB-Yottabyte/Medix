/** Live before/after evaluation with the SAME cached transcripts and verifier.
 * Baseline changes only the generator instructions to the former transcript-only,
 * three-claim style. Results measure observable checks, not clinician-rated accuracy.
 * Run: pnpm exec tsx tests/eval/medical-response-eval.ts --live
 * Credentials are read privately from the existing environment files.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { generateVerifiedFollowUp } from "../../lib/ai/medical-follow-up";
import type { ProcedureToolOutput } from "../../lib/ai/tools/search-procedure";

const BASELINE =
  "Answer the medical question using ONLY the video T transcript cues. Ignore K medical references. Return JSON only with claims (text and cueIds), unsupportedAspect and followUpQuestion:null. Use at most three short claims and 90 words. Include only explicit details, do not add model-memory medical advice. Each claim must be entailed by its exact T citation IDs. No URLs or timestamps in text.";
const cases = [
  {
    checks: {
      escalation: /emergency|urgent|seek/i,
      interpretation: /2|two/i,
      method: /5|five/i,
      nextAction: /loosen|reapply/i,
    },
    end: 181.54,
    id: "bandage",
    question:
      "I just put this bandage on someone's arm. How do I know if it's too tight?",
    start: 90,
    video: "NxO5LvgqZe0",
  },
  {
    checks: {
      avoidHarm: /(?:do not|don't|avoid).*(?:butter|cream|oil|blister)/is,
      cooling: /water|cool/i,
      escalation: /emergency|urgent|large|deep/i,
      timing: /20|twenty/i,
    },
    end: 97,
    id: "thermal-burn",
    question:
      "I burned my arm on a hot pan. What should I do now, and when would I need medical help?",
    start: 0,
    video: "O1kiguGUt3o",
  },
  {
    checks: {
      escalation: /emergency|urgent|emergency services|A&E/i,
      noUnsupportedDiagnosis:
        /^(?!.*(?:you have a fracture|blood flow is blocked|nerves are damaged)).*$/is,
    },
    end: 181.54,
    id: "injury-red-flags",
    question:
      "I injured my wrist and now my fingers are numb and cold. What should I do?",
    start: 90,
    video: "NxO5LvgqZe0",
  },
  {
    checks: {
      noUnrelatedBandageAdvice: /^(?!.*(?:bandage|circulation|loosen)).*$/is,
      waterType: /distilled|previously boiled/i,
    },
    end: 77,
    id: "sinus-rinse",
    question:
      "In the sinus-rinse demonstration, what type of water goes in the bottle? Keep it brief.",
    start: 0,
    video: "E92qqAftUak",
  },
];

function evidence(item: (typeof cases)[number]): ProcedureToolOutput {
  const transcript = JSON.parse(
    readFileSync(
      path.resolve("../data/transcript_cache", `${item.video}.json`),
      "utf8"
    )
  ) as { start: number; duration: number; text: string }[];
  const cues = transcript
    .filter(
      (cue) =>
        cue.start >= item.start && cue.start + cue.duration <= item.end + 0.01
    )
    .map((cue, index) => ({
      clip_end_seconds: cue.start + cue.duration - item.start,
      clip_start_seconds: cue.start - item.start,
      cue_id: `T${String(index + 1).padStart(3, "0")}`,
      end_seconds: cue.start + cue.duration,
      start_seconds: cue.start,
      text: cue.text,
    }));
  return {
    answerable: true,
    citations: cues,
    evidenceBundleId: `eval-${item.id}`,
    evidenceContext: cues,
    renderMediaWorkspace: true,
    retrievalQuery: item.question,
    safetyDisposition: "supported",
    sourceRetrievalQuery: item.question,
    status: "answered",
    videoId: item.video,
  } as unknown as ProcedureToolOutput;
}

async function main() {
  if (!process.argv.includes("--live")) {
    throw new Error(
      "Pass --live to run the explicitly requested model evaluation."
    );
  }
  config({ path: ".env.local" });
  config({ path: "../backend/.env" });
  if (!process.env.ASU_RC_API_KEY) {
    throw new Error("ASU_RC_API_KEY is required for the live evaluation.");
  }
  const { getFollowUpModel } = await import("../../lib/ai/providers");
  const model = getFollowUpModel();
  const baselineModel = new Proxy(model, {
    get(target, prop) {
      if (prop === "doGenerate") {
        return (options: Parameters<typeof target.doGenerate>[0]) => {
          const system = options.prompt.find(
            (message) => message.role === "system"
          );
          const isGeneration = system?.content.includes(
            "You are Medix, answering a medical question"
          );
          return target.doGenerate(
            isGeneration
              ? {
                  ...options,
                  prompt: options.prompt.map((message) =>
                    message.role === "system"
                      ? { ...message, content: BASELINE }
                      : message
                  ),
                }
              : options
          );
        };
      }
      return Reflect.get(target, prop);
    },
  });
  const results: unknown[] = [];
  const selectedIds = process.env.MEDIX_EVAL_CASES?.split(",");
  for (const item of cases.filter(
    (item) => !selectedIds || selectedIds.includes(item.id)
  )) {
    const runs = await Promise.all(
      [false, true].map(async (improved) => {
        const started = Date.now();
        const result = await generateVerifiedFollowUp({
          activeEvidence: evidence(item),
          initialAnswer: true,
          model: improved ? model : baselineModel,
          question: item.question,
          recentConversation: "",
        });
        const renderedWords = result.answer
          .replace(/\[[^\]]+\]\([^)]+\)|\[[\d:–-]+\]/g, "")
          .split(/\s+/)
          .filter(Boolean);
        const linkedUrls = [
          ...result.answer.matchAll(/\]\((https?:[^)]+)\)/g),
        ].map((match) => match[1]);
        const knownUrls = new Set(
          result.medicalSources?.map((source) => source.url) ?? []
        );
        return {
          answer: result.answer,
          arm: improved ? "improved" : "baseline",
          checks: Object.fromEntries(
            Object.entries(item.checks).map(([name, pattern]) => [
              name,
              pattern.test(result.answer),
            ])
          ),
          citationIntegrity: {
            sourceLinksAllowlisted: linkedUrls.every((url) =>
              knownUrls.has(url)
            ),
            timestampCount: [
              ...result.answer.matchAll(/\[\d+:\d{2}[–-]\d+:\d{2}\]/g),
            ].length,
          },
          clinicalAccuracyReviewed: false,
          evidenceSufficiency: result.evidenceSufficiency,
          medicalSources: result.medicalSources ?? [],
          readability: {
            cannedOpening: /^(?:Of course|Here.s how)/i.test(result.answer),
            words: renderedWords.length,
          },
          seconds: (Date.now() - started) / 1000,
          verified: result.verified,
          videoCitations: result.citedCues.length,
          words: result.answer.split(/\s+/).length,
        };
      })
    );
    results.push({
      id: item.id,
      question: item.question,
      runs,
      video: item.video,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  const output =
    process.env.MEDIX_EVAL_OUTPUT ?? "/tmp/medix-response-evaluation.json";
  writeFileSync(
    output,
    JSON.stringify(
      {
        evaluatedAt: new Date().toISOString(),
        method:
          "Fixed actual cached video transcripts, identical verifier, baseline generation prompt versus improved generation with checked reference evidence. Not an end-to-end retrieval or clinical accuracy evaluation.",
        results,
      },
      null,
      2
    )
  );
  console.log(`Saved evaluation: ${output}`);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evaluation failed");
  process.exitCode = 1;
});
