import type { InferUIMessageChunk } from "ai";
import type { PerformanceTrace } from "./performance";
import {
  aggregateTimingStages,
  type ResponseTiming,
  stageLabels,
} from "./response-timing-data";
import type { ChatMessage } from "./types";

export function responseTimingSnapshot(
  trace: PerformanceTrace
): ResponseTiming {
  const snapshot = trace.snapshot();
  return {
    backendCalls: trace.backendTimings.length,
    backendDetailed: trace.backendTimings.some((call) =>
      call.some((stage) => stage.name !== "backend_headers")
    ),
    firstAnswerMs: trace.first_answer_ms,
    requestId: trace.request_id,
    scope: "server_response",
    stages: aggregateTimingStages([
      ...snapshot.spans
        .filter((span) => Object.hasOwn(stageLabels, span.name))
        .map((span) => ({
          calls: 1,
          durationMs: span.duration_ms,
          errors: span.status === "error" ? 1 : 0,
          layer: "nextjs" as const,
          name: span.name,
        })),
      ...trace.backendTimings.flat(),
    ]),
    status: trace.failed ? "error" : "complete",
    totalMs: snapshot.total_ms,
    version: 1,
  };
}

/** Append before SSE [DONE], after generation, merged streams and response saving.
 * A data part is tied to this assistant message, not a shared/global timer.
 */
export function withResponseTiming(
  stream: ReadableStream<InferUIMessageChunk<ChatMessage>>,
  trace: PerformanceTrace | undefined,
  saveTiming?: (timing: ResponseTiming) => Promise<void>
): ReadableStream<InferUIMessageChunk<ChatMessage>> {
  if (!trace) {
    return stream;
  }
  return stream.pipeThrough(
    new TransformStream({
      async flush(controller) {
        const timing = responseTimingSnapshot(trace);
        try {
          await saveTiming?.(timing);
        } catch {
          // Optional research metadata must never break a medical response.
          console.warn("Response timing could not be saved");
        }
        controller.enqueue({
          data: timing,
          id: trace.request_id,
          type: "data-performance",
        });
      },
      transform(chunk, controller) {
        if (chunk.type === "text-delta" && chunk.delta.length > 0) {
          trace.first_answer_ms ??= trace.elapsed();
        }
        if (chunk.type === "error" || chunk.type === "abort") {
          trace.failed = true;
        }
        controller.enqueue(chunk);
      },
    })
  );
}
