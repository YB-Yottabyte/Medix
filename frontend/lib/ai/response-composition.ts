import type { MedicalReference } from "./medical-knowledge";
import { questionIntent } from "./question-intent";

export type ResponseRole = "answer" | "step" | "warning" | "action";
export type ResponsePlan = {
  maxClaims: number;
  maxWords: number;
  maxSentences: number;
  focus?: "immediate" | "escalation";
  needsNextAction?: boolean;
  layout?: "paragraphs" | "steps";
  compactPractical?: boolean;
};

export function planResponse(
  question: string,
  initialAnswer: boolean
): ResponsePlan {
  const intent = questionIntent(question);
  const explicitProse =
    /\b(?:paragraphs?|prose|no (?:bullets?|lists?))\b/i.test(question);
  const explicitSteps =
    /\b(?:step[ -]by[ -]step|steps|checklist|numbered|bullet(?:ed)?(?: points?)?|list)\b/i.test(
      question
    );
  const layout: NonNullable<ResponsePlan["layout"]> =
    !explicitProse &&
    (explicitSteps ||
      (initialAnswer && (intent === "recognition" || intent === "procedure")))
      ? "steps"
      : "paragraphs";
  const presentation = {
    compactPractical: initialAnswer && !explicitSteps,
    layout,
  };
  const needsNextAction =
    /\b(?:what if|doesn.t|does not|hasn.t|has not|still|worse|next|now what)\b/i.test(
      question
    );
  if (
    !needsNextAction &&
    /\b(?:one (?:simple )?sentence|briefly|short answer|how (?:long|many)|what colour)\b/i.test(
      question
    )
  ) {
    return { ...presentation, maxClaims: 2, maxSentences: 4, maxWords: 65 };
  }
  const detailed = /\b(?:in detail|detailed|thorough|comprehensive)\b/i.test(
    question
  );
  if (!initialAnswer && !detailed && intent === "rationale") {
    return { ...presentation, maxClaims: 3, maxSentences: 7, maxWords: 140 };
  }
  if (!initialAnswer && !detailed && needsNextAction) {
    return {
      ...presentation,
      maxClaims: 5,
      maxSentences: 10,
      maxWords: 180,
      needsNextAction,
    };
  }
  if (
    needsNextAction ||
    initialAnswer ||
    /\b(?:explain|why|what if|safe|warning|tight|next|steps)\b/i.test(question)
  ) {
    const focus =
      /\b(?:when|need|seek)\b[^?]{0,60}\b(?:medical help|medical attention|doctor|hospital|emergency care)\b/i.test(
        question
      )
        ? "escalation"
        : /\b(?:now|just|right away|immediately)\b/i.test(question)
          ? "immediate"
          : undefined;
    return {
      ...presentation,
      maxClaims: 8,
      maxSentences: 14,
      maxWords: 280,
      needsNextAction,
      ...(focus ? { focus } : {}),
    };
  }
  return { ...presentation, maxClaims: 3, maxSentences: 7, maxWords: 120 };
}

export function referenceContext(sources: MedicalReference[]) {
  return sources
    .map(
      (source) =>
        `${source.id} — ${source.title}\nScope: ${source.scope}\nChecked: ${source.checkedAt}\n${source.summary}`
    )
    .join("\n\n");
}

export function responseRole(value: unknown, index: number): ResponseRole {
  return value === "answer" ||
    value === "step" ||
    value === "warning" ||
    value === "action"
    ? value
    : index === 0
      ? "answer"
      : "step";
}

/** Adjacent statements verified against exactly the same references can share
 * one trailing citation. Video timestamps and changes of source stay in place. */
function joinVerifiedProse(
  parts: { text: string; referenceOnly: boolean }[]
): string {
  const runs: string[] = [];
  let pending = "";
  let references = "";
  const flush = () => {
    if (pending) {
      runs.push(`${pending}${references ? ` ${references}` : ""}`);
    }
    pending = "";
    references = "";
  };
  for (const part of parts) {
    const text = part.text.trim();
    const match = part.referenceOnly
      ? text.match(/\s+((?:\[\d+\]\(https:\/\/[^)\s]+\)\s*)+)$/)
      : null;
    const nextReferences = match?.[1].trim() ?? "";
    if (!nextReferences) {
      flush();
      runs.push(text);
      continue;
    }
    if (references && references !== nextReferences) {
      flush();
    }
    const body = text.slice(0, match?.index).trim();
    pending = pending ? `${pending} ${body}` : body;
    references = nextReferences;
  }
  flush();
  return runs.join(" ");
}

