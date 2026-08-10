import { generateText, type LanguageModel } from "ai";
import { isSmallTalk } from "./small-talk";
import type {
  ProcedureToolOutput,
  TranscriptCitation,
} from "./tools/search-procedure";

export type MedicalQueryTaxonomy =
  | "answerable"
  | "helpful_deferral"
  | "nonanswerable"
  // A turn that needs no factual grounding at all: SELF-multi-RAG's
  // [No Retrieve] class (Roy et al., 2024, §3.2).
  | "conversational";

export type EvidenceSufficiency = "sufficient" | "partial" | "insufficient";

export type FollowUpAssessment = {
  taxonomy: MedicalQueryTaxonomy;
  evidenceSufficiency: EvidenceSufficiency;
  reason: string;
};

/** A transcript segment behind a rendered claim, for the provenance panel. */
export type CitedCue = {
  text: string;
  startSeconds: number;
  endSeconds: number;
};

export type VerifiedFollowUp = FollowUpAssessment & {
  answer: string;
  verified: boolean;
  relation: FollowUpRelation;
  /** The cues the answer was built from. Empty for deferrals. */
  citedCues: CitedCue[];
};

const PERSONALIZED_OR_SAFETY_PATTERN =
  /\b(?:can|should|could)\s+i\b|\bwhat if\b|\bmy\b|\bhow long\b|\bis it safe\b/i;
const CONTEXTUAL_SEQUENCE_PATTERN =
  /^(?:and\s+)?(?:what (?:should i do )?next|what next|then what|what about after that)\??$/i;
const NONANSWERABLE_RISK_PATTERN =
  /\b(?:diagnos(?:e|is)|prescri(?:be|ption)|dosage|dose|which medication|what medication|stop taking|change my medication)\b/i;
const INTERNAL_METADATA_PATTERN =
  /\bT\d{3}\b|\bcues?\s+T?\d{3}\b|generation output failed|grounding validation|lexical support|evidence bundle|\b(?:cue|bundle)\s*ids?\b|supportingCueIds|relatedCueIds|retrievalDecision|searchProcedure|medix-evidence|evidenceBundleId/i;
const TIMESTAMP_PATTERN =
  /\[((?:\d+:)?\d{1,2}:\d{2})(?:\s*[–-]\s*((?:\d+:)?\d{1,2}:\d{2}))?\]/g;

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "can",
  "could",
  "did",
  "does",
  "doing",
  "exactly",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "its",
  "person",
  "should",
  "that",
  "the",
  "then",
  "this",
  "what",
  "when",
  "where",
  "while",
  "with",
  "would",
  "you",
  "your",
]);

const CONCEPT_CHECKS: Array<{
  question: RegExp;
  evidence: RegExp;
  label: string;
}> = [
  {
    question: /\bno shock advised\b/i,
    evidence: /\b(?:no shock (?:is )?advised|shock (?:is )?not advised)\b/i,
    label: "the no-shock instruction",
  },
  {
    question:
      /\b(?:after|following).{0,24}\bshock\b|\bshock.{0,20}\bdelivered\b/i,
    evidence:
      /\b(?:after|following).{0,32}\bshock\b|\bresume.{0,24}\b(?:cpr|compressions?)\b/i,
    label: "the action after a shock",
  },
  {
    question: /\b(?:hairy|hair|shav|razor)\w*\b/i,
    evidence: /\b(?:hairy|hair|shav|razor)\w*\b/i,
    label: "hair removal for pad contact",
  },
  {
    question:
      /\b(?:where|place|placement|position).{0,30}\bpads?\b|\bpads?.{0,20}\b(?:go|place|position)\w*\b/i,
    evidence:
      /\b(?:collarbone|clavicle|right upper chest|left (?:side|chest)|nipple|armpit|pad goes|place the pad)\b/i,
    label: "AED pad placement",
  },
  {
    question:
      /\b(?:stop|pause|continue).{0,30}\b(?:cpr|compressions?)\b|\b(?:cpr|compressions?).{0,30}\b(?:attach|pads?)\b/i,
    evidence:
      /\b(?:keep|continue|doing|stop|pause).{0,30}\b(?:cpr|compressions?)\b|\b(?:cpr|compressions?).{0,40}\b(?:hook|attach|aed|pads?)\b/i,
    label: "CPR while attaching the AED",
  },
  {
    question: /\bhow long\b/i,
    evidence: /\b(?:seconds?|minutes?|hours?|until|for about|for roughly)\b/i,
    label: "a supported duration or stop condition",
  },
];

function normalizeWord(word: string) {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(?:ing|ed|es|s)$/i, "");
}

function meaningfulWords(text: string) {
  return new Set(
    text
      .split(/\s+/)
      .map(normalizeWord)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
  );
}

