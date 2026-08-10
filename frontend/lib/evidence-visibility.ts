export type ResponsePhase =
  | "thinking"
  | "streaming"
  | "finalizing"
  | "revealing-media"
  | "loading-media"
  | "ready";

export function responsePhaseForWriting(
  isAnswerStreaming: boolean,
  hasWrittenAnswer: boolean,
  hasEvidence: boolean
): ResponsePhase {
  if (isAnswerStreaming) {
    return hasWrittenAnswer ? "streaming" : "thinking";
  }
  return hasEvidence ? "finalizing" : "ready";
}

export function mountsMediaWorkspace(phase: ResponsePhase) {
  return ["revealing-media", "loading-media", "ready"].includes(phase);
}

export function expandsMediaWorkspace(phase: ResponsePhase) {
  return phase === "loading-media" || phase === "ready";
}

export function showsRealMedia(phase: ResponsePhase) {
  return phase === "ready";
}

export function shouldRenderEvidenceWorkspace({
  status,
  answerable,
  retrievalDecision,
  renderMediaWorkspace,
  hasMedia,
  hasCitations,
}: {
  status?: "answered" | "abstained";
  answerable?: boolean;
  retrievalDecision?: "retrieve_new_source" | "continue_current_evidence";
  renderMediaWorkspace?: boolean;
  hasMedia: boolean;
  hasCitations: boolean;
}) {
  if (status === "abstained" || answerable === false) {
    return false;
  }
  if (retrievalDecision === "continue_current_evidence") {
    return false;
  }
  if (renderMediaWorkspace === false) {
    return false;
  }
  return hasMedia && hasCitations;
}
