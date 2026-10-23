/** Public timing contract: numeric metrics only, never prompts or model payloads. */
import { z } from "zod";

export const stageLabels: Record<string, string> = {
  backend_headers: "Backend processing to response headers",
  "backend.round_trip": "Backend round trip (including network)",
  "chat.create": "Conversation creation",
  "chat.history_load": "Conversation loading",
  "chat.history_lookup": "Conversation lookup",
  "chat.message_validation": "Input validation",
  "chat.persistence": "Response saving",
  "chat.request_decode": "Request decoding",
  "chat.session": "Session lookup",
  "chat.title_persistence": "Title saving",
  "evidence.alternative": "Alternative evidence search",
  "evidence.clip": "Evidence clip preparation",
  "evidence.extract": "Evidence extraction (including child stages)",
  "evidence.frames": "Evidence frame extraction",
  "evidence.pipeline": "Evidence pipeline (including child stages)",
  "evidence.transcript": "Transcript extraction",
  "generation.grounding_validation": "Backend grounding validation",
  "generation.local_structured": "Local structured generation",
  "generation.structured": "Structured backend generation",
  "localization.multimodal": "Multimodal localization (including child stages)",
  "localization.transcript": "Transcript window localization",
  "localization.window_features": "Window feature preparation",
  "model.clip_similarity": "CLIP similarity scoring",
  "model.local_provider": "Local model inference",
  "model.text_embedding": "Text embeddings (including cache lookup)",
  "model.text_embedding_inference": "Text embedding inference",
  "model.voyager": "Voyager model inference",
  "qa.total": "Backend question answering (including child stages)",
  "response.claim_parse": "Claim parsing",
  "response.composition": "Answer composition (including child stages)",
  "response.conversational": "Conversational generation",
  "response.evidence_selection": "Evidence relevance assessment",
  "response.general_generation": "General answer generation",
  "response.generation": "Answer generation",
  "response.progressive_delivery": "Progressive answer writing",
  "response.reference_selection": "Medical reference selection",
  "response.verification": "Answer verification",
  "response.verification_parse": "Verification parsing",
  "retrieval.metadata": "Video catalog retrieval",
  "retrieval.transcript": "Transcript retrieval",
  "routing.capabilities": "Model capabilities",
  "routing.context_rewrite": "Context-aware query rewriting",
  "routing.contextualization": "Conversation routing",
  "safety.triage": "Safety triage",
  "transcript.load": "Transcript loading",
  "video.clip_extract": "Video clip extraction",
  "video.download": "On-demand video download",
  "video.frame_decode": "Frame decoding",
  "video.frames": "Frame sampling",
  "video.resolve": "Video resolution/cache lookup",
  "vision.preprocess": "Image preprocessing",
  "vision.total": "Image analysis (including child stages)",
};

export const timingStageSchema = z.object({
  calls: z.number().int().positive(),
  durationMs: z.number().finite().nonnegative(),
  errors: z.number().int().nonnegative(),
  layer: z.enum(["nextjs", "fastapi"]),
  name: z.string().refine((name) => Object.hasOwn(stageLabels, name)),
});
export type TimingStage = z.infer<typeof timingStageSchema>;

export const responseTimingSchema = z.object({
  backendCalls: z.number().int().nonnegative(),
  backendDetailed: z.boolean(),
  firstAnswerMs: z.number().finite().nonnegative().nullable(),
  requestId: z.string().regex(/^[a-fA-F0-9-]{16,36}$/),
  scope: z.literal("server_response"),
  stages: z.array(timingStageSchema),
  status: z.enum(["complete", "error"]),
  totalMs: z.number().finite().nonnegative(),
  version: z.literal(1),
});
export type ResponseTiming = z.infer<typeof responseTimingSchema>;

export function formatTiming(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Accept known numeric metrics only; unknown header text never reaches the UI. */
export function parseBackendTimings(header: string): TimingStage[] {
  const stages: TimingStage[] = [];
  for (const entry of header.slice(0, 12_000).split(",")) {
    const [rawName, ...parameters] = entry.trim().split(";");
    if (!Object.hasOwn(stageLabels, rawName)) {
      continue;
    }
    const params = new Map(
      parameters.map((p) => {
        const [key, value] = p.trim().split("=");
        return [key, value];
      })
    );
    if (!params.has("dur")) {
      continue;
    }
    const numeric = /^\d+(?:\.\d+)?$/;
    const rawDuration = params.get("dur") ?? "";
    if (!numeric.test(rawDuration)) {
      continue;
    }
    const result = timingStageSchema.safeParse({
      calls: params.has("count") ? Number(params.get("count")) : 1,
      durationMs: Number(rawDuration),
      errors: params.has("errors") ? Number(params.get("errors")) : 0,
      layer: "fastapi",
      name: rawName,
    });
    if (result.success) {
      stages.push(result.data);
    }
  }
  return stages;
}

/** Preserve missing stages; aggregate retries, never sum stages into a total. */
export function aggregateTimingStages(stages: TimingStage[]): TimingStage[] {
  const grouped = new Map<string, TimingStage>();
  for (const stage of stages) {
    if (!Object.hasOwn(stageLabels, stage.name)) {
      continue;
    }
    const key = `${stage.layer}:${stage.name}`;
    const previous = grouped.get(key);
    grouped.set(
      key,
      previous
        ? {
            ...previous,
            calls: previous.calls + stage.calls,
            durationMs: previous.durationMs + stage.durationMs,
            errors: previous.errors + stage.errors,
          }
        : { ...stage }
    );
  }
  return [...grouped.values()];
}