function lexicalCoverage(question: string, evidenceText: string) {
  const queryWords = meaningfulWords(question);
  if (queryWords.size === 0) {
    return 0.5;
  }
  const evidenceWords = meaningfulWords(evidenceText);
  const matches = [...queryWords].filter((word) => evidenceWords.has(word));
  return matches.length / queryWords.size;
}

export function assessMedicalFollowUp(
  question: string,
  evidence: TranscriptCitation[]
): FollowUpAssessment {
  if (NONANSWERABLE_RISK_PATTERN.test(question)) {
    return {
      taxonomy: "nonanswerable",
      evidenceSufficiency: "insufficient",
      reason:
        "The question requests diagnosis, prescribing, or medication changes.",
    };
  }

  const evidenceText = evidence.map((cue) => cue.text).join(" ");
  if (!evidenceText.trim()) {
    return {
      taxonomy: "nonanswerable",
      evidenceSufficiency: "insufficient",
      reason: "The active source has no transcript evidence.",
    };
  }

  const relevantConcepts = CONCEPT_CHECKS.filter(({ question: pattern }) =>
    pattern.test(question)
  );
  const unsupportedConcept = relevantConcepts.find(
    ({ evidence: pattern }) => !pattern.test(evidenceText)
  );
  if (unsupportedConcept) {
    return {
      taxonomy: "nonanswerable",
      evidenceSufficiency: "insufficient",
      reason: `The active transcript does not cover ${unsupportedConcept.label}.`,
    };
  }

  const coverage = lexicalCoverage(question, evidenceText);
  const conceptSupported = relevantConcepts.length > 0;
  const evidenceSufficiency: EvidenceSufficiency = conceptSupported
    ? "sufficient"
    : CONTEXTUAL_SEQUENCE_PATTERN.test(question.trim())
      ? "partial"
      : coverage >= 0.6
        ? "sufficient"
        : coverage >= 0.3
          ? "partial"
          : "insufficient";

  if (evidenceSufficiency === "insufficient") {
    return {
      taxonomy: "nonanswerable",
      evidenceSufficiency,
      reason:
        "The follow-up is not directly supported by the active transcript.",
    };
  }

  return {
    taxonomy:
      evidenceSufficiency === "partial" ||
      PERSONALIZED_OR_SAFETY_PATTERN.test(question)
        ? "helpful_deferral"
        : "answerable",
    evidenceSufficiency,
    reason:
      evidenceSufficiency === "sufficient"
        ? "The active transcript directly covers the follow-up."
        : "The active transcript provides related but incomplete guidance.",
  };
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function evidenceTimestamp(citation: TranscriptCitation) {
  const start = citation.clip_start_seconds ?? citation.start_seconds;
  const end = citation.clip_end_seconds ?? citation.end_seconds;
  return end > start
    ? `[${formatTime(start)}–${formatTime(end)}]`
    : `[${formatTime(start)}]`;
}

/**
 * A cue is the smallest addressable unit of the active EvidenceBundle. The cue
 * ID is assigned from the cue's position in the bundle rather than reused from
 * the backend, so "does this ID belong to the active bundle" is a bounded,
 * programmatic check that no model output can widen.
 */
export type FollowUpCue = {
  id: string;
  citation: TranscriptCitation;
  timestamp: string;
};

export function toCitedCue(citation: TranscriptCitation): CitedCue {
  return {
    text: citation.text.trim().replace(/\s+/g, " "),
    startSeconds: citation.clip_start_seconds ?? citation.start_seconds,
    endSeconds: citation.clip_end_seconds ?? citation.end_seconds,
  };
}

export function buildFollowUpCues(
  evidence: TranscriptCitation[]
): FollowUpCue[] {
  return evidence.map((citation, index) => ({
    id: `T${(index + 1).toString().padStart(3, "0")}`,
    citation,
    timestamp: evidenceTimestamp(citation),
  }));
}

function formatCueList(cues: FollowUpCue[]) {
  return cues
    .map(
      (cue) =>
        `${cue.id} ${cue.timestamp}\n${cue.citation.text.trim().replace(/\s+/g, " ")}`
    )
    .join("\n\n");
}

export function publicFollowUpDeferral() {
  return "The current video does not contain enough verified evidence to answer that question. You can ask me to search the supported video collection for another source.";
}

/**
 * The phrasing the interface turns into a one-click action, and the request it
 * submits. Retrieval only ever happens on an explicit request, so this offer is
 * the user's route to it: keep the two in sync.
 * `EXPLICIT_NEW_SOURCE_PATTERN` in query-contextualizer must match the request.
 */
export const COLLECTION_SEARCH_REQUEST = "Search another video for this.";

export function offersCollectionSearch(text: string) {
  return /ask me to search the supported video collection/i.test(text);
}

const PARTIAL_LIMITATION_SENTENCE =
  "The current video does not provide enough verified information in this segment to answer the rest of that question.";

/**
 * Sentences that carry no medical content and therefore need no cue citation.
 * Every other rendered sentence must resolve to a validated cue.
 */
const UNCITED_SENTENCE_PATTERN =
  /^the current video (?:does not contain enough verified evidence|does not provide enough verified information|states)\b|^you can ask me to search the supported video collection\b/i;

export function sanitizeFollowUpAnswer(answer: string) {
  return answer
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?|```/gi, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*(?:answer|key takeaway|important note)\s*:?\s*$/gim, "")
    .replace(/\*\*|__/g, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\s*\((?:cue|cues)\s+T?\d{3}(?:\s*[–-]\s*T?\d{3})?\)/gi, "")
    .replace(
      /^.*(?:generation output failed|grounding validation|lexical support).*$/gim,
      ""
    )
    .replace(/\b(?:cue|cues)\s+T?\d{3}(?:\s*[–-]\s*T?\d{3})?\b/gi, "")
    .replace(/\bT\d{3}\b/g, "")
    .replace(
      /\[((?:\d+:)?\d{1,2}:\d{2})\s*-\s*((?:\d+:)?\d{1,2}:\d{2})\]/g,
      "[$1–$2]"
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function timestampLabels(answer: string) {
  return [...answer.matchAll(TIMESTAMP_PATTERN)].map((match) => match[0]);
}

function splitSentences(text: string) {
  // Quoted transcript excerpts may contain their own terminal punctuation and
  // must not inflate the sentence budget.
  const segments = text
    .replace(/[“"][^”"]*[”"]/g, "«quote»")
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  // A citation that trails its sentence ("... going. [0:33–0:39]") belongs to
  // that sentence, not to a new one.
  return segments.reduce<string[]>((sentences, segment) => {
    if (sentences.length > 0 && /^\[(?:\d+:)?\d{1,2}:\d{2}/.test(segment)) {
      sentences[sentences.length - 1] = `${sentences.at(-1)} ${segment}`;
      return sentences;
    }
    sentences.push(segment);
    return sentences;
  }, []);
}

export function validateFollowUpAnswer(
  answer: string,
  evidence: TranscriptCitation[],
  { requireCitation = true }: { requireCitation?: boolean } = {}
): { valid: boolean; answer: string } {
  const sanitized = sanitizeFollowUpAnswer(answer);
  const allowedTimestamps = new Set(evidence.map(evidenceTimestamp));
  const citedTimestamps = timestampLabels(sanitized);
  const wordCount = sanitized.split(/\s+/).filter(Boolean).length;
  const sentences = splitSentences(sanitized);
  const hasUnsupportedCitation = citedTimestamps.some(
    (citation) => !allowedTimestamps.has(citation)
  );
  // Any sentence that is not one of the fixed non-medical statements must
  // carry a timestamp that resolves back to a cue in the active bundle.
  const hasUncitedMedicalSentence = sentences.some(
    (sentence) =>
      !UNCITED_SENTENCE_PATTERN.test(sentence) &&
      timestampLabels(sentence).length === 0
  );

  return {
    valid:
      sanitized.length > 0 &&
      wordCount <= 90 &&
      sentences.length >= 1 &&
      sentences.length <= 3 &&
      (!requireCitation || citedTimestamps.length > 0) &&
      !hasUnsupportedCitation &&
      !hasUncitedMedicalSentence &&
      !INTERNAL_METADATA_PATTERN.test(sanitized),
    answer: sanitized,
  };
}

/**
 * The three-way retrieval decision from SELF-multi-RAG (Roy et al., 2024,
 * arXiv:2409.15515, §3.2), mapped onto Medix:
 *
 *   [Continue to Use Evidence] -> continue_to_use_evidence (reuse the bundle)
 *   [No Retrieve]              -> no_retrieval_needed      (no factual grounding needed)
 *   [Retrieve]                 -> topic_change             (offer a new search; never automatic)
 *
 * The paper's insight is that the second and third classes are distinct: a turn
 * that needs no grounding must not be answered as though the evidence merely
 * fell short. "same_topic" is accepted as a legacy alias of the first class.
 */
export type FollowUpRelation =
  | "continue_to_use_evidence"
  | "no_retrieval_needed"
  | "topic_change"
  | "uncertain";

export type SemanticFollowUpAssessment = {
  relation: FollowUpRelation;
  sufficiency: EvidenceSufficiency;
  supportingCueIds: string[];
  relatedCueIds: string[];
};

export type GroundedClaim = {
  text: string;
  cueIds: string[];
};

/** SELF-multi-RAG groundedness levels: fully / partially / not supported. */
export type ClaimSupport = "full" | "partial" | "none";

export type ClaimVerification = {
  verdict: "accept" | "refine" | "reject";
  /** SELF-multi-RAG utility token, 1-5. Undefined when the model omits it. */
  utility?: number;
  claims: Array<{
    claimIndex: number;
    support: ClaimSupport;
    cueIds: string[];
  }>;
};

/** Below this, a grounded answer is judged not to address the question. */
const MINIMUM_UTILITY = 3;

/**
 * Qwen 3.5 is a thinking model. Left to itself it spends the whole token
 * budget in the reasoning channel and returns an EMPTY content string with
 * finish_reason "length", which every parser here correctly rejects — so the
 * pipeline would defer on every single turn. Disabling reasoning makes it
 * answer directly. The key must match the provider name in providers.ts.
 */
const LOCAL_MODEL_OPTIONS = {
  ollama: { reasoningEffort: "none" },
} as const;

/**
 * Extracts the model's JSON payload. Local instruction-tuned models wrap it
 * differently — Qwen 3.5 uses <think> blocks, MedGemma 1.5 emits a "thought"
 * prose preamble and then repeats the JSON block twice — so a single greedy
 * first-brace-to-last-brace match spans two objects and fails to parse.
 *
 * Instead, collect every balanced top-level object and take the LAST one that
 * parses: models put the committed answer after their reasoning. Parser-only
 * change; the validation contract on the parsed object is unchanged, so every
 * model is held to exactly the same grounding rules.
 */
function parseJsonPayload(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?|```/gi, "");

  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < cleaned.length; index++) {
    const character = cleaned[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(cleaned.slice(start, index + 1));
      }
    }
  }

  for (let index = candidates.length - 1; index >= 0; index--) {
    try {
      return JSON.parse(candidates[index]);
    } catch {
      // Try the next-earlier candidate.
    }
  }
  return null;
}

