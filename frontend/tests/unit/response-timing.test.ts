import assert from "node:assert/strict";
import test from "node:test";
import {
  createUIMessageStream,
  type InferUIMessageChunk,
  readUIMessageStream,
} from "ai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ResponseTimingDetails,
  ResponseTimingPanel,
} from "../../components/chat/response-timing";
import { fetchMedixJson } from "../../lib/ai/tools/medix-api-client";
import {
  measureAsync,
  PerformanceTrace,
  runWithPerformance,
} from "../../lib/performance";
import {
  aggregateTimingStages,
  parseBackendTimings,
  responseTimingSchema,
} from "../../lib/response-timing-data";
import {
  responseTimingSnapshot,
  withResponseTiming,
} from "../../lib/response-timing-stream";
import type { ChatMessage } from "../../lib/types";

test("backend metrics accept only known finite timings, preserve repeats and ignore private text", () => {
  const metrics = parseBackendTimings(
    'backend_headers;dur=12.5, model.clip_similarity;dur=2.1;count=3;errors=1, private_patient;dur=99;desc="private", video.frames;dur=-1, response.generation;dur=NaN, transcript.load;dur=Infinity, vision.total;dur=, video.resolve;dur=0, qa.total;dur=2;count=0'
  );
  assert.deepEqual(
    metrics.map((m) => [m.name, m.durationMs, m.calls, m.errors]),
    [
      ["backend_headers", 12.5, 1, 0],
      ["model.clip_similarity", 2.1, 3, 1],
      ["video.resolve", 0, 1, 0],
    ]
  );
  assert(!JSON.stringify(metrics).includes("private"));
});

test("nested/retried stages aggregate without inflating the independently measured total", () => {
  const trace = new PerformanceTrace();
  trace.spans = [
    {
      duration_ms: 30,
      name: "response.composition",
      parent_id: null,
      span_id: "parent",
      start_ms: 0,
      status: "ok",
    },
    {
      duration_ms: 10,
      name: "response.generation",
      parent_id: "parent",
      span_id: "a",
      start_ms: 0,
      status: "error",
    },
    {
      duration_ms: 15,
      name: "response.generation",
      parent_id: "parent",
      span_id: "b",
      start_ms: 10,
      status: "ok",
    },
  ];
  trace.elapsed = () => 40;
  trace.backendTimings.push(
    parseBackendTimings("model.clip_similarity;dur=5;count=3")
  );
  const report = responseTimingSnapshot(trace);
  assert.equal(report.totalMs, 40);
  assert.equal(report.firstAnswerMs, null);
  assert.equal(report.backendDetailed, true);
  assert.deepEqual(
    report.stages.find((s) => s.name === "response.generation"),
    {
      calls: 2,
      durationMs: 25,
      errors: 1,
      layer: "nextjs",
      name: "response.generation",
    }
  );
  assert.equal(report.stages.find((s) => s.layer === "fastapi")?.calls, 3);
  assert(!report.stages.some((s) => s.name === "vision.total"));
  assert(responseTimingSchema.safeParse(report).success);
  assert.equal(
    aggregateTimingStages(report.stages).length,
    report.stages.length
  );
});