export function renderResponseParts(
  parts: { text: string; role: ResponseRole; referenceOnly: boolean }[],
  options: Pick<ResponsePlan, "layout" | "compactPractical"> = {}
) {
  if (options.layout !== "steps") {
    // Verification units are not paragraph boundaries. Join related claims
    // without rewriting any medical content or moving its supporting citations.
    const paragraphs: string[] = [];
    let pending: typeof parts = [];
    const flush = () => {
      if (pending.length) {
        paragraphs.push(joinVerifiedProse(pending));
      }
      pending = [];
    };
    for (const part of parts.filter((part) => part.text.trim())) {
      const warningBoundary =
        pending.length > 0 &&
        (part.role === "warning") !== (pending.at(-1)?.role === "warning");
      const words = [...pending, part].reduce(
        (count, item) =>
          count +
          item.text
            .replace(/\[[^\]]*\]\([^)]*\)/g, "")
            .trim()
            .split(/\s+/).length,
        0
      );
      if (
        warningBoundary ||
        (pending.length > 0 && (words > 65 || pending.length >= 3))
      ) {
        flush();
      }
      pending.push(part);
    }
    flush();
    return paragraphs.join("\n\n");
  }
  // Claim roles select presentation, not stock patient-facing headings.
  // Preserve the verified narrative: never move an action away from its condition.
  const blocks: string[] = [];
  const [first, ...remaining] = parts.filter((part) => part.text.trim());
  if (!first) {
    return "";
  }
  // The first surviving verified claim is always a direct opening, even if
  // the model mislabels it as a step. No new clinical content is introduced.
  let pending: typeof parts = [first];
  let group: "prose" | "practical" | null = "prose";
  const flush = () => {
    if (!pending.length) {
      return;
    }
    const texts = pending.map((part) => part.text.trim());
    if (group === "practical" && texts.length > 1) {
      // Rendering may join adjacent, already verified instructions, but never
      // rewrites them or moves their citations to another instruction. Explicit
      // step-by-step requests retain one bullet per authored point.
      const points: string[] = [];
      for (let index = 0; index < pending.length; index++) {
        const pair = pending.slice(index, index + 2);
        const words = pair.reduce(
          (n, part) =>
            n +
            part.text.replace(/\[[^\]]*\]\([^)]*\)/g, "").split(/\s+/).length,
          0
        );
        if (
          options.compactPractical &&
          pending.length > 3 &&
          pair.length === 2 &&
          words <= 50
        ) {
          points.push(joinVerifiedProse(pair));
          index++;
        } else {
          points.push(pending[index].text.trim());
        }
      }
      blocks.push(points.map((text) => `- ${text}`).join("\n"));
    } else {
      blocks.push(joinVerifiedProse(pending));
    }
    pending = [];
    group = null;
  };
  for (const part of remaining) {
    if (part.role === "warning") {
      flush();
      blocks.push(part.text.trim());
      continue;
    }
    const next =
      part.role === "step" || part.role === "action" ? "practical" : "prose";
    if (group !== null && group !== next) {
      flush();
    }
    group = next;
    pending.push(part);
  }
  flush();
  return blocks.join("\n\n");
}

/** Remove exact repeats or audited semantic duplicates; never suppress a
 * sentence just because it shares a medical keyword with another sentence. */
export function distinctSupportedClaims<
  T extends {
    text: string;
    draftIndex: number;
    candidateIndex: number;
  },
>(claims: T[], duplicateOf: ReadonlyMap<number, number>): T[] {
  const supported = new Map(
    claims.map((claim) => [claim.candidateIndex, claim])
  );
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const text = claim.text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "");
    if (seen.has(text)) {
      return false;
    }
    const targetIndex = duplicateOf.get(claim.candidateIndex);
    const target =
      targetIndex === undefined ? undefined : supported.get(targetIndex);
    if (
      target &&
      target.candidateIndex < claim.candidateIndex &&
      target.draftIndex !== claim.draftIndex
    ) {
      return false;
    }
    seen.add(text);
    return true;
  });
}

export type ResponseQuality = {
  sufficient: boolean;
  utility?: number;
  presentation?: number;
  supportedClaims: number;
  requestedClaims: number;
  roles: readonly ResponseRole[];
};

