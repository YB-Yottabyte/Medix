export type EvidenceCitation = {
  cue_id: string;
  start_seconds: number;
  end_seconds: number;
  clip_start_seconds?: number;
  clip_end_seconds?: number;
  text: string;
};

export type PlaybackCitation = EvidenceCitation & {
  clipStartSeconds: number;
  clipEndSeconds: number;
};

const INTERNAL_CITATION_GROUP = /\[(T\d{3}(?:[\s,]+T\d{3})*)\]/g;
const PUBLIC_CITATION_GROUP = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const TIMESTAMP_GROUP =
  /\[((?:\d+:)?\d{1,2}:\d{2})(?:\s*[–-]\s*((?:\d+:)?\d{1,2}:\d{2}))?\](?!\()/g;
const TIMESTAMP_LINK_PREFIX = "#medix-clip=";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Normalize source-video cue timestamps into the extracted clip's 0-based
 * playback coordinates. Explicit API values win; deriving them keeps saved
 * responses from older API versions playable.
 */
export function mapCitationsToClip(
  citations: EvidenceCitation[],
  sourceClipStart: number,
  sourceClipEnd: number
): PlaybackCitation[] {
  const duration = Math.max(0, sourceClipEnd - sourceClipStart);

  return citations.map((citation) => {
    const derivedStart = citation.start_seconds - sourceClipStart;
    const derivedEnd = citation.end_seconds - sourceClipStart;
    const suppliedStart = citation.clip_start_seconds;
    const suppliedEnd = citation.clip_end_seconds;

    const clipStartSeconds = clamp(
      typeof suppliedStart === "number" && Number.isFinite(suppliedStart)
        ? suppliedStart
        : derivedStart,
      0,
      duration
    );
    const clipEndSeconds = clamp(
      typeof suppliedEnd === "number" && Number.isFinite(suppliedEnd)
        ? suppliedEnd
        : derivedEnd,
      clipStartSeconds,
      duration
    );

    return { ...citation, clipStartSeconds, clipEndSeconds };
  });
}

/** Convert legacy internal cue markers such as [T005 T006] to public [1, 2]. */
export function formatPublicCitations(
  answer: string,
  citations: EvidenceCitation[]
) {
  const publicNumberByCue = new Map(
    citations.map((citation, index) => [citation.cue_id, index + 1])
  );

  return answer.replace(INTERNAL_CITATION_GROUP, (_match, group: string) => {
    const publicNumbers = group
      .split(/[\s,]+/)
      .map((cueId) => publicNumberByCue.get(cueId))
      .filter((value): value is number => value !== undefined);

    return publicNumbers.length > 0 ? `[${publicNumbers.join(", ")}]` : "";
  });
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

function parseTime(value: string) {
  return value
    .split(":")
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0);
}

function timestampLink(startSeconds: number, endSeconds: number) {
  const start = Math.max(0, Math.floor(startSeconds));
  const end = Math.max(start, Math.floor(endSeconds));
  const label =
    end > start ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start);
  return `[${label}](${TIMESTAMP_LINK_PREFIX}${start},${end})`;
}

function timestampForCitations(citations: PlaybackCitation[]) {
  if (citations.length === 0) {
    return "";
  }
  return timestampLink(
    Math.min(...citations.map((citation) => citation.clipStartSeconds)),
    Math.max(...citations.map((citation) => citation.clipEndSeconds))
  );
}

