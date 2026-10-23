import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchMedixJson } from "../../lib/ai/tools/medix-api-client";
import {
  measureAsync,
  measureSync,
  PerformanceTrace,
  performanceCount,
  runWithPerformance,
  withPerformanceRequest,
} from "../../lib/performance";

test("parallel requests preserve request-local context and nested exclusive duration", async () => {
  const traces = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const t = new PerformanceTrace();
      await runWithPerformance(t, () =>
        measureAsync("parent", async () => {
          await Promise.all([
            measureAsync("child", async () => {
              await new Promise((r) => setTimeout(r, 3));
              performanceCount("hit");
            }),
            measureAsync("child", async () => {
              await new Promise((r) => setTimeout(r, 3));
              performanceCount("hit");
            }),
          ]);
          measureSync("validation", () => true);
        })
      );
      return t.snapshot();
    })
  );
  assert.equal(new Set(traces.map((t) => t.request_id)).size, 10);
  for (const t of traces) {
    assert.equal(t.spans.length, 4);
    assert.equal(t.counters.hit, 2);
    const parent = t.spans.find((s) => s.name === "parent")!;
    assert(
      parent.exclusive_ms >= 0 && parent.exclusive_ms < parent.duration_ms
    );
  }
});

test("correlation is propagated to FastAPI and backend JSON decode is included", async () => {
  const original = globalThis.fetch;
  try {
    const trace = new PerformanceTrace();
    globalThis.fetch = async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("x-medix-request-id"),
        trace.request_id
      );
      return Response.json({ ok: true });
    };
    await runWithPerformance(trace, () =>
      fetchMedixJson("/api/query", { method: "POST" })
    );
    assert.equal(trace.spans[0].name, "backend.round_trip");
  } finally {
    globalThis.fetch = original;
  }
});

test("total spans entire SSE response, records first answer, cancellation and safe errors", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "medix-timing-"));
  const previous = process.env.MEDIX_PERFORMANCE_LOG;
  process.env.MEDIX_PERFORMANCE_LOG = path.join(folder, "trace.jsonl");
  try {
    const response = await withPerformanceRequest(
      new Request("http://localhost/api/chat"),
      async () => {
        await measureAsync(
          "routing",
          async () => new Promise((r) => setTimeout(r, 2))
        );
        return new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'));
              await new Promise((r) => setTimeout(r, 8));
              c.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"text-delta","delta":"private answer"}\n\n'
                )
              );
              c.close();
            },
          })
        );
      }
    );
    assert(response.headers.get("x-medix-request-id"));
    await response.text();
    let records = (await readFile(process.env.MEDIX_PERFORMANCE_LOG, "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(records.length, 1);
    assert(records[0].total_ms >= 8);
    assert(records[0].first_answer_ms !== null);
    assert(!JSON.stringify(records).includes("private answer"));
    const cancelled = await withPerformanceRequest(
      new Request("http://localhost/api/chat"),
      async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              c.enqueue(new Uint8Array([1]));
            },
          })
        )
    );
    await cancelled.body?.cancel();
    await assert.rejects(
      withPerformanceRequest(
        new Request("http://localhost/api/chat"),
        async () => {
          throw new Error("private question");
        }
      )
    );
    records = (await readFile(process.env.MEDIX_PERFORMANCE_LOG, "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(
      records.map((r) => r.status),
      ["ok", "cancelled", "error"]
    );
    assert(!JSON.stringify(records).includes("private question"));
  } finally {
    if (previous === undefined) {
      delete process.env.MEDIX_PERFORMANCE_LOG;
    } else {
      process.env.MEDIX_PERFORMANCE_LOG = previous;
    }
    await rm(folder, { force: true, recursive: true });
  }
});
