import { tool } from "ai";
import { z } from "zod";
import { fetchMedixJson } from "./medix-api-client";

export type TranscriptCitation = {
  cue_id: string;
  start_seconds: number;
  end_seconds: number;
  clip_start_seconds?: number;
  clip_end_seconds?: number;
  text: string;
};

export type ProcedureResponse = {
  pipeline: "canonical-medix";
  query: string;
  response: string;
  status: "answered" | "abstained";
  confidence: number | null;
  abstention_reason?: string | null;
  safety_disposition: "supported" | "emergency" | "restricted";
  safety_warning?: string | null;
  citations: TranscriptCitation[];
  evidence_context?: TranscriptCitation[];
  evidence_bundle_id?: string | null;
  video_id?: string | null;
  video_url?: string | null;
  clip_url?: string | null;
  start_seconds?: number | null;
  end_seconds?: number | null;
};

export type ProcedureToolOutput = {
  answer: string | null;
  status: "answered" | "abstained";
  answerable: boolean;
  confidence: number | null;
  abstentionReason: string | null;
  emergencyWarning: string | null;
  safetyDisposition: "supported" | "emergency" | "restricted";
  citations: TranscriptCitation[];
  evidenceContext: TranscriptCitation[];
  evidenceBundleId: string | null;
  videoId: string | null;
  videoUrl: string | null;
  clipUrl: string | null;
  startTime: number | null;
  endTime: number | null;
  matchedProcedure: string | null;
  retrievalQuery: string;
  sourceRetrievalQuery: string;
  queryWasContextualized: boolean;
  retrievalDecision: "retrieve_new_source" | "continue_current_evidence";
  followUpQuestion: string | null;
  renderMediaWorkspace: boolean;
  responseInstructions: string;
};

type SearchProcedureOptions = {
  retrievalQuery?: string;
  queryWasContextualized?: boolean;
  activeEvidence?: ProcedureToolOutput | null;
  continueCurrentEvidenceFirst?: boolean;
  followUpQuestion?: string;
};

