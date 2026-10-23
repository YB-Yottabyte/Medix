import examples from "./dataset-question-examples.json";
export type QuestionIntent =
  | "rationale"
  | "contingency"
  | "escalation"
  | "quantity"
  | "recognition"
  | "procedure";
/** Determines answer shape, never supplies facts or selects a gold video/interval. */
export function questionIntent(question: string): QuestionIntent {
  if (
    /\bwhy\b|\b(?:what is|what's|what’s) the (?:reason|purpose)|\bhow (?:does|do) .{0,100}\b(?:help|work)\b/i.test(
      question
    )
  ) {
    return "rationale";
  }
  if (
    /\bwhat if\b|\bwhat (?:to|should .{0,20}) do (?:if|when)\b|\bdoesn.t\b|\bdoes not\b|\bstill\b/i.test(
      question
    )
  ) {
    return "contingency";
  }
  if (
    /\b(?:when|identify when)\b.{0,80}\b(?:help|doctor|attention|emergency|call)\b/i.test(
      question
    )
  ) {
    return "escalation";
  }
  if (/\bhow (?:long|many|much|often)\b/i.test(question)) {
    return "quantity";
  }
  if (
    /\b(?:symptoms?|signs?)\b|\bhow (?:(?:can|do|should|would) (?:i|we|you) |to )?(?:check|identify|recognize|tell|know)\b/i.test(
      question
    )
  ) {
    return "recognition";
  }
  return "procedure";
}
const guidance: Record<QuestionIntent, string> = {
  contingency:
    "Answer the next action after this result or problem, then reassessment and escalation only when supported and applicable. Do not merely repeat an earlier threshold.",
  escalation:
    "Answer the supported conditions for seeking help and their urgency, without unrelated procedure steps.",
  procedure:
    "Give a direct answer and the necessary supported steps in order; preserve conditions and stop rules.",
  quantity:
    "Give the requested duration, amount or frequency with its action and conditions; do not invent missing measurements.",
  rationale:
    "Answer WHY first with a supported reason, purpose or mechanism. An instruction alone does not explain a reason. Only assert causal links explicit in cited evidence; do not infer a cause from adjacent actions. If the reason is absent, say so naturally rather than replacing it with steps or inventing physiology.",
  recognition:
    "Explain the supported observation or check and how to interpret it, without making an individual diagnosis. Start with the check the person can perform now. Put any relevant routine monitoring after the check and result; do not open with a recurring schedule.",
};
export function questionIntentGuidance(question: string) {
  return `Question intent: ${questionIntent(question)}. ${guidance[questionIntent(question)]}`;
}
export const DATASET_INTENT_EXAMPLES = `Training-set QUESTION examples, not medical evidence or answer templates:\n${examples.examples.map((e) => `${JSON.stringify(e.question)} -> ${e.intent}`).join("\n")}\nA derived follow-up such as "Why is that step needed?" asks for a supported rationale, not another list of steps. This is not an original dataset question. Never copy a medical answer from these examples.`;

/** Only relevant training examples accompany an answer; unrelated example topics
 * can distract generation even when labelled as non-evidence. */
export function datasetIntentExamples(question: string): string {
  const intent = questionIntent(question);
  const relevant = examples.examples
    .filter((example) => example.intent === intent)
    .slice(0, 2);
  return relevant.length
    ? `Training-set QUESTION examples for this intent only (not medical evidence or answer templates):\n${relevant.map((example) => `${JSON.stringify(example.question)} -> ${example.intent}`).join("\n")}`
    : "";
}
