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

const WELLBEING_PATTERN =
  /^(?:(?:hi|hey|hello|yo|hiya|howdy)(?:\s+(?:there|again|medix))?[\s!.,]+)?(?:how are you(?: doing| today)?|how(?:'s| is) it going|how have you been|are you doing (?:well|okay|ok))[\s?.!]*$/i;

const GRATITUDE_PATTERN =
  /^(?:thanks?|thank\s+you|thx|ty|cheers|appreciate\s+it|got\s+it|ok(?:ay)?|cool|nice|great|perfect|awesome|sounds\s+good|no\s+worries|nevermind|never\s+mind|bye|goodbye|see\s+you)\b[\s!.,]*(?:so\s+much|a\s+lot|again|that\s+(?:was\s+)?(?:helpful|great|useful))?[\s!.,]*$/i;

const CAPABILITY_PATTERN =
  /^(?:so\s+)?(?:what|who|how)\b.{0,40}\b(?:can\s+you\s+do|do\s+you\s+do|are\s+you|is\s+this|does\s+this\s+do|can\s+you\s+help\s+with|are\s+you\s+for)\b[\s?.!]*$|^(?:what'?s\s+this|help|what\s+is\s+medix)\b[\s?.!]*$/i;

const IDENTITY_PATTERN =
  /^(?:what(?:s| is) your name|who are you|what (?:do|should) i call you|(?:tell me )?your name|introduce yourself|are you (?:medix|a bot|an ai))\s*[?.!]*$/i;

/**
 * True for greetings, thanks, sign-offs, and questions about the assistant
 * itself. Deliberately anchored to whole short messages: a turn that merely
 * opens with "hi" and then asks something medical is not small talk.
 */
export function isSmallTalk(message: string): boolean {
  const normalized = message.trim().replace(/[’‘]/g, "'");
  if (!normalized || normalized.split(/\s+/).length > 12) {
    return false;
  }
  return (
    GREETING_PATTERN.test(normalized) ||
    WELLBEING_PATTERN.test(normalized) ||
    GRATITUDE_PATTERN.test(normalized) ||
    CAPABILITY_PATTERN.test(normalized) ||
    IDENTITY_PATTERN.test(normalized.replace(/'/g, ""))
  );
}

export const SMALL_TALK_PROMPT = `You are Medix, an AI assistant for evidence-grounded medical-procedure questions.
If asked your name, say "I’m Medix." Never identify yourself as a speaker from a video.
The latest message is small talk: a greeting, thanks, a sign-off, or a question about what you are.
Reply naturally in one or two sentences, the way an assistant would in chat.
Do not search for a video, do not give medical or procedural guidance, and do not add disclaimers.
If asked what you can do, say briefly that you answer first-aid and medical-procedure questions using verified medical videos, and invite a question.`;

/** Short replies need no network round trip or evidence search. */
export function smallTalkReply(message: string): string | null {
  if (!isSmallTalk(message)) {
    return null;
  }
  const normalized = message.trim().replace(/[’‘']/g, "");
  if (IDENTITY_PATTERN.test(normalized)) {
    return "I’m Medix. What medical question can I help with?";
  }
  if (WELLBEING_PATTERN.test(message.trim())) {
    return "I’m ready to help. What medical question do you have?";
  }
  if (GREETING_PATTERN.test(message.trim())) {
    return "Hey! How can I help with your medical question?";
  }
  if (/^(?:bye|goodbye|see you)/i.test(normalized)) {
    return "See you!";
  }
  if (GRATITUDE_PATTERN.test(message.trim())) {
    return "You’re welcome!";
  }
  return "I’m Medix. I help explain medical procedures using video evidence. What would you like help with?";
}
