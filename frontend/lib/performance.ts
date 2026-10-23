/** Request-scoped server timings; never persist prompts, images, answers or identity. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { TimingStage } from "./response-timing-data";

type Span = {
  span_id: string;
  parent_id: string | null;
  name: string;
  start_ms: number;
  duration_ms: number;
  status: string;
};
export class PerformanceTrace {
  readonly request_id: string;
  readonly started_at = new Date().toISOString();
  readonly started = performance.now();
  spans: Span[] = [];
  counters: Record<string, number> = {};
  first_answer_ms: number | null = null;
  first_response_byte_ms: number | null = null;
  backendTimings: TimingStage[][] = [];
  failed = false;
  route = "/api/chat";
  constructor(requestId = randomUUID()) {
    this.request_id = requestId;
  }
  elapsed() {
    return performance.now() - this.started;
  }
  snapshot(status = "ok", httpStatus = 200) {
    const spans = this.spans.map((s) => {
      let covered = 0,
        end = s.start_ms;
      const children = this.spans
        .filter((c) => c.parent_id === s.span_id)
        .sort((a, b) => a.start_ms - b.start_ms);
      for (const c of children) {
        const right = Math.min(
          s.start_ms + s.duration_ms,
          c.start_ms + c.duration_ms
        );
        covered += Math.max(0, right - Math.max(end, c.start_ms, s.start_ms));
        end = Math.max(end, right);
      }
      return { ...s, exclusive_ms: Math.max(0, s.duration_ms - covered) };
    });
    return {
      backend_timings: this.backendTimings,
      counters: this.counters,
      first_answer_ms: this.first_answer_ms,
      first_response_byte_ms: this.first_response_byte_ms,
      http_status: httpStatus,
      layer: "frontend",
      request_id: this.request_id,
      route: this.route,
      schema_version: 1,
      spans,
      started_at: this.started_at,
      status: this.failed ? "error" : status,
      total_ms: this.elapsed(),
    };
  }
}
const context = new AsyncLocalStorage<{
  trace: PerformanceTrace;
  parent: string | null;
}>();
export function currentPerformanceTrace() {
  return context.getStore()?.trace;
}
export function performanceCount(name: string, amount = 1) {
  const t = currentPerformanceTrace();
  if (t) {
    t.counters[name] = (t.counters[name] ?? 0) + amount;
  }
}
export async function measureAsync<T>(
  name: string,
  operation: () => PromiseLike<T> | T
): Promise<T> {
  const state = context.getStore();
  if (!state) {
    return await operation();
  }
  const start = state.trace.elapsed(),
    id = randomUUID();
  let status = "ok";
  try {
    return await context.run({ parent: id, trace: state.trace }, operation);
  } catch (e) {
    status = "error";
    throw e;
  } finally {
    state.trace.spans.push({
      duration_ms: state.trace.elapsed() - start,
      name,
      parent_id: state.parent,
      span_id: id,
      start_ms: start,
      status,
    });
  }
}
export function measureSync<T>(name: string, operation: () => T): T {
  const state = context.getStore();
  if (!state) {
    return operation();
  }
  const start = state.trace.elapsed(),
    id = randomUUID();
  let status = "ok";
  try {
    return context.run({ parent: id, trace: state.trace }, operation);
  } catch (e) {
    status = "error";
    throw e;
  } finally {
    state.trace.spans.push({
      duration_ms: state.trace.elapsed() - start,
      name,
      parent_id: state.parent,
      span_id: id,
      start_ms: start,
      status,
    });
  }
}
export function runWithPerformance<T>(
  trace: PerformanceTrace,
  operation: () => T
): T {
  return context.run({ parent: null, trace }, operation);
}
export async function persistPerformance(
  trace: PerformanceTrace,
  status: string,
  httpStatus: number
) {
  const file =
    process.env.MEDIX_PERFORMANCE_LOG ??
    path.resolve(
      process.cwd(),
      process.cwd().endsWith("/frontend")
        ? "../data/performance/frontend.jsonl"
        : "data/performance/frontend.jsonl"
    );
  const snapshot = trace.snapshot(status, httpStatus);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  } catch {
    console.warn("Performance record could not be persisted");
  }
}
/** Wrap the response stream, so total_ms ends at completion/cancellation, not header creation. */
export async function withPerformanceRequest(
  _request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  if (/^(0|false|off)$/i.test(process.env.MEDIX_PERFORMANCE_ENABLED ?? "1")) {
    return handler();
  }
  const trace = new PerformanceTrace();
  let finished = false;
  const finish = async (status: string, code: number) => {
    if (!finished) {
      finished = true;
      await persistPerformance(trace, status, code);
    }
  };
  return runWithPerformance(trace, async () => {
    try {
      const response = await handler();
      const headers = new Headers(response.headers);
      headers.set("x-medix-request-id", trace.request_id);
      if (!response.body) {
        await finish(response.ok ? "ok" : "error", response.status);
        return new Response(null, { headers, status: response.status });
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let tail = "";
      const body = new ReadableStream<Uint8Array>({
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            await finish("cancelled", response.status);
          }
        },
        pull(controller) {
          return runWithPerformance(trace, async () => {
            try {
              const result = await reader.read();
              if (result.done) {
                await finish(response.ok ? "ok" : "error", response.status);
                controller.close();
                return;
              }
              trace.first_response_byte_ms ??= trace.elapsed();
              // Parse only event type; buffered text is never written to the trace.
              tail = (
                tail + decoder.decode(result.value, { stream: true })
              ).slice(-8192);
              if (/"type"\s*:\s*"text-delta"/.test(tail)) {
                trace.first_answer_ms ??= trace.elapsed();
              }
              controller.enqueue(result.value);
            } catch (error) {
              await finish("error", response.status);
              controller.error(error);
            }
          });
        },
      });
      return new Response(body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (error) {
      await finish("error", 500);
      throw error;
    }
  });
}
