import { tool } from "ai";
import { z } from "zod";
import { medixMediaUrl } from "../../medix-media";
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
  claims?: { text: string; citation_ids: string[] }[];
  citations: TranscriptCitation[];
  evidence_context?: TranscriptCitation[];
  visual_observation?: {
    visible_objects?: string[];
    visible_actions?: string[];
  };
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
  groundedClaims?: { text: string; citation_ids: string[] }[];
  medicalSources?: {
    id: string;
    title: string;
    url: string;
    checkedAt: string;
  }[];
  citations: TranscriptCitation[];
  evidenceContext: TranscriptCitation[];
  relatedEvidence?: TranscriptCitation[];
  evidenceRole?: "related";
  imageContext?: string[];
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
  imageBase64?: string;
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
    // Keep validator diagnostics server-side. They are useful for research
    // logs, but are not an appropriate user-facing medical explanation.
    abstentionReason: null,
    // The canonical response is a compact validation artifact, not the
    // user-facing answer. Exposing it for answered results encourages chat
    // models to copy the two-line summary verbatim.
    answer:
      result.status === "abstained" ? publicAbstentionMessage(result) : null,
    answerable: result.status === "answered",
    citations: result.citations,
    confidence: result.confidence ?? null,
    emergencyWarning: result.safety_warning ?? null,
    evidenceContext: result.evidence_context ?? result.citations,
    groundedClaims: result.claims,
    safetyDisposition: result.safety_disposition,
    status: result.status,
    ...(result.visual_observation
      ? {
          imageContext: [
            ...(result.visual_observation.visible_objects ?? []),
            ...(result.visual_observation.visible_actions ?? []),
          ]
            .filter((item) => typeof item === "string")
            .slice(0, 8)
            .map((item) => item.slice(0, 120)),
        }
      : {}),
    clipUrl: medixMediaUrl(result.clip_url),
    endTime: result.end_seconds ?? null,
    evidenceBundleId: result.evidence_bundle_id ?? null,
    followUpQuestion: null,
    matchedProcedure: result.video_id ? result.query : null,
    queryWasContextualized,
    renderMediaWorkspace:
      result.status === "answered" &&
      Boolean(result.clip_url || result.video_id) &&
      (result.evidence_context ?? result.citations).length > 0,
    responseInstructions:
      result.status === "answered"
        ? "Compose a direct, conversational answer from verified video cues and any checked medical references supplied by the response layer. Adapt detail to the question. Attach clip-relative timestamps only to video-supported claims; identify additional guidance with its checked source link. Never invent missing medical facts or citations."
        : "Explain the abstention without inventing missing medical guidance.",
    retrievalDecision: "retrieve_new_source" as const,
    retrievalQuery,
    sourceRetrievalQuery: retrievalQuery,
    startTime: result.start_seconds ?? null,
    videoId: result.video_id ?? null,
    videoUrl: result.video_url ?? null,
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
    followUpQuestion: followUpQuestion.trim() || null,
    queryWasContextualized: true,
    renderMediaWorkspace: false,
    responseInstructions:
      "Answer the latest follow-up using only evidenceContext and citations from this current source, as a short chat reply with no heading or closing line. Keep the same evidence bundle, selected video, clip, and timestamps. Do not repeat the full original procedure unless the user asks. If these cues cannot support the answer, state that the current video does not cover the follow-up and offer to search the supported video collection. Do not search another source unless the user asks for one.",
    retrievalDecision: "continue_current_evidence",
    retrievalQuery: sourceRetrievalQuery,
    sourceRetrievalQuery,
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

      const retrievalQuery = options.retrievalQuery?.trim() || query.trim();

      try {
        const result = await fetchMedixJson<ProcedureResponse>(
          options.imageBase64 ? "/api/multimodal/query" : "/api/query",
          {
            body: JSON.stringify({
              query: retrievalQuery,
              ...(options.imageBase64
                ? { image_base64: options.imageBase64 }
                : {}),
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }
        );
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
        console.warn("Procedure search failed:", error);
        const connectionFailed =
          error instanceof Error &&
          error.message.includes("Unable to reach the Medix backend");
        return toProcedureToolOutput(
          {
            citations: [],
            confidence: null,
            pipeline: "canonical-medix",
            query: retrievalQuery,
            response: connectionFailed
              ? "The evidence server is unavailable or the request timed out. Check that the Sol backend and SSH tunnel are running, then retry. No procedure answer was verified."
              : options.imageBase64
                ? "I could not complete image processing or retrieve verified evidence right now. Please try again. I cannot provide procedure guidance without verified evidence."
                : "I could not retrieve verified evidence right now. Please try again. I cannot provide procedure guidance without it.",
            safety_disposition: "supported",
            status: "abstained",
          },
          retrievalQuery,
          options.queryWasContextualized ?? false
        );
      }
    },
    inputSchema: z.object({
      action: z
        .enum(["continue_current_evidence", "search_new_source"])
        .default("continue_current_evidence")
        .describe(
          "Continue with the active video by default; search_new_source requires a clear topic change or an explicit user request for another source"
        ),
      query: z
        .string()
        .min(3)
        .max(500)
        .describe(
          "The current follow-up when reusing evidence, or a standalone conversation-summary query when searching a new source"
        ),
    }),
  });
}

export const searchProcedure = createSearchProcedureTool();
