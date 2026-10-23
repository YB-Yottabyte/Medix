import type { ChatMessage } from "@/lib/types";

/** Only play medical answers that the existing evidence workflow has checked. */
export function getVerifiedVoiceAnswer(message: ChatMessage | undefined) {
  if (message?.role !== "assistant") {
    return null;
  }

  const hasAnsweredProcedure = message.parts.some(
    (part) =>
      part.type === "tool-searchProcedure" &&
      part.state === "output-available" &&
      part.output.status === "answered" &&
      part.output.answerable
  );
  const hasCitedFollowUp = message.parts.some(
    (part) =>
      part.type === "data-follow-up-evidence" && part.data.cues.length > 0
  );

  if (!(hasAnsweredProcedure || hasCitedFollowUp)) {
    return null;
  }

  const answer = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return answer || null;
}