test("backend timing correlation isolates requests and supports older Sol headers", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const id = new Headers(init?.headers).get("x-medix-request-id")!;
      return Response.json(
        { ok: true },
        {
          headers: {
            "server-timing": "backend_headers;dur=8.25",
            "x-medix-request-id": id,
          },
        }
      );
    };
    const traces = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const trace = new PerformanceTrace();
        await runWithPerformance(trace, () =>
          fetchMedixJson("/api/query", { method: "POST" })
        );
        return responseTimingSnapshot(trace);
      })
    );
    assert.equal(new Set(traces.map((t) => t.requestId)).size, 4);
    for (const report of traces) {
      assert.equal(report.backendCalls, 1);
      assert.equal(report.backendDetailed, false);
      assert.equal(
        report.stages.find((s) => s.layer === "fastapi")?.durationMs,
        8.25
      );
    }
    globalThis.fetch = async () =>
      Response.json(
        { ok: true },
        {
          headers: {
            "server-timing": "model.clip_similarity;dur=100",
            "x-medix-request-id": "unrelated",
          },
        }
      );
    const trace = new PerformanceTrace();
    await runWithPerformance(trace, () =>
      fetchMedixJson("/api/query", { method: "POST" })
    );
    assert.equal(trace.backendTimings.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI SDK delivers timing after merged text and response persistence; history can retain the same part", async () => {
  const trace = new PerformanceTrace();
  let responseSaved = false;
  let storedPart: ChatMessage["parts"][number] | undefined;
  const source = createUIMessageStream<ChatMessage>({
    execute({ writer }) {
      writer.merge(
        new ReadableStream<InferUIMessageChunk<ChatMessage>>({
          async start(controller) {
            controller.enqueue({ id: "text", type: "text-start" });
            await new Promise((r) => setTimeout(r, 5));
            controller.enqueue({
              delta: "private answer",
              id: "text",
              type: "text-delta",
            });
            controller.enqueue({ id: "text", type: "text-end" });
            controller.enqueue({ type: "finish" });
            controller.close();
          },
        })
      );
    },
    async onFinish() {
      await runWithPerformance(trace, () =>
        measureAsync("chat.persistence", async () => {
          await new Promise((r) => setTimeout(r, 5));
          responseSaved = true;
        })
      );
    },
  });
  let final: ChatMessage | undefined;
  for await (const message of readUIMessageStream<ChatMessage>({
    stream: withResponseTiming(source, trace, async (timing) => {
      assert(responseSaved);
      storedPart = {
        data: timing,
        id: timing.requestId,
        type: "data-performance",
      };
    }),
  })) {
    final = message;
  }
  assert.equal(
    final?.parts.find((p) => p.type === "text")?.text,
    "private answer"
  );
  const timing = final?.parts.find((p) => p.type === "data-performance");
  assert(timing);
  assert(timing.data.totalMs >= 10);
  assert(timing.data.firstAnswerMs !== null);
  assert(timing.data.stages.some((s) => s.name === "chat.persistence"));
  assert.deepEqual(JSON.parse(JSON.stringify(storedPart)), timing);
  assert(!JSON.stringify(timing).includes("private answer"));
});

test("failure to save optional metrics preserves answer and error streams are marked incomplete", async () => {
  const trace = new PerformanceTrace();
  const source = new ReadableStream<InferUIMessageChunk<ChatMessage>>({
    start(c) {
      c.enqueue({ errorText: "private provider error", type: "error" });
      c.close();
    },
  });
  const chunks: InferUIMessageChunk<ChatMessage>[] = [];
  const reader = withResponseTiming(source, trace, async () => {
    throw new Error("database unavailable");
  }).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  assert.equal(chunks[0].type, "error");
  const timing = chunks.find((c) => c.type === "data-performance");
  assert.equal(timing?.data.status, "error");
  assert(!JSON.stringify(timing).includes("private provider error"));
});

test("disabled tracking passes through; cancellation emits no completed timing report", async () => {
  const source = new ReadableStream<InferUIMessageChunk<ChatMessage>>({
    start(c) {
      c.close();
    },
  });
  assert.equal(withResponseTiming(source, undefined), source);
  const trace = new PerformanceTrace();
  let cancelled = false,
    saved = false;
  const pending = new ReadableStream<InferUIMessageChunk<ChatMessage>>({
    cancel() {
      cancelled = true;
    },
  });
  await withResponseTiming(pending, trace, async () => {
    saved = true;
  }).cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert(cancelled);
  assert(!saved);
});

test("timing control is compact and keeps diagnostic details out of the conversation", () => {
  const report = responseTimingSnapshot(new PerformanceTrace());
  const html = renderToStaticMarkup(
    createElement(ResponseTimingPanel, { timing: report })
  );
  assert(html.includes('aria-label="Response timing:'));
  assert(html.includes('aria-expanded="false"'));
  assert(html.includes('data-testid="response-timing"'));
  assert(!html.includes("Component breakdown"));
  assert(!html.includes(report.requestId));
  assert(!html.includes("Server processing"));
});

test("optional detail view aligns label/value rows and preserves scope and missing measurements", () => {
  const report = responseTimingSnapshot(new PerformanceTrace());
  const html = renderToStaticMarkup(
    createElement(ResponseTimingDetails, { timing: report })
  );
  assert(html.includes("Component breakdown"));
  assert(html.includes("No backend measurements for this response"));
  assert(html.includes("Not recorded"));
  assert(html.includes(report.requestId));
  assert(!html.includes("<details open"));
  assert(html.includes("justify-between"));
  assert(html.includes("do not add component times"));
  assert(!html.includes("restart"));
  const legacy = {
    ...report,
    backendCalls: 1,
    backendDetailed: false,
    stages: parseBackendTimings("backend_headers;dur=20"),
  };
  assert(
    renderToStaticMarkup(
      createElement(ResponseTimingDetails, { timing: legacy })
    ).includes("Detailed backend timings are unavailable")
  );
});
