import { generateText, type LanguageModel } from "ai";
import type { ChatMessage } from "@/lib/types";
import { getTextFromMessage } from "@/lib/utils";
import { getTitleModel } from "./providers";
import type { ProcedureToolOutput } from "./tools/search-procedure";

const MAX_HISTORY_CHARACTERS = 3000;
const FOLLOW_UP_PATTERN =
  /\b(it|its|that|this|those|them|there|then|next|again|before|afterward|continue|instead|same|still|more|less|longer|tighter|deeper)\b|^(what|how|when|where|why)\s+(next|about|long|often|many|much)\b/i;
const EXPLICIT_TOPIC_CHANGE_PATTERN =
  /\b(?:new|different|unrelated)\s+(?:question|topic|procedure)\b|\b(?:change|switch)\s+(?:the\s+)?(?:topic|procedure)\b/i;
// An explicit request for a different source is the only same-topic case that
// may leave the active EvidenceBundle.
const EXPLICIT_NEW_SOURCE_PATTERN =
  /\b(?:another|different|other|second|new)\s+(?:\w+\s+){0,2}?(?:video|source|clip|reference)\b|\bsearch\s+(?:the\s+)?(?:supported\s+)?(?:video\s+)?collection\b|\b(?:search|find|look\s+(?:for|up)|show\s+me|get\s+me)\b[^.?!]{0,40}\b(?:another|different|other|new)\b/i;
const STANDALONE_PROCEDURE_PATTERN =
  /^(?:now[,\s]+)?(?:how\s+(?:do|can|should)\s+(?:i|we|you)|how\s+to|what\s+(?:are|is)\s+(?:the\s+)?(?:steps|signs|symptoms)|what\s+should\s+(?:i|we)\s+do\s+(?:for|if|when)|tell\s+me\s+(?:how|about)|explain\s+how|(?:i\s+)?need\s+help\s+with|help\s+me\s+with)\b/i;
const NAMED_PROCEDURE_PATTERN =
  /\b(cpr|cardiopulmonary|aed|defibrillator|choking|heimlich|seizure|burns?|wounds?|bleeding|tourniquet|stroke|heart attack|fractures?|splints?|poisoning|overdose)\b/gi;

export type RetrievalDecision =
  | "continue_current_evidence"
  | "retrieve_new_source";

export type ConversationContext = {
  activeProcedure: string | null;
  activeEvidence: ProcedureToolOutput | null;
  previousUserQuestion: string | null;
  recentTranscript: string;
};

function readProcedureOutput(message: ChatMessage): ProcedureToolOutput | null {
  for (const part of [...message.parts].reverse()) {
    if (part.type !== "tool-searchProcedure" || !("output" in part)) {
      continue;
    }

    const output = part.output as
      | (Partial<ProcedureToolOutput> & {
          status?: "answered" | "abstained";
        })
      | undefined;
    if (
      output &&
      (output.status === "answered" || output.status === "abstained")
    ) {
      const retrievalQuery = output.retrievalQuery ?? "";
      return {
        ...output,
        citations: output.citations ?? [],
        evidenceContext: output.evidenceContext ?? output.citations ?? [],
        retrievalQuery,
        sourceRetrievalQuery:
          output.sourceRetrievalQuery ?? retrievalQuery,
        retrievalDecision:
          output.retrievalDecision ?? "retrieve_new_source",
        followUpQuestion: output.followUpQuestion ?? null,
      } as ProcedureToolOutput;
    }
  }

  return null;
}

export function buildConversationContext(
  history: ChatMessage[]
): ConversationContext {
  let activeProcedure: string | null = null;
  let activeEvidence: ProcedureToolOutput | null = null;
  let previousUserQuestion: string | null = null;
  const transcript: string[] = [];

  for (const message of history.slice(-8)) {
    const text = getTextFromMessage(message).trim();
    if (text) {
      transcript.push(`${message.role}: ${text}`);
      if (message.role === "user") {
        previousUserQuestion = text;
      }
    }

  }

  // Follow-up messages intentionally do not repeat a tool result or media
  // workspace. Search backward for the latest evidence decision so the active
  // source remains available across an arbitrarily long follow-up exchange.
  for (const message of [...history].reverse()) {
    const procedureOutput = readProcedureOutput(message);
    if (!procedureOutput) {
      continue;
    }
    const reusable =
      procedureOutput.status === "answered" &&
      Boolean(procedureOutput.videoId) &&
      Boolean(procedureOutput.evidenceBundleId) &&
      procedureOutput.evidenceContext.length > 0;
    if (reusable) {
      activeEvidence = procedureOutput;
      activeProcedure =
        procedureOutput.sourceRetrievalQuery ||
        procedureOutput.retrievalQuery ||
        procedureOutput.matchedProcedure;
    }
    // An abstention or incomplete newer search intentionally clears an older
    // topic instead of silently reviving stale evidence.
    break;
  }

  if (activeProcedure) {
    transcript.push(`active procedure: ${activeProcedure}`);
  }

  return {
    activeProcedure,
    activeEvidence,
    previousUserQuestion,
    recentTranscript: transcript.join("\n").slice(-MAX_HISTORY_CHARACTERS),
  };
}

