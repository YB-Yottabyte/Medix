/** Convert rendered Markdown into natural text before local speech synthesis. */
export function prepareSpeechText(input: string) {
  return input
    // Drops both citation link forms: the initial answer's clip link and the
    // follow-up's evidence-bundle link. Neither should be read aloud.
    .replace(/\[[^\]]+\]\(#medix-[^)]*\)/g, "")
    .replace(/\[(?:T\d{3}(?:[\s,–-]+T\d{3})*|\d+(?:\s*,\s*\d+)*)\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(?:\*\*|__|`)/g, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