/**
 * Returns the supplied IDs only when every one of them addresses a cue in the
 * active bundle. A single hallucinated ID invalidates the whole selection
 * rather than being silently dropped.
 */
function validatedCueIds(
  value: unknown,
  allowed: Set<string>
): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return null;
    }
    const id = entry.trim().toUpperCase();
    if (!allowed.has(id)) {
      return null;
    }
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function normalizeRelation(value: unknown): FollowUpRelation | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "same_topic" ||
    normalized === "continue_to_use_evidence"
  ) {
    return "continue_to_use_evidence";
  }
  if (
    normalized === "no_retrieval_needed" ||
    normalized === "topic_change" ||
    normalized === "uncertain"
  ) {
    return normalized;
  }
  return null;
}

export function parseSemanticAssessment(
  raw: string,
  cues: FollowUpCue[]
): SemanticFollowUpAssessment | null {
  const payload = parseJsonPayload(raw) as Record<string, unknown> | null;
  if (!payload) {
    return null;
  }
  const relation = normalizeRelation(payload.relation);
  const sufficiency = payload.sufficiency;
  if (!relation) {
    return null;
  }
  if (
    sufficiency !== "sufficient" &&
    sufficiency !== "partial" &&
    sufficiency !== "insufficient"
  ) {
    return null;
  }
  const allowed = new Set(cues.map((cue) => cue.id));
  const supportingCueIds = validatedCueIds(payload.supportingCueIds, allowed);
  const relatedCueIds = validatedCueIds(payload.relatedCueIds, allowed);
  if (!(supportingCueIds && relatedCueIds)) {
    return null;
  }
  return { relation, sufficiency, supportingCueIds, relatedCueIds };
}