function publicAbstentionMessage(result: ProcedureResponse) {
  const response = result.response
    .replace(/\bT\d{3}\b/g, "")
    .replace(
      /^.*(?:generation output failed|grounding validation|lexical support).*$/gim,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return response &&
    !/(?:generation output failed|grounding validation|lexical support)/i.test(
      response
    )
    ? response
    : "The available transcript does not provide enough verified evidence to answer that safely.";
}

export function toProcedureToolOutput(
  result: ProcedureResponse,
  retrievalQuery: string,
  queryWasContextualized = false
): ProcedureToolOutput {
  return {
    // The canonical response is a compact validation artifact, not the
    // user-facing answer. Exposing it for answered results encourages chat
    // models to copy the two-line summary verbatim.
    answer:
      result.status === "abstained" ? publicAbstentionMessage(result) : null,
    status: result.status,
    answerable: result.status === "answered",
    confidence: result.confidence ?? null,
    // Keep validator diagnostics server-side. They are useful for research
    // logs, but are not an appropriate user-facing medical explanation.
    abstentionReason: null,
    emergencyWarning: result.safety_warning ?? null,
    safetyDisposition: result.safety_disposition,
    citations: result.citations,
    evidenceContext: result.evidence_context ?? result.citations,
    evidenceBundleId: result.evidence_bundle_id ?? null,
    videoId: result.video_id ?? null,
    videoUrl: result.video_url ?? null,
    clipUrl: result.clip_url ?? null,
    startTime: result.start_seconds ?? null,
    endTime: result.end_seconds ?? null,
    matchedProcedure: result.video_id ? result.query : null,
    retrievalQuery,
    sourceRetrievalQuery: retrievalQuery,
    queryWasContextualized,
    retrievalDecision: "retrieve_new_source" as const,
    followUpQuestion: null,
    renderMediaWorkspace:
      result.status === "answered" &&
      Boolean(result.clip_url || result.video_id) &&
      (result.evidence_context ?? result.citations).length > 0,
    responseInstructions:
      result.status === "answered"
        ? "Write the user-facing answer in the normal assistant text response, as a chat reply rather than a report. Open by directly answering what was asked. Add a short numbered list only if the answer is genuinely a sequence, at most four items. No heading, no title, no closing summary line. Use bold at most once or twice for a real warning or critical action. End each evidence-supported statement with a clip-relative timestamp citation on the same line. Say plainly what the video does not cover instead of filling gaps."
        : "Explain the abstention without inventing missing medical guidance.",
  };
}

export function toContinuedProcedureToolOutput(
  activeEvidence: ProcedureToolOutput,
  followUpQuestion: string
): ProcedureToolOutput {
  const sourceRetrievalQuery =
    activeEvidence.sourceRetrievalQuery || activeEvidence.retrievalQuery;
  const evidenceContext =
    activeEvidence.evidenceContext.length > 0
      ? activeEvidence.evidenceContext
      : activeEvidence.citations;
  return {
    ...activeEvidence,
    answer: null,
    citations: evidenceContext,
    evidenceContext,
    retrievalQuery: sourceRetrievalQuery,
    sourceRetrievalQuery,
    queryWasContextualized: true,
    retrievalDecision: "continue_current_evidence",
    followUpQuestion: followUpQuestion.trim() || null,
    renderMediaWorkspace: false,
    responseInstructions:
      "Answer the latest follow-up using only evidenceContext and citations from this current source, as a short chat reply with no heading or closing line. Keep the same evidence bundle, selected video, clip, and timestamps. Do not repeat the full original procedure unless the user asks. If these cues cannot support the answer, state that the current video does not cover the follow-up and offer to search the supported video collection. Do not search another source unless the user asks for one.",
  };
}

export function createSearchProcedureTool(
  options: SearchProcedureOptions = {}
) {
  let currentEvidencePresented = false;

  const reuseCurrentEvidence = (): ProcedureToolOutput | null => {
    if (!options.activeEvidence) {
      return null;
    }
    return toContinuedProcedureToolOutput(
      options.activeEvidence,
      options.followUpQuestion ?? ""
    );
  };

  return tool({
    description:
      "Use verified Medix procedure evidence. Continue with the current evidence for same-procedure follow-ups; search a new source only for a clear topic change or when the user explicitly asks for another video or source.",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(500)
        .describe(
          "The current follow-up when reusing evidence, or a standalone conversation-summary query when searching a new source"
        ),
      action: z
        .enum(["continue_current_evidence", "search_new_source"])
        .default("continue_current_evidence")
        .describe(
          "Continue with the active video by default; search_new_source requires a clear topic change or an explicit user request for another source"
        ),
    }),
    execute: async ({ query, action }) => {
      if (options.continueCurrentEvidenceFirst && !currentEvidencePresented) {
        currentEvidencePresented = true;
        const reused = reuseCurrentEvidence();
        if (reused) {
          return reused;
        }
      }

      if (action === "continue_current_evidence") {
        const reused = reuseCurrentEvidence();
        if (reused) {
          return reused;
        }
      }

      const retrievalQuery =
        action === "search_new_source"
          ? query.trim()
          : options.retrievalQuery?.trim() || query.trim();

      try {
        const result = await fetchMedixJson<ProcedureResponse>("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: retrievalQuery }),
        });
        const output = toProcedureToolOutput(
          result,
          retrievalQuery,
          options.queryWasContextualized ?? false
        );
        return {
          ...output,
          followUpQuestion: options.followUpQuestion?.trim() || null,
          responseInstructions: options.activeEvidence
            ? `${output.responseInstructions} Explain that the current video did not cover the follow-up and that additional verified evidence was searched before presenting this new source.`
            : output.responseInstructions,
        };
      } catch (error: unknown) {
        return {
          error:
            error instanceof Error ? error.message : "Procedure search failed",
          retrievalQuery,
        };
      }
    },
  });
}

export const searchProcedure = createSearchProcedureTool();
