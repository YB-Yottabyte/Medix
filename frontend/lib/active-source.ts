import type { ChatMessage } from "./types";

type ProcedureOutput = {
  status?: string;
  videoId?: string | null;
  evidenceBundleId?: string | null;
  matchedProcedure?: string | null;
  retrievalQuery?: string;
  sourceRetrievalQuery?: string;
};

/**
 * Mirrors the server's backward scan (buildConversationContext) for the most
 * recent answered EvidenceBundle, so the interface can name the source that a
 * follow-up would reuse. A newer abstention clears the label rather than
 * reviving stale evidence, matching the server's behaviour.
 */
export function activeSourceLabel(messages: ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    for (const part of [...(message.parts ?? [])].reverse()) {
      if (part.type !== "tool-searchProcedure" || !("output" in part)) {
        continue;
      }
      const output = part.output as ProcedureOutput | undefined;
      if (!output?.status) {
        continue;
      }
      if (
        output.status !== "answered" ||
        !(output.videoId && output.evidenceBundleId)
      ) {
        return null;
      }
      const label =
        output.sourceRetrievalQuery ||
        output.retrievalQuery ||
        output.matchedProcedure;
      return label?.trim() || null;
    }
  }
  return null;
}
