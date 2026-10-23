/** Real model + actual retrieval; no gold labels sent to inference. Opt in with --live.
 * Run from frontend: pnpm exec tsx tests/eval/dataset-pipeline-eval.ts --live --limit 7
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import {
  generateVerifiedFollowUp,
  toVerifiedProcedureOutput,
} from "../../lib/ai/medical-follow-up";
import { questionIntent } from "../../lib/ai/question-intent";
import { fetchMedixJson } from "../../lib/ai/tools/medix-api-client";
import type { ProcedureResponse } from "../../lib/ai/tools/search-procedure";
import { toProcedureToolOutput } from "../../lib/ai/tools/search-procedure";
import {
  measureAsync,
  PerformanceTrace,
  performanceCount,
  persistPerformance,
  runWithPerformance,
} from "../../lib/performance";

async function main() {
  if (!process.argv.includes("--live")) {
    throw new Error(
      "Pass --live to run actual retrieval and paid/provider model calls."
    );
  }
  config({ path: ".env.local" });
  config({ path: "../backend/.env" });
  const { getFollowUpModel } = await import("../../lib/ai/providers");
  const model = getFollowUpModel();
  const manifest = JSON.parse(
    readFileSync(
      "../development/evaluation/dataset_response_cases.json",
      "utf8"
    )
  );
  const i = process.argv.indexOf("--limit"),
    limit = i < 0 ? 7 : Number(process.argv[i + 1]);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be positive");
  }
  const folder = path.resolve("../data/performance");
  mkdirSync(folder, { recursive: true });
  const cacheIndex = process.argv.indexOf("--cached-evidence");
  const cached =
    cacheIndex < 0
      ? null
      : JSON.parse(readFileSync(process.argv[cacheIndex + 1], "utf8"));
  const results: Record<string, unknown>[] = [];
  const idsIndex = process.argv.indexOf("--ids");
  const ids =
    idsIndex < 0 ? null : new Set(process.argv[idsIndex + 1].split(","));
  const cases = manifest.cases
    .filter((c: { id: string }) => !ids || ids.has(c.id))
    .slice(0, limit);
  if (!cases.length) {
    throw new Error("No matching case IDs");
  }
  for (const c of cases) {
    const t = new PerformanceTrace();
    t.route = cached ? "offline.cached_evidence" : "offline";
    const start = performance.now();
    let status = "ok";
    try {
      await runWithPerformance(t, async () => {
        performanceCount("mode.text");
        performanceCount("benchmark.dataset");
        const source =
          cached ??
          toProcedureToolOutput(
            await fetchMedixJson<ProcedureResponse>("/api/query", {
              body: JSON.stringify({ query: c.question }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            }),
            c.question
          );
        const answer = await measureAsync("response.composition", () =>
          generateVerifiedFollowUp({
            activeEvidence: source,
            initialAnswer: true,
            model,
            question: c.question,
            recentConversation: "",
          })
        );
        const displayed = toVerifiedProcedureOutput(source, answer);
        results.push({
          ...c,
          answer: answer.answer,
          intent: questionIntent(c.question),
          medicalSources: answer.medicalSources,
          moments: displayed.citations,
          request_id: t.request_id,
          review: {
            addresses_requested_intent: null,
            causal_support_if_why: null,
            citation_faithfulness: null,
            clinical_accuracy: null,
            notes:
              "Human review required; verified is the pipeline decision, not independent clinical accuracy.",
          },
          sufficiency: answer.evidenceSufficiency,
          verified: answer.verified,
          video: displayed.videoId,
          wall_ms: performance.now() - start,
        });
      });
    } catch {
      status = "error";
      results.push({
        ...c,
        request_id: t.request_id,
        status: "error",
        wall_ms: performance.now() - start,
      });
    } finally {
      await persistPerformance(t, status, status === "ok" ? 200 : 500);
    }
    console.log(
      JSON.stringify({
        case_id: c.id,
        elapsed_ms: performance.now() - start,
        request_id: t.request_id,
        status,
      })
    );
  }
  const output = path.join(folder, `dataset-eval-${Date.now()}.json`);
  writeFileSync(
    output,
    JSON.stringify(
      {
        method:
          "Dataset-question response evaluation; data-derived questions only, no gold video/time in inference. Server composition benchmark, not browser/DB/stream transport measurement. No baseline or clinical accuracy claimed.",
        results,
        scope: cached
          ? "Actual model composition using a saved retrieval response; retrieval, routing, DB and browser NOT measured."
          : "Actual backend HTTP retrieval plus model composition; routing, DB and browser NOT measured.",
      },
      null,
      2
    )
  );
  console.log(output);
}
main().catch(() => {
  console.error(
    "Evaluation failed; check service availability and provider configuration."
  );
  process.exitCode = 1;
});
