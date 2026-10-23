/** Run from frontend: pnpm exec tsx tests/eval/response-quality-eval.ts <unique-run-label>
 * The label does not restore old code. Capture a baseline before edits and use a new label
 * after edits. Fixed-evidence composition only, not retrieval/vision/browser latency or
 * clinical validation. Saved outputs contain test prompts and model answers, never secrets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { PerformanceTrace, runWithPerformance } from "../../lib/performance";

async function main() {
  config({ path: ".env.local" });
  config({ path: "../backend/.env" });
  const { getFollowUpModel } = await import("../../lib/ai/providers");
  const { generateVerifiedFollowUp } = await import(
    "../../lib/ai/medical-follow-up"
  );
  const model = getFollowUpModel();
  const arm = process.argv[2] || "current";
  if (!/^[a-z0-9-]+$/.test(arm)) {
    throw new Error("Use a simple run label");
  }
  const resultPath = `../development/evaluation/results/response-quality-${arm}.json`;
  const modelPath = `../development/evaluation/results/response-quality-${arm}-model.json`;
  if (existsSync(resultPath) || existsSync(modelPath)) {
    throw new Error("Choose a new label to preserve previous runs");
  }
  mkdirSync("../development/evaluation/results", { recursive: true });
  const cues = JSON.parse(
    readFileSync("../data/transcript_cache/NxO5LvgqZe0.json", "utf8")
  )
    .filter((c: any) => c.start >= 90 && c.start + c.duration <= 181.55)
    .map((c: any, i: number) => ({
      clip_end_seconds: c.start + c.duration - 90,
      clip_start_seconds: c.start - 90,
      cue_id: `T${String(i + 1).padStart(3, "0")}`,
      end_seconds: c.start + c.duration,
      start_seconds: c.start,
      text: c.text,
    }));
  const source = {
    answerable: true,
    citations: cues,
    evidenceBundleId: "quality-eval",
    evidenceContext: cues,
    renderMediaWorkspace: true,
    retrievalQuery: "How do I check whether an arm bandage is too tight?",
    safetyDisposition: "supported",
    sourceRetrievalQuery: "How do I check whether an arm bandage is too tight?",
    status: "answered",
    videoId: "NxO5LvgqZe0",
  };
  const prior =
    "user: I just put a bandage on someone's arm. How can I tell if it's too tight?\nassistant: Press their nail or skin beyond the bandage for five seconds, release, and watch for colour returning within two seconds. Loosen the bandage if the colour is slow to return. Watch for cold, blue or numb fingers.";
  const availableCases = [
    {
      id: "initial-bandage",
      initialAnswer: true,
      question:
        "I just put a bandage on someone's arm. How can I tell if it's too tight?",
      recentConversation: "",
      source,
    },
    {
      id: "next-action",
      initialAnswer: false,
      question: "What if the colour doesn't come back quickly?",
      recentConversation: prior,
      source,
    },
    {
      id: "why",
      initialAnswer: false,
      question: "Why should I leave their fingers uncovered?",
      recentConversation: prior,
      source,
    },
    {
      id: "thermal-burn",
      initialAnswer: true,
      question: "I spilled hot tea on my hand. What should I do first?",
      recentConversation: "",
      source: {
        ...source,
        citations: [],
        evidenceContext: [],
        renderMediaWorkspace: false,
        retrievalQuery: "Thermal burn first aid",
        sourceRetrievalQuery: "Thermal burn first aid",
        videoId: undefined,
      },
    },
  ];
  const requestedCases = process.argv.slice(3);
  if (requestedCases.some((id) => !availableCases.some((c) => c.id === id))) {
    throw new Error("Unknown case ID");
  }
  const cases = requestedCases.length
    ? availableCases.filter((c) => requestedCases.includes(c.id))
    : availableCases;
  const outputs: any[] = [];
  const original = (model as any).doGenerate.bind(model);
  (model as any).doGenerate = async (opts: any) => {
    const r = await original(opts);
    outputs.push({
      case: cases[results.length]?.id,
      content: r.content.filter((p: any) => p.type === "text"),
      phase: JSON.stringify(opts.prompt).includes("You select evidence")
        ? "select"
        : JSON.stringify(opts.prompt).includes("You verify")
          ? "verify"
          : "generate",
    });
    return r;
  };
  const results: any[] = [];
  for (const c of cases) {
    console.log(JSON.stringify({ arm, case: c.id, state: "start" }));
    const start = performance.now();
    const trace = new PerformanceTrace();
    const r = await runWithPerformance(trace, () =>
      generateVerifiedFollowUp({
        activeEvidence: c.source as any,
        initialAnswer: c.initialAnswer,
        model,
        question: c.question,
        recentConversation: c.recentConversation,
      })
    );
    results.push({
      answer: r.answer,
      cues: r.citedCues,
      id: c.id,
      question: c.question,
      seconds: (performance.now() - start) / 1000,
      sources: r.medicalSources,
      sufficiency: r.evidenceSufficiency,
      timing: trace.snapshot(),
      verified: r.verified,
    });
    writeFileSync(
      resultPath,
      JSON.stringify(
        {
          results,
          scope:
            "Fixed cached evidence + identical fixed prior history; four targeted cases, one sample per case. No retrieval, UI or independent clinical evaluation.",
        },
        null,
        2
      )
    );
    writeFileSync(modelPath, JSON.stringify(outputs, null, 2));
    console.log(
      JSON.stringify({
        arm,
        case: c.id,
        seconds: results.at(-1).seconds,
        state: "done",
        sufficiency: r.evidenceSufficiency,
      })
    );
  }
}
main().catch(() => {
  console.error("Evaluation failed. Credentials suppressed.");
  process.exitCode = 1;
});
