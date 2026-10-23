/** Actual multi-turn replay. Capture "before" against the historical implementation,
 * then replay "after" against the same saved evidence. The arm name itself does
 * not restore historical code. Keep baseline reports immutable for comparisons.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import {
  generateVerifiedFollowUp,
  toVerifiedProcedureOutput,
} from "../../lib/ai/medical-follow-up";
import type { ProcedureToolOutput } from "../../lib/ai/tools/search-procedure";
import { toProcedureToolOutput } from "../../lib/ai/tools/search-procedure";

async function main() {
  config({ path: ".env.local" });
  config({ path: "../backend/.env" });
  const arm = process.env.MEDIX_EVAL_ARM ?? "after";
  const { getFollowUpModel } = await import("../../lib/ai/providers");
  const model = getFollowUpModel();
  const first =
    "I just put this bandage on someone's arm. How do I know if it's too tight?";
  const questions = [
    first,
    "How do I check their circulation?",
    "How long should I press their nail?",
    "What should I look for when I let go?",
    "What if the colour doesn't come back quickly?",
  ];
  const cache =
    process.env.MEDIX_EVAL_SOURCE ?? "/tmp/medix-conversation-source.json";
  let source: ProcedureToolOutput;
  if (arm === "before") {
    const response = await fetch("http://127.0.0.1:5001/api/query", {
      body: JSON.stringify({ query: first }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      throw new Error(`Backend ${response.status}: ${await response.text()}`);
    }
    source = toProcedureToolOutput(await response.json(), first);
    writeFileSync(cache, JSON.stringify(source, null, 2));
  } else {
    source = JSON.parse(readFileSync(cache, "utf8"));
  }
  const results: Record<string, unknown>[] = [];
  let history = "";
  for (const [index, question] of questions.entries()) {
    const start = Date.now();
    const result = await generateVerifiedFollowUp({
      activeEvidence: source,
      hasImage: index === 0,
      initialAnswer: index === 0,
      model,
      question,
      recentConversation: history,
    });
    const output = toVerifiedProcedureOutput(source, result);
    const displayed = output.citations.length
      ? output.citations
      : (output.relatedEvidence ?? []);
    results.push({
      answer: result.answer,
      checks: {
        escalation: /emergency|urgent/i.test(result.answer),
        interpretation: /(?:2|two) seconds/i.test(result.answer),
        method: /(?:5|five) seconds/i.test(result.answer),
        nextAction: /loosen|reapply/i.test(result.answer),
        noInternalLanguage:
          !/left out details|verified information|current video does not/i.test(
            result.answer
          ),
        noUnrelatedMoments: displayed.every((c) =>
          /circulation|nail|colou?r|bandage|dressing/i.test(c.text)
        ),
      },
      medicalSources: result.medicalSources,
      question,
      seconds: (Date.now() - start) / 1000,
      sufficiency: result.evidenceSufficiency,
      verified: result.verified,
      videoMoments: displayed.map((c) => ({
        end: c.end_seconds,
        start: c.start_seconds,
        text: c.text,
      })),
    });
    history += `\nuser: ${question}\nassistant: ${result.answer}`;
    console.log(JSON.stringify(results.at(-1)));
  }
  writeFileSync(
    process.env.MEDIX_EVAL_OUTPUT ?? `/tmp/medix-conversation-${arm}.json`,
    JSON.stringify(
      {
        arm,
        method:
          "Same actual backend retrieval response, real model, accumulated conversation. Checks are coverage probes, not clinical certification.",
        results,
        sourceEnd: source.endTime,
        sourceStart: source.startTime,
        sourceVideo: source.videoId,
      },
      null,
      2
    )
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