/**
 * Turns the model's `unsupportedAspect` into the sentence that states the
 * limit. It must restate a gap in the user's question, never introduce medical
 * content, so anything instructional, cited, or long falls back to the generic
 * wording.
 */
export function limitationSentence(unsupportedAspect: unknown): string {
  if (typeof unsupportedAspect !== "string") {
    return PARTIAL_LIMITATION_SENTENCE;
  }
  const aspect = unsupportedAspect
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "");
  const words = aspect.split(" ").filter(Boolean).length;
  const usable =
    aspect.length > 0 &&
    words <= 14 &&
    timestampLabels(aspect).length === 0 &&
    !INTERNAL_METADATA_PATTERN.test(aspect) &&
    // A gap is a noun phrase. Anything that reads as instruction or assertion
    // would be unverified medical content in a sentence no verifier checked.
    !/\b(?:should|must|do not|don't|always|never|apply|give|use|press|perform)\b/i.test(
      aspect
    );
  return usable
    ? `The current video does not provide enough verified information to cover ${aspect}.`
    : PARTIAL_LIMITATION_SENTENCE;
}

export function parseUnsupportedAspect(raw: string): string {
  const payload = parseJsonPayload(raw) as Record<string, unknown> | null;
  return limitationSentence(payload?.unsupportedAspect);
}