export function isContextDependentQuestion(question: string): boolean {
  const normalized = question.trim();
  return normalized.length > 0 && FOLLOW_UP_PATTERN.test(normalized);
}

export function decideRetrieval(
  question: string,
  context: ConversationContext
): RetrievalDecision {
  const normalized = question.trim();
  if (!context.activeEvidence) {
    return "retrieve_new_source";
  }
  if (
    EXPLICIT_TOPIC_CHANGE_PATTERN.test(normalized) ||
    EXPLICIT_NEW_SOURCE_PATTERN.test(normalized)
  ) {
    return "retrieve_new_source";
  }
  const currentEvidenceText = [
    context.activeProcedure ?? "",
    ...context.activeEvidence.evidenceContext.map((cue) => cue.text),
  ].join(" ");
  const activeTopics = namedProcedureTopics(currentEvidenceText);
  const requestedTopics = namedProcedureTopics(normalized);
  if ([...requestedTopics].some((topic) => !activeTopics.has(topic))) {
    return "retrieve_new_source";
  }
  if (isContextDependentQuestion(normalized)) {
    return "continue_current_evidence";
  }
  if (STANDALONE_PROCEDURE_PATTERN.test(normalized)) {
    return "retrieve_new_source";
  }
  // With active evidence, continuity is the safe default. The response model
  // can escalate after inspecting the current transcript, but a vague or
  // elliptical turn must never silently replace the selected video.
  return "continue_current_evidence";
}

function namedProcedureTopics(text: string): Set<string> {
  return new Set(
    [...text.matchAll(NAMED_PROCEDURE_PATTERN)].map((match) =>
      canonicalProcedureTopic((match[1] ?? "").toLowerCase())
    )
  );
}

function canonicalProcedureTopic(topic: string): string {
  if (topic === "cardiopulmonary") {
    return "cpr";
  }
  if (topic === "heimlich") {
    return "choking";
  }
  if (topic === "defibrillator") {
    return "aed";
  }
  if (/^(burn|wound|fracture|splint)s$/.test(topic)) {
    return topic.slice(0, -1);
  }
  return topic;
}

function fallbackQuery(question: string, context: ConversationContext): string {
  const topic = context.activeProcedure ?? context.previousUserQuestion;
  return topic ? `${topic}. Follow-up question: ${question}` : question;
}

function cleanRewrittenQuery(text: string): string {
  return text
    .replace(/^(standalone (search )?query|query)\s*:\s*/i, "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
}

export async function contextualizeMedicalQuery({
  history,
  latestQuestion,
  rewriteModel,
}: {
  history: ChatMessage[];
  latestQuestion: string;
  rewriteModel?: LanguageModel;
}): Promise<{
  query: string;
  wasContextualized: boolean;
  context: ConversationContext;
  retrievalDecision: RetrievalDecision;
}> {
  const question = latestQuestion.trim();
  const context = buildConversationContext(history);
  const retrievalDecision = decideRetrieval(question, context);

  if (retrievalDecision === "continue_current_evidence") {
    return {
      query: fallbackQuery(question, context),
      wasContextualized: true,
      context,
      retrievalDecision,
    };
  }

  if (
    !question ||
    !isContextDependentQuestion(question) ||
    !context.recentTranscript
  ) {
    return {
      query: question,
      wasContextualized: false,
      context,
      retrievalDecision,
    };
  }

  try {
    const { text } = await generateText({
      model: rewriteModel ?? getTitleModel(),
      system: `Summarize the medical-procedure conversation as one standalone retrieval query.
Preserve the active procedure, body part, current stage, and latest information need.
Use only facts and procedure names present in the conversation.
Do not answer the question, add medical advice, or invent details.
Return only the retrieval query.`,
      prompt: `Conversation:
${context.recentTranscript}

Latest question: ${question}`,
      temperature: 0,
      maxOutputTokens: 80,
    });
    const rewritten = cleanRewrittenQuery(text);

    if (rewritten.length >= 3) {
      return {
        query: rewritten,
        wasContextualized: true,
        context,
        retrievalDecision,
      };
    }
  } catch (error) {
    console.warn("Could not contextualize retrieval query:", error);
  }

  return {
    query: fallbackQuery(question, context),
    wasContextualized: true,
    context,
    retrievalDecision,
  };
}
