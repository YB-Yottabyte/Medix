import { type MedicalReference, medicalPassages } from "./medical-knowledge";

export type ClaimPassage = { sourceId: string; sentence: number };

/** Resolve reviewer-selected sentence addresses to source text, never model-written quotes.
 * Omission supports older verifier payloads; a supplied invalid selection fails closed. */
export function resolveClaimPassages(
  selected: ClaimPassage[] | undefined,
  sourceIds: readonly string[],
  sources: ReadonlyMap<string, MedicalReference>
): string | null | undefined {
  if (selected === undefined) {
    return;
  }
  if (
    !selected.length ||
    sourceIds.some((id) => !selected.some((item) => item.sourceId === id))
  ) {
    return null;
  }
  const passages: string[] = [];
  for (const item of selected) {
    const source = sources.get(item.sourceId);
    if (
      !source ||
      !sourceIds.includes(item.sourceId) ||
      !Number.isInteger(item.sentence)
    ) {
      return null;
    }
    const passage = medicalPassages(source)[item.sentence - 1];
    if (!passage) {
      return null;
    }
    if (
      /^(?:if not|this|these|those|it|then)\b/i.test(passage) &&
      item.sentence > 1
    ) {
      const previous = medicalPassages(source)[item.sentence - 2];
      if (!passages.includes(previous)) {
        passages.push(previous);
      }
    }
    if (!passages.includes(passage)) {
      passages.push(passage);
    }
  }
  return passages.join(" ");
}

/** A blanket urgency cannot be justified by passages that assign different levels.
 * The semantic verifier must still check each condition and its applicability. */
export function preservesEscalationLevel(
  claim: string,
  passages: string
): boolean {
  const levels = (value: string) => ({
    emergency: /\b(?:emergency|999|911)\b|A&E/i.test(value),
    urgent: /\burgent\b/i.test(value),
  });
  const proposed = levels(claim);
  const source = levels(passages);
  if (proposed.emergency && !source.emergency) {
    return false;
  }
  if (proposed.urgent && !source.urgent) {
    return false;
  }
  if (proposed.emergency && !proposed.urgent && source.urgent) {
    return false;
  }
  if (proposed.urgent && !proposed.emergency && source.emergency) {
    return false;
  }
  return true;
}