export function parseGroundedClaims(
  raw: string,
  selectedCueIds: string[]
): GroundedClaim[] | null {
  const payload = parseJsonPayload(raw) as Record<string, unknown> | null;
  if (!payload || !Array.isArray(payload.claims)) {
    return null;
  }
  const allowed = new Set(selectedCueIds);
  const claims: GroundedClaim[] = [];
  for (const entry of payload.claims) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const { text, cueIds } = entry as Record<string, unknown>;
    if (typeof text !== "string" || !text.trim()) {
      return null;
    }
    const ids = validatedCueIds(cueIds, allowed);
    if (!ids || ids.length === 0) {
      return null;
    }
    claims.push({ text: text.trim(), cueIds: ids });
  }
  return claims.length > 0 ? claims : null;
}

export function parseClaimVerification(
  raw: string,
  selectedCueIds: string[]
): ClaimVerification | null {
  const payload = parseJsonPayload(raw) as Record<string, unknown> | null;
  if (!payload) {
    return null;
  }
  const verdict = payload.verdict;
  if (verdict !== "accept" && verdict !== "refine" && verdict !== "reject") {
    return null;
  }
  let utility: number | undefined;
  if (payload.utility !== undefined && payload.utility !== null) {
    if (
      typeof payload.utility !== "number" ||
      !Number.isFinite(payload.utility) ||
      payload.utility < 1 ||
      payload.utility > 5
    ) {
      return null;
    }
    utility = payload.utility;
  }
  const allowed = new Set(selectedCueIds);
  const claims: ClaimVerification["claims"] = [];
  if (payload.claims !== undefined) {
    if (!Array.isArray(payload.claims)) {
      return null;
    }
    for (const entry of payload.claims) {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const support = normalizeClaimSupport(record);
      if (
        typeof record.claimIndex !== "number" ||
        !Number.isInteger(record.claimIndex) ||
        !support
      ) {
        return null;
      }
      const ids = validatedCueIds(record.cueIds, allowed);
      if (!ids) {
        return null;
      }
      claims.push({ claimIndex: record.claimIndex, support, cueIds: ids });
    }
  }
  return { verdict, utility, claims };
}

function normalizeClaimSupport(
  record: Record<string, unknown>
): ClaimSupport | null {
  const { support, supported } = record;
  if (typeof support === "string") {
    const normalized = support.trim().toLowerCase();
    if (normalized === "full" || normalized === "fully_supported") {
      return "full";
    }
    if (normalized === "partial" || normalized === "partially_supported") {
      return "partial";
    }
    if (normalized === "none" || normalized === "no_support") {
      return "none";
    }
    return null;
  }
  // Legacy boolean groundedness.
  if (typeof supported === "boolean") {
    return supported ? "full" : "none";
  }
  return null;
}

/**
 * The model supplies claim text and cue IDs; the application resolves every
 * rendered timestamp from the bundle so a model can never invent one.
 */
export function renderGroundedClaims(
  claims: GroundedClaim[],
  cues: FollowUpCue[],
  sufficiency: EvidenceSufficiency,
  limitation: string = PARTIAL_LIMITATION_SENTENCE
): string {
  const byId = new Map(cues.map((cue) => [cue.id, cue]));
  const budget = sufficiency === "partial" ? 2 : 3;
  const sentences = claims.slice(0, budget).flatMap((claim) => {
    const timestamps = claim.cueIds
      .map((id) => byId.get(id)?.timestamp)
      .filter((timestamp): timestamp is string => Boolean(timestamp))
      .slice(0, 2);
    if (timestamps.length === 0) {
      return [];
    }
    const text = sanitizeFollowUpAnswer(claim.text)
      .replace(TIMESTAMP_PATTERN, "")
      .replace(/\s+/g, " ")
      .replace(/[\s.;,:]+$/, "")
      .trim();
    return text ? [`${text} ${timestamps.join(" ")}.`] : [];
  });

  if (sentences.length === 0) {
    return "";
  }
  if (sufficiency === "partial") {
    sentences.push(limitation);
  }
  return sentences.join(" ");
}

/**
 * Polarity-neutral extractive fallback. It quotes the selected evidence rather
 * than inferring an answer, so an interrogative form never determines a yes/no.
 */
export function extractiveFallback(cues: FollowUpCue[]): string | null {
  const selected = cues.slice(0, 1);
  if (selected.length === 0) {
    return null;
  }
  const excerpts = selected.map((cue) => {
    const text = cue.citation.text.trim().replace(/\s+/g, " ");
    return `“${text}” ${cue.timestamp}`;
  });
  return `The current video states: ${excerpts.join(" ")}`;
}

