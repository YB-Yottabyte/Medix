/** Checked summaries, not model memory. Add sources with explicit scope and review dates.
 * No request-time browsing, arbitrary URL fetching, or vector database is required.
 */
export type MedicalReference = {
  id: string;
  title: string;
  url: string;
  checkedAt: string;
  scope: string;
  summary: string;
  topics: RegExp;
  exclude?: RegExp;
  /** Optional source-authored applicability rules for numbered sentences.
   * Unrestricted sentences (including core safety) remain available. */
  passageApplicability?: Record<number, RegExp>;
};

export const MEDICAL_REFERENCES: readonly MedicalReference[] = [
  {
    checkedAt: "2026-10-15",
    exclude:
      /\b(?:cast|post[ -]?operat\w*|surg\w*|compression (?:therapy|stocking)|venous|ulcer)\b/i,
    id: "K001",
    passageApplicability: {
      4: /\b(?:cuts?|wounds?|bleed\w*|loss of feeling|can.t move|cannot move)\b/i,
      5: /\b(?:infect\w*|pus|red\w*|swell\w*|pain\w*|wounds?)\b/i,
    },
    scope:
      "First-aid dressings for cuts; not casts, surgical dressings, or prescribed compression therapy.",
    summary:
      "Check circulation beyond a bandage every 10 minutes. Press skin beyond it for 5 seconds until pale; colour should return within 2 seconds after releasing. If not, loosen the bandage slightly. A cut with loss of feeling, difficulty moving, bleeding that cannot be stopped, or spurting bright-red blood needs emergency care. Wounds becoming red, swollen and increasingly painful, or producing pus, need urgent medical assessment.",
    title: "NHS: Cuts and grazes",
    topics: /\b(?:bandag\w*|dressing|cuts?|wounds?|bleeding)\b/i,
    url: "https://www.nhs.uk/conditions/cuts-and-grazes/",
  },
  {
    checkedAt: "2026-10-15",
    exclude:
      /\b(?:cast|post[ -]?operat\w*|surg\w*|tourniquet|compression (?:therapy|stocking)|venous|ulcer)\b/i,
    id: "K002",
    scope:
      "First aid for bleeding wounds with an ordinary dressing and bandage; no tourniquet instructions.",
    summary:
      "A bandage securing a bleeding-wound dressing should maintain pressure without restricting circulation. Press a nail or skin beyond the bandage for five seconds, release, and check for colour returning within two seconds. If needed, loosen and reapply the bandage. Recheck circulation every 10 minutes. Severe bleeding requires emergency help and firm direct pressure with a sterile dressing or clean non-fluffy cloth. Do not remove an embedded object: press either side instead.",
    title: "St John Ambulance: Severe bleeding",
    topics: /\b(?:bleed\w*|wounds?|cuts?|dressing)\b/i,
    url: "https://www.sja.org.uk/first-aid-advice/severe-bleeding/",
  },
  {
    checkedAt: "2026-10-15",
    id: "K003",
    scope:
      "Thermal burns and scalds. Chemical and electrical burns require emergency care; do not apply thermal-burn timings to chemicals.",
    summary:
      "Cool a thermal burn under cool running water for 20 minutes, as soon as possible within three hours. Remove nearby clothing or jewellery only if not stuck to the skin. After cooling, lay cling film over it rather than wrapping it around. Do not apply creams, oils or butter, use sticky dressings, or burst blisters. Very large or deep burns, burns to the face, genitals or bottom, and chemical or electrical burns require emergency care. Seek medical advice if unsure what to do, particularly for a child under five.",
    title: "NHS: Burns and scalds",
    topics: /\b(?:burn\w*|scald\w*)\b/i,
    url: "https://www.nhs.uk/conditions/burns-and-scalds/",
  },
  {
    checkedAt: "2026-10-21",
    exclude:
      /\b(?:cast|post[ -]?operat\w*|surg\w*|tourniquet|compression (?:therapy|stocking)|venous|ulcer)\b/i,
    id: "K004",
    scope:
      "Ordinary first-aid limb bandages, including joint support and dressings; not casts, surgical dressings or prescribed compression therapy.",
    summary:
      "A bandage that is wrapped too tightly can restrict circulation. It should provide firm support or hold a dressing without doing this. Leaving fingers and toes uncovered makes it possible to check circulation beyond the bandage. After tying it, press a finger or toe for five seconds until pale, then release; if colour does not return after two seconds, reapply the bandage more loosely. Check circulation every 10 minutes.",
    title: "St John Ambulance: Bandages",
    topics: /\b(?:bandag\w*|dressing)\b/i,
    url: "https://www.sja.org.uk/first-aid-advice/bandage-dressing/",
  },
  {
    checkedAt: "2026-10-15",
    exclude:
      /\b(?:cast|post[ -]?operat\w*|surg\w*|tourniquet|compression (?:therapy|stocking)|venous|ulcer)\b/i,
    id: "K005",
    passageApplicability: {
      2: /\b(?:misshapen|deform\w*|odd angle|fractur\w*|broken|fall|fell|collision)\b/i,
      3: /\b(?:pain\w*|swell\w*|swollen|bruis\w*|mov\w*|not improving|wors\w*)\b/i,
    },
    scope:
      "Warning signs after a limb injury; not a diagnosis of a sprain, fracture or circulation disorder. Use conditionally if an injury is not established.",
    summary:
      "After an injury, numbness, tingling or pins and needles, or skin becoming blue, grey or cold to touch, require emergency assessment. An injured part that is misshapen or at an odd angle also needs emergency assessment. Seek urgent medical advice for severe or worsening pain, large or worsening swelling or bruising, difficulty moving, or symptoms not improving with self-care. Warning signs do not establish a diagnosis.",
    title: "NHS: Injury warning signs",
    topics:
      /\b(?:bandag\w*|injur\w*|sprain\w*|strain\w*|numb\w*|tingl\w*|swelling)\b/i,
    url: "https://www.nhs.uk/conditions/sprains-and-strains/",
  },
];