/** Replace model/internal citation syntax with clickable, clip-relative time ranges. */
export function timestampAnswerCitations(
  answer: string,
  citations: PlaybackCitation[]
) {
  const byCueId = new Map(
    citations.map((citation) => [citation.cue_id, citation])
  );

  const timestampedAnswer = answer
    .replace(INTERNAL_CITATION_GROUP, (_match, group: string) =>
      timestampForCitations(
        group
          .split(/[\s,]+/)
          .map((cueId) => byCueId.get(cueId))
          .filter((citation): citation is PlaybackCitation => Boolean(citation))
      )
    )
    .replace(PUBLIC_CITATION_GROUP, (_match, group: string) =>
      timestampForCitations(
        group
          .split(/\s*,\s*/)
          .map((value) => citations[Number(value) - 1])
          .filter((citation): citation is PlaybackCitation => Boolean(citation))
      )
    )
    .replace(
      TIMESTAMP_GROUP,
      (_match, start: string, end: string | undefined) =>
        timestampLink(parseTime(start), parseTime(end ?? start))
    );

  // Models sometimes put a citation in its own Markdown paragraph. Keep the
  // citation attached to the sentence it supports so numbered steps stay
  // compact and easy to scan.
  return timestampedAnswer.replace(
    /[ \t]*\n+(?:[ \t]*\n)*[ \t]*(\[[^\]]+\]\(#medix-clip=\d+,\d+\))/g,
    " $1"
  );
}

export function parseTimestampCitationHref(href?: string) {
  if (!href?.startsWith(TIMESTAMP_LINK_PREFIX)) {
    return null;
  }
  const [start, end] = href
    .slice(TIMESTAMP_LINK_PREFIX.length)
    .split(",")
    .map(Number);
  if (!(Number.isFinite(start) && Number.isFinite(end))) {
    return null;
  }
  return { startSeconds: start, endSeconds: Math.max(start, end) };
}

const MOMENT_TITLE_RULES: [RegExp, string][] = [
  [/doesn.t stop.*bleed|move to pack/i, "Begin wound packing"],
  [/hemostatic gauze|use (?:some |a )?gauze/i, "Use packing gauze"],
  [/clean (?:cloth|shirt)|use a shirt/i, "Use a clean cloth"],
  [
    /until (?:you )?(?:can.t|cannot)|no more (?:fits|material)/i,
    "Pack until filled",
  ],
  [/source of the bleed|source of bleeding/i, "Reach bleeding source"],
  [
    /keep packing|packing more|pack deeper|deep wound/i,
    "Continue packing deeper",
  ],
];

/** Create a short user-facing title from transcript meaning without exposing IDs. */
export function evidenceMomentTitle(text: string) {
  for (const [pattern, title] of MOMENT_TITLE_RULES) {
    if (pattern.test(text)) {
      return title;
    }
  }

  const words = text
    .replace(/[^a-z0-9'\s-]/gi, " ")
    .replace(
      /^(?:and|then|so|typically|first|next|now|we(?:'re| are)? going to)\s+/i,
      ""
    )
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length === 0) {
    return "Review this moment";
  }
  const title = words.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Remove UI-duplicated warning/meta prose while preserving the full instructions. */
export function sanitizeProcedureAnswer(
  answer: string,
  emergencyWarning?: string | null
) {
  let cleaned = answer.replace(
    /^.*Evidence:\s*.*(?:T\d{3}|verified medical video).*$/gim,
    ""
  );
  cleaned = cleaned
    .replace(/^.*(?:generation output failed|grounding validation|lexical support).*$/gim, "")
    .replace(/\s*\((?:cue|cues)\s+T?\d{3}(?:\s*[–-]\s*T?\d{3})?\)/gi, "")
    .replace(/\b(?:cue|cues)\s+T?\d{3}(?:\s*[–-]\s*T?\d{3})?\b/gi, "")
    .replace(/\bT\d{3}\b/g, "");
  if (emergencyWarning?.trim()) {
    cleaned = cleaned.replace(emergencyWarning.trim(), "");
    cleaned = cleaned.replace(
      /^\s*(?:#{1,6}\s*)?Emergency warning\s*:?[ \t]*$/gim,
      ""
    );
  }
  cleaned = cleaned
    // Report scaffolding the answer should no longer carry: a leading title,
    // a "Steps to ..." lead-in, and the old closing filler line.
    .replace(/^\s*#{1,6}\s*.*$/gm, "")
    .replace(/^\s*(?:\*\*)?Steps? to [^\n*]*(?:\*\*)?\s*:?\s*$/gim, "")
    .replace(
      /^\s*Supporting video guidance is shown below\.?\s*$/gim,
      ""
    )
    .replace(/\s*Supporting video guidance is shown below\.\s*$/i, "");
  return limitNumberedSteps(cleaned, 4).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Keep a model-generated procedure within the user-facing step budget.
 * Numbered steps and bullets share one budget: four list items total, however
 * they are marked, so a model cannot evade the cap by switching to bullets.
 */
export function limitNumberedSteps(answer: string, maximumSteps = 4) {
  const lines = answer.split("\n");
  const kept: string[] = [];
  let numberedSteps = 0;
  let droppingExtraStep = false;

  for (const line of lines) {
    if (/^\s*(?:\d+[.)]|[-*\u2022])\s+/.test(line)) {
      numberedSteps += 1;
      droppingExtraStep = numberedSteps > maximumSteps;
    } else if (
      droppingExtraStep &&
      (/^\s*#{1,6}\s+/.test(line) ||
        /^\s*Supporting video guidance is shown below\.?\s*$/i.test(line))
    ) {
      droppingExtraStep = false;
    }

    if (!droppingExtraStep) {
      kept.push(line);
    }
  }

  return kept.join("\n");
}