const ASSESSMENT_SYSTEM_PROMPT = `You classify a follow-up turn against one already-retrieved medical video transcript.

First choose the relation:
- "continue_to_use_evidence": a factual question about the same procedure, answerable from the conversation or the transcript cues below.
- "no_retrieval_needed": the turn needs no factual medical grounding at all — thanks, greetings, small talk, meta questions about you, or a request to repeat or rephrase what was already said.
- "topic_change": the turn is about a clearly different medical procedure or topic.
- "uncertain": you cannot tell.

Then judge whether the supplied transcript cues can answer it.
Select cue IDs only from the supplied list. Never invent a cue ID. Use empty arrays when the relation is "no_retrieval_needed".
supportingCueIds: cues that directly answer the follow-up. relatedCueIds: cues that are on topic but do not answer it.
sufficiency is "sufficient" when the supporting cues fully answer the follow-up, "partial" when they answer only part of it, and "insufficient" when the transcript cannot answer it.
Judge meaning, not word overlap: a paraphrase that shares no vocabulary with a cue can still be fully supported.
Return JSON only, with no prose and no explanation:
{"relation":"same_topic|topic_change|uncertain","sufficiency":"sufficient|partial|insufficient","supportingCueIds":[],"relatedCueIds":[]}`;

/**
 * Structured after the long-form prompting and evaluation rubric in Med-PaLM 2
 * (Singhal et al., 2023, arXiv:2305.09617). Three transfers:
 *  - the "useful, complete, and scientifically-grounded" framing of Table A.17;
 *  - the pairwise rating axes of §3.5 stated as explicit constraints (address
 *    the intent, omit no important information, include no irrelevant or
 *    inaccurate content);
 *  - an ensemble-refinement-flavoured step where the model first states the
 *    question's intent and the gap, then writes claims conditioned on its own
 *    reasoning. ER's multi-sample voting is deliberately not reproduced: it
 *    costs 11-33 generations per answer, which a local 9B cannot absorb.
 * `intent` and `unsupportedAspect` are internal planning fields.
 */
const GENERATION_SYSTEM_PROMPT = `You are a medical guidance assistant answering a follow-up about a procedure, using ONLY the supplied transcript cues.

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

Return one JSON object only. Well-formed example:
{"intent":"whether compressions continue during AED setup","unsupportedAspect":"","claims":[{"text":"Keep chest compressions going while the AED is prepared","cueIds":["T002"]}]}`;

const VERIFICATION_SYSTEM_PROMPT = `You verify a proposed medical answer against the transcript cues it cites.
For each claim decide whether the cited cues entail it. Do not add, rewrite, or extend any medical content.
Use "accept" when every claim is supported, "refine" when some claims are supported and others are not, and "reject" when the answer is unsupported or unsafe.
Rate each claim's groundedness: "full" when the cited cues state it outright, "partial" when they imply part of it, "none" when they do not support it.
Also rate the usefulness of the whole answer to the user's question from 1 to 5, where 1 means it does not address the question and 5 means it answers it directly.
Cite only cue IDs from the supplied list.
Return one JSON object only. "verdict" must be EXACTLY ONE of "accept", "refine", "reject"; each "support" must be EXACTLY ONE of "full", "partial", "none"; "utility" is a number from 1 to 5. Never output the list of options as the value. Well-formed example:
{"verdict":"accept","utility":4,"claims":[{"claimIndex":0,"support":"full","cueIds":["T002"]}]}`;

const CONVERSATIONAL_SYSTEM_PROMPT = `You reply to a short non-medical turn in a medical assistant conversation.
Reply in at most 2 short sentences and at most 40 words.
Do not give medical or procedural instructions, do not describe the video's content, and do not use timestamps, citations, or lists.
Return the reply text only.`;

const CONVERSATIONAL_FALLBACK =
  "Happy to help. You can ask me more about the current video, or ask me to search the supported video collection for another source.";

const MEDICAL_CONTENT_PATTERN =
  /\b(?:cpr|aed|compressions?|breaths?|defibrillat\w*|pads?|shock|tourniquet|bandage|gauze|wound|dose|dosage|medication|inject\w*|administer\w*|apply|bleeding|airway|pulse)\b/i;

/**
 * A [No Retrieve] reply carries no evidence, so it must carry no medical
 * content either. Anything that drifts toward instruction is replaced.
 */