/** Context resolves elliptical follow-ups only; an explicit new topic wins. */
export function retrieveMedicalReferences(
  question: string,
  activeQuestion = "",
  now = new Date()
) {
  const direct = MEDICAL_REFERENCES.filter((source) =>
    source.topics.test(question)
  );
  const explicitOtherTopic =
    /\b(?:aed|cpr|defibrillator|sinus|choking|heimlich|seizure|stroke|fracture|poisoning|overdose)\b/i.test(
      question
    );
  const query =
    direct.length || explicitOtherTopic
      ? question
      : `${activeQuestion}\n${question}`;
  return MEDICAL_REFERENCES.filter((source) => {
    const ageDays = (now.getTime() - Date.parse(source.checkedAt)) / 86_400_000;
    return (
      ageDays >= 0 &&
      ageDays <= 180 &&
      source.topics.test(query) &&
      !source.exclude?.test(`${activeQuestion}\n${question}`)
    );
  }).slice(0, 3);
}

/** Numbered, extractive passages keep source selection separate from generation. */
export function medicalPassages(source: MedicalReference): string[] {
  return source.summary
    .split(/(?<=[.!?])\s+/)
    .map((text) => text.trim())
    .filter(Boolean);
}

export function medicalPassageContext(
  sources: readonly MedicalReference[]
): string {
  return sources
    .map(
      (source) =>
        `${source.id} — ${source.title}\nScope: ${source.scope}\n${medicalPassages(
          source
        )
          .map((text, index) => `  ${index + 1}: ${text}`)
          .join("\n")}`
    )
    .join("\n\n");
}

/** undefined means a legacy selector omitted the field; null rejects malformed or
 * invented selections. Text is always extracted from the checked source itself. */
export function selectedMedicalPassages(
  value: unknown,
  sources: readonly MedicalReference[]
): MedicalReference[] | undefined | null {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const selected = new Map<string, Set<number>>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const { id, sentences } = entry as { id?: unknown; sentences?: unknown };
    const source = sources.find((item) => item.id === id);
    if (!source || !Array.isArray(sentences) || sentences.length === 0) {
      return null;
    }
    const passages = medicalPassages(source);
    const indexes = selected.get(source.id) ?? new Set<number>();
    for (const sentence of sentences) {
      if (
        !Number.isInteger(sentence) ||
        sentence < 1 ||
        sentence > passages.length
      ) {
        return null;
      }
      const index = sentence - 1;
      indexes.add(index);
      // Keep the antecedent of a selected anaphoric condition such as "If not".
      if (
        index > 0 &&
        /^(?:if (?:not|so)|this\b|these\b|those\b|it\b|then\b)/i.test(
          passages[index]
        )
      ) {
        indexes.add(index - 1);
      }
    }
    selected.set(source.id, indexes);
  }
  return sources.flatMap((source) => {
    const indexes = selected.get(source.id);
    if (!indexes) {
      return [];
    }
    const passages = medicalPassages(source);
    return [
      {
        ...source,
        summary: [...indexes]
          .sort((a, b) => a - b)
          .map((index) => passages[index])
          .join(" "),
      },
    ];
  });
}

/** Apply source-authored applicability before generation. This selects evidence,
 * never deletes clauses from a generated medical answer. Complete source sentences
 * and their anaphoric antecedents remain intact. Core safety has no restrictive rule. */
export function scopeMedicalReferences(
  sources: readonly MedicalReference[],
  question: string,
  activeQuestion = ""
): MedicalReference[] {
  const explicitTopic = sources.some((source) => source.topics.test(question));
  const context = explicitTopic ? question : `${activeQuestion}\n${question}`;
  return sources.flatMap((source) => {
    if (!source.passageApplicability) {
      return [source];
    }
    const passages = medicalPassages(source);
    const indexes = new Set(
      passages.flatMap((_, index) => {
        const rule = source.passageApplicability?.[index + 1];
        return !rule || rule.test(context) ? [index] : [];
      })
    );
    for (const index of [...indexes]) {
      if (
        index > 0 &&
        /^(?:if (?:not|so)|this|these|those|it|then)\b/i.test(passages[index])
      ) {
        indexes.add(index - 1);
      }
    }
    const { passageApplicability, ...scoped } = source;
    return indexes.size
      ? [
          {
            ...scoped,
            summary: [...indexes]
              .sort((a, b) => a - b)
              .map((index) => passages[index])
              .join(" "),
          },
        ]
      : [];
  });
}
