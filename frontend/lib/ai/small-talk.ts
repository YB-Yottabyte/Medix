/**
 * Conversational turns that must never reach medical video retrieval.
 *
 * Med-PaLM 2's evaluation penalises answers that include content they should
 * not (§3.5, "inclusion of irrelevant content"). Turning "hi" into procedure
 * guidance is exactly that failure, so these are settled deterministically
 * before any retrieval or grounding decision.
 */
const GREETING_PATTERN =
  /^(?:hi|hey|hello|yo|hiya|howdy|good\s+(?:morning|afternoon|evening)|greetings)(?:\s+(?:there|again|medix))?\b[\s!.,]*$/i;

const GRATITUDE_PATTERN =
  /^(?:thanks?|thank\s+you|thx|ty|cheers|appreciate\s+it|got\s+it|ok(?:ay)?|cool|nice|great|perfect|awesome|sounds\s+good|no\s+worries|nevermind|never\s+mind|bye|goodbye|see\s+you)\b[\s!.,]*(?:so\s+much|a\s+lot|again|that\s+(?:was\s+)?(?:helpful|great|useful))?[\s!.,]*$/i;

const CAPABILITY_PATTERN =
  /^(?:so\s+)?(?:what|who|how)\b.{0,40}\b(?:can\s+you\s+do|do\s+you\s+do|are\s+you|is\s+this|does\s+this\s+do|can\s+you\s+help\s+with|are\s+you\s+for)\b[\s?.!]*$|^(?:what'?s\s+this|help|what\s+is\s+medix)\b[\s?.!]*$/i;

/**
 * True for greetings, thanks, sign-offs, and questions about the assistant
 * itself. Deliberately anchored to whole short messages: a turn that merely
 * opens with "hi" and then asks something medical is not small talk.
 */
export function isSmallTalk(message: string): boolean {
  const normalized = message.trim();
  if (!normalized || normalized.split(/\s+/).length > 12) {
    return false;
  }
  return (
    GREETING_PATTERN.test(normalized) ||
    GRATITUDE_PATTERN.test(normalized) ||
    CAPABILITY_PATTERN.test(normalized)
  );
}

export const SMALL_TALK_PROMPT = `The latest message is small talk: a greeting, thanks, a sign-off, or a question about what you are.
Reply naturally in one or two sentences, the way an assistant would in chat.
Do not search for a video, do not give medical or procedural guidance, and do not add disclaimers.
If asked what you can do, say briefly that you answer first-aid and medical-procedure questions using verified medical videos, and invite a question.`;