export function validateConversationalReply(reply: string): string {
  // Reasoning blocks are removed first, but the check runs before the
  // sanitizer scrubs cue IDs: a reply that leaked one is rejected outright
  // rather than silently rewritten into mangled text.
  const stripped = reply
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?|```/gi, "")
    .trim();
  const sanitized = sanitizeFollowUpAnswer(stripped);
  const words = stripped.split(/\s+/).filter(Boolean).length;
  const valid =
    sanitized.length > 0 &&
    words <= 40 &&
    splitSentences(sanitized).length <= 2 &&
    timestampLabels(stripped).length === 0 &&
    !MEDICAL_CONTENT_PATTERN.test(stripped) &&
    !INTERNAL_METADATA_PATTERN.test(stripped);
  return valid ? sanitized : CONVERSATIONAL_FALLBACK;
}

export async function generateVerifiedFollowUp({
  model,
  question,
  activeEvidence,
  recentConversation,
}: {
  model: LanguageModel;
  question: string;
  activeEvidence: ProcedureToolOutput;
  recentConversation: string;
}): Promise<VerifiedFollowUp> {
  const evidence =
    activeEvidence.evidenceContext.length > 0
      ? activeEvidence.evidenceContext
      : activeEvidence.citations;
  const cues = buildFollowUpCues(evidence);
  const deferralText = publicFollowUpDeferral();
  const defer = (
    reason: string,
    verified: boolean,
    sufficiency: EvidenceSufficiency = "insufficient",
    relation: FollowUpRelation = "uncertain"
  ): VerifiedFollowUp => ({
    taxonomy: "nonanswerable",
    evidenceSufficiency: sufficiency,
    reason,
    answer: deferralText,
    verified,
    relation,
    citedCues: [],
  });

  if (cues.length === 0) {
    return defer("The active source has no transcript evidence.", true);
  }
  // The only surviving deterministic pre-filter: never generate for requests
  // that ask for diagnosis, prescribing, or medication changes.
  if (NONANSWERABLE_RISK_PATTERN.test(question)) {
    return defer(
      "The question requests diagnosis, prescribing, or medication changes.",
      true
    );
  }

  const answerConversationally = async (): Promise<VerifiedFollowUp> => {
    const conversational = await generateText({
      model,
      temperature: 0.2,
      maxOutputTokens: 120,
      providerOptions: LOCAL_MODEL_OPTIONS,
      system: CONVERSATIONAL_SYSTEM_PROMPT,
      prompt: `Recent conversation:
${recentConversation}

Latest turn: ${question}`,
    });
    return {
      taxonomy: "conversational",
      evidenceSufficiency: "insufficient",
      reason: "The turn does not require evidence grounding.",
      answer: validateConversationalReply(conversational.text),
      verified: true,
      relation: "no_retrieval_needed",
      citedCues: [],
    };
  };

  // Greetings, thanks, and capability questions are settled deterministically:
  // no evidence assessment, no retrieval, no medical framing.
  if (isSmallTalk(question)) {
    try {
      return await answerConversationally();
    } catch (error) {
      console.warn("Small-talk reply failed:", error);
      return defer("The local follow-up model was unavailable.", false);
    }
  }

  const cueList = formatCueList(cues);
  const activeProcedure =
    activeEvidence.sourceRetrievalQuery || activeEvidence.retrievalQuery;

  try {
    const assessmentResult = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 1200,
      providerOptions: LOCAL_MODEL_OPTIONS,
      system: ASSESSMENT_SYSTEM_PROMPT,
      prompt: `Original procedure query: ${activeProcedure}
Recent conversation:
${recentConversation}

Latest follow-up: ${question}

Transcript cues:
${cueList}`,
    });

    const assessment = parseSemanticAssessment(assessmentResult.text, cues);
    if (!assessment) {
      // Unparseable output or a hallucinated cue ID never escalates to
      // retrieval; it defers.
      return defer("The evidence assessment could not be validated.", false);
    }
    // "uncertain" is treated as same-topic; a model-reported topic change is
    // handled conservatively here because the deterministic routing layer has
    // already committed this turn to the active bundle.
    if (assessment.relation === "topic_change") {
      return defer(
        "The follow-up is not about the active source.",
        true,
        "insufficient",
        "topic_change"
      );
    }

    // [No Retrieve]: the turn needs no grounding, so answering it with an
    // evidence deferral would be the wrong response entirely.
    if (assessment.relation === "no_retrieval_needed") {
      return await answerConversationally();
    }

    const selected =
      assessment.supportingCueIds.length > 0
        ? assessment.supportingCueIds
        : assessment.sufficiency === "partial"
          ? assessment.relatedCueIds
          : [];
    if (assessment.sufficiency === "insufficient" || selected.length === 0) {
      return defer(
        "The active transcript does not support the follow-up.",
        true
      );
    }

    const selectedCues = cues.filter((cue) => selected.includes(cue.id));
    const sufficiency = assessment.sufficiency;
    const succeed = (
      answer: string,
      effective: EvidenceSufficiency = sufficiency,
      cited: FollowUpCue[] = selectedCues
    ): VerifiedFollowUp => ({
      taxonomy: effective === "sufficient" ? "answerable" : "helpful_deferral",
      evidenceSufficiency: effective,
      reason:
        effective === "sufficient"
          ? "The selected cues directly support the follow-up."
          : "The selected cues support only part of the follow-up.",
      answer,
      verified: true,
      relation: "continue_to_use_evidence",
      citedCues: cited.map((cue) => toCitedCue(cue.citation)),
    });
    const fallbackOrDefer = (reason: string): VerifiedFollowUp => {
      const fallback = extractiveFallback(selectedCues);
      if (!fallback) {
        return defer(reason, true, sufficiency, "continue_to_use_evidence");
      }
      // A fallback is not exempt from validation.
      const check = validateFollowUpAnswer(fallback, evidence);
      return check.valid
        ? succeed(check.answer)
        : defer(reason, true, sufficiency, "continue_to_use_evidence");
    };

    const selectedCueList = formatCueList(selectedCues);
    const generation = await generateText({
      model,
      temperature: 0.1,
      maxOutputTokens: 1200,
      providerOptions: LOCAL_MODEL_OPTIONS,
      system: GENERATION_SYSTEM_PROMPT,
      prompt: `Follow-up: ${question}
Evidence sufficiency: ${sufficiency}

Selected transcript cues:
${selectedCueList}`,
    });

    const claims = parseGroundedClaims(generation.text, selected);
    const limitation = parseUnsupportedAspect(generation.text);
    if (!claims) {
      return fallbackOrDefer("The grounded answer could not be validated.");
    }

    const verificationResult = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 1200,
      providerOptions: LOCAL_MODEL_OPTIONS,
      system: VERIFICATION_SYSTEM_PROMPT,
      prompt: `Follow-up: ${question}

Selected transcript cues:
${selectedCueList}

Proposed claims:
${claims.map((claim, index) => `${index}: ${claim.text} (cites ${claim.cueIds.join(", ")})`).join("\n")}`,
    });

    const verification = parseClaimVerification(
      verificationResult.text,
      selected
    );
    if (!verification || verification.verdict === "reject") {
      return fallbackOrDefer("Verification rejected the proposed answer.");
    }
    // Utility gate: a fully grounded answer that does not address the question
    // is still the wrong answer to show (SELF-multi-RAG utility token, §3.2).
    if (
      verification.utility !== undefined &&
      verification.utility < MINIMUM_UTILITY
    ) {
      return fallbackOrDefer(
        "The proposed answer did not address the question."
      );
    }

    const verdictByIndex = new Map(
      verification.claims.map((claim) => [claim.claimIndex, claim])
    );
    let downgraded = false;
    const supportedClaims = claims.flatMap((claim, index) => {
      const verdict = verdictByIndex.get(index);
      const support =
        verification.claims.length === 0 ? "full" : verdict?.support;
      if (support === undefined || support === "none") {
        return [];
      }
      // A partially grounded claim is kept but forces the answer to state its
      // own limits, rather than being presented as fully established.
      if (support === "partial") {
        downgraded = true;
      }
      // The verifier may narrow the citation set but never introduce content.
      const cueIds =
        verdict && verdict.cueIds.length > 0 ? verdict.cueIds : claim.cueIds;
      return [{ ...claim, cueIds }];
    });
    if (supportedClaims.length === 0) {
      return fallbackOrDefer("No proposed claim survived verification.");
    }

    const effectiveSufficiency: EvidenceSufficiency =
      downgraded || supportedClaims.length < claims.length
        ? "partial"
        : sufficiency;
    const rendered = renderGroundedClaims(
      supportedClaims,
      selectedCues,
      effectiveSufficiency,
      limitation
    );
    const validation = validateFollowUpAnswer(rendered, evidence);
    if (!validation.valid) {
      return fallbackOrDefer("The rendered answer failed validation.");
    }
    return succeed(validation.answer, effectiveSufficiency);
  } catch (error) {
    console.warn("Follow-up generation or verification failed:", error);
    return defer("The local follow-up model was unavailable.", false);
  }
}

function parseTime(value: string) {
  return value
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

export function linkFollowUpTimestamps(
  answer: string,
  evidenceBundleId: string
) {
  const bundle = encodeURIComponent(evidenceBundleId);
  return answer.replace(
    TIMESTAMP_PATTERN,
    (_match, start: string, end: string | undefined) => {
      const startSeconds = parseTime(start);
      const endSeconds = Math.max(startSeconds, parseTime(end ?? start));
      const label = end ? `${start}–${end}` : start;
      return `[${label}](#medix-evidence=${bundle}&clip=${startSeconds},${endSeconds})`;
    }
  );
}

export function parseEvidenceTimestampHref(href?: string) {
  const match = href?.match(/^#medix-evidence=([^&]+)&clip=(\d+),(\d+)$/);
  if (!match) {
    return null;
  }
  const startSeconds = Number(match[2]);
  const endSeconds = Number(match[3]);
  if (!(Number.isFinite(startSeconds) && Number.isFinite(endSeconds))) {
    return null;
  }
  return {
    evidenceBundleId: decodeURIComponent(match[1]),
    startSeconds,
    endSeconds: Math.max(startSeconds, endSeconds),
  };
}