/** A repair should improve supported coverage, rather than merely change wording. */
export function improvesResponseCoverage(
  next: ResponseQuality,
  previous: ResponseQuality
): boolean {
  const score = (quality: ResponseQuality) => [
    Number(quality.sufficient),
    // For partial replies, preserve verified coverage before a subjective model
    // score. A fluent one-line fragment must not displace a useful safety repair.
    quality.sufficient ? 0 : new Set(quality.roles).size,
    quality.sufficient
      ? 0
      : quality.supportedClaims / Math.max(1, quality.requestedClaims),
    quality.utility ?? 0,
    quality.sufficient ? (quality.presentation ?? 0) : 0,
    new Set(quality.roles).size,
    quality.supportedClaims,
  ];
  const nextScore = score(next);
  const previousScore = score(previous);
  for (let index = 0; index < nextScore.length; index++) {
    if (nextScore[index] !== previousScore[index]) {
      return nextScore[index] > previousScore[index];
    }
  }
  return false;
}

/** Local source numbering must remain consistent when several answers are combined. */
export function renumberReferenceLinks(
  answer: string,
  sources: readonly { url: string }[]
) {
  const urls = [...new Set(sources.map((source) => source.url))];
  return answer.replace(
    /\[(\d+)\]\((https:\/\/[^)\s]+)\)/g,
    (match, _number, url) => {
      const index = urls.indexOf(url);
      return index < 0 ? match : `[${index + 1}](${url})`;
    }
  );
}

export function medicalSourceFooter(
  sources: readonly { url: string; title: string }[]
) {
  const unique = sources.filter(
    (source, index, all) =>
      all.findIndex((other) => other.url === source.url) === index
  );
  return unique.length
    ? `\n\nSources: ${unique.map((source, index) => `[${index + 1}. ${source.title}](${source.url})`).join(" · ")}`
    : "";
}

/** Only questions, never an unverified medical assertion or a treatment suggestion. */
export function safeFollowUp(
  value: unknown,
  verified: boolean,
  context = ""
): string | null {
  if (!verified || typeof value !== "string") {
    return null;
  }
  const question = value.trim();
  const locationKnown =
    /\b(?:arm|hand|finger|leg|foot|toe|wrist|ankle|face|head|chest|back)\b/i.test(
      context
    );
  const asksLocation =
    /\bwhere\b|\bwhich (?:part|area)\b|\bis (?:the|your|their)\b[^?]{0,30}\bon\b/i.test(
      question
    );
  if (
    locationKnown &&
    asksLocation &&
    !/\b(?:still|spread|other|else|also)\b/i.test(question)
  ) {
    return null;
  }
  if (context.toLowerCase().includes(question.toLowerCase())) {
    return null;
  }
  if (
    question.split(/\s+/).length > 24 ||
    !/^(?:is|are|does|do|has|have|can|what|where|when|how|which)\b/i.test(
      question
    ) ||
    (question.match(/\?/g) ?? []).length !== 1 ||
    !question.endsWith("?")
  ) {
    return null;
  }
  if (
    /[\n.![\]<>]|https?:|\b(?:try|take|apply|loosen|remove|dose|diagnos\w*|because|since|should|must)\b/i.test(
      question
    )
  ) {
    return null;
  }
  return question;
}

/** Test each evidence type independently; a web fact must not borrow a video timestamp. */
export function splitEvidenceCandidates(
  claims: { text: string; cueIds: string[] }[],
  referenceIds: ReadonlySet<string>
) {
  return claims.flatMap((claim, draftIndex) => {
    const video = claim.cueIds.filter((id) => !referenceIds.has(id));
    const reference = claim.cueIds.filter((id) => referenceIds.has(id));
    // Audit each evidence type once. The verifier must choose the smallest
    // supporting subset of the proposed medical IDs; expanding individual
    // and combined references repeats the same sentence and bloats the review without adding evidence.
    return [video, reference]
      .filter((ids) => ids.length)
      .map((cueIds) => ({ cueIds, draftIndex, text: claim.text }));
  });
}

/** Verify each authored statement once. General care prefers checked references;
 * explicit video questions prefer video cues. A failed choice must be repaired,
 * never rescued by silently attaching an unchecked alternative citation. */
export function selectClaimEvidence(
  claims: { text: string; cueIds: string[] }[],
  referenceIds: ReadonlySet<string>,
  question: string
) {
  const preferVideo = /\b(?:video|clip|timestamp|demonstration)\b/i.test(
    question
  );
  return claims.map((claim, draftIndex) => {
    const reference = claim.cueIds.filter((id) => referenceIds.has(id));
    const video = claim.cueIds.filter((id) => !referenceIds.has(id));
    const preferred = preferVideo ? video : reference;
    return {
      cueIds: preferred.length ? preferred : preferVideo ? reference : video,
      draftIndex,
      text: claim.text,
    };
  });
}

/** A second deterministic check catches details an LLM verifier can overlook.
 * It does not replace entailment verification; paraphrases still require that pass.
 */
export function explicitCriticalDetails(
  text: string,
  support: string
): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(
        /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b/g,
        (word) =>
          ({
            eight: "8",
            five: "5",
            four: "4",
            nine: "9",
            one: "1",
            seven: "7",
            six: "6",
            ten: "10",
            three: "3",
            twenty: "20",
            two: "2",
          })[word] ?? word
      )
      .replace(/releasing|released/g, "release")
      .replace(/loosening|loosened/g, "loosen")
      .replace(/\btingl(?:e|es|ed|ing)\b/g, "tingle")
      .replace(/\bnumbness\b/g, "numb")
      .replace(/\bbleed(?:ing|s)?\b/g, "bleed")
      .replace(/\b(?:moving|movement|moves)\b/g, "move")
      .replace(/\b(?:swelling|swollen)\b/g, "swell")
      .replace(/\bpainful\b/g, "pain");
  const claim = normalize(text);
  // Do not turn a screening check into a diagnosis about the current person.
  if (
    /\b(?:is|are|has|have)\b[^.!?]{0,24}\b(?:cutting off (?:blood|circulation)|blocked (?:blood|arter\w*)|infected|fractured|damaged nerves?)\b/.test(
      claim
    )
  ) {
    return false;
  }
  if (
    /\b(?:ensure|guarantee|prove|confirm)\w*\b[^.!?]{0,60}\b(?:safe|adequate|normal|healthy|correct|restored|blocked)\b/.test(
      claim
    )
  ) {
    return false;
  }
  const evidence = normalize(support);
  const quantities = claim.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  if (
    quantities.some(
      (number) =>
        !new RegExp(`\\b${number.replace(".", "\\.")}\\b`).test(evidence)
    )
  ) {
    return false;
  }
  const critical =
    /\b(?:release|loosen|reapply|pale|cold|blue|numb\w*|tingl\w*|bleed|move|swell|pain|misshapen|emergency|antibiotic\w*)\b/g;
  return [...claim.matchAll(critical)].every(([detail]) =>
    evidence.includes(detail)
  );
}

/** Medix does not choose medicines, even when an older video recommends one. */
export function hasMedicationRecommendation(text: string): boolean {
  return text.split(/[.!?;]|\bbut\b/i).some((clause) => {
    const recommendation =
      /\b(?:take|apply|use|start|switch|increase|reduce)\b[^.!?;]{0,80}\b(?:antibiotic\w*|ointment\w*|medicat\w*|medicine\w*|dosage|dose|paracetamol|ibuprofen|aspirin)\b/i.test(
        clause
      );
    const avoidance =
      /\b(?:do not|don't|avoid|never)\b[^.!?;]{0,30}\b(?:take|apply|use|start|switch|increase|reduce)\b/i.test(
        clause
      );
    return recommendation && !avoidance;
  });
}

/** Keep a current-care question from becoming a transcript-wide aftercare dump. */
export function relevantToResponsePlan(
  text: string,
  role: ResponseRole,
  plan: ResponsePlan
): boolean {
  if (
    plan.focus === "immediate" &&
    role === "step" &&
    /\b(?:24 hours?|daily|days?|weeks?|overnight)\b/i.test(text)
  ) {
    return false;
  }
  if (
    plan.focus === "escalation" &&
    !/\b(?:help|care|doctor|hospital|clinician|emergency|urgent|seek)\b/i.test(
      text
    )
  ) {
    return false;
  }
  return true;
}

export function completePlayableCue(cue: {
  start_seconds: number;
  end_seconds: number;
  clip_start_seconds?: number;
  clip_end_seconds?: number;
}): boolean {
  if (
    cue.clip_start_seconds === undefined ||
    cue.clip_end_seconds === undefined
  ) {
    return true;
  }
  const original = cue.end_seconds - cue.start_seconds;
  const playable = cue.clip_end_seconds - cue.clip_start_seconds;
  return original > 0 && playable > 0 && playable + 0.01 >= original;
}

/** Remove a stock assurance before verification, retaining the instruction itself.
 * Conditional tails are not edited because removing them could change the advice.
 */
export function stripStockAssurance(text: string): string {
  return text
    .replace(
      /\s+(?:in order )?to (?:ensure|guarantee|prove|confirm)\b[^.!?]*(?:safe|adequate|normal|healthy|correct|restored|blocked)\b[^.!?]*[.!?]?$/i,
      (tail) =>
        /\b(?:if|unless|except|provided|until)\b/i.test(tail) ? tail : ""
    )
    .trim();
}
