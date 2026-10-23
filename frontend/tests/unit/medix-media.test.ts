import assert from "node:assert/strict";
import test from "node:test";
import { medixApiHeaders } from "../../lib/ai/tools/medix-api-client";
import { medixMediaUrl } from "../../lib/medix-media";

test("canonical clips use a same-origin URL without leaking the private backend or its token", () => {
  assert.equal(
    medixMediaUrl("http://internal:5001/api/artifacts/abc/clip.mp4"),
    "/api/medix/artifacts/abc/clip.mp4"
  );
  assert.equal(
    medixMediaUrl("http://internal:5001/api/v2/artifacts/abc/clip.mp4"),
    "/api/medix/artifacts/abc/clip.mp4"
  );
  assert.equal(medixMediaUrl(null), null);
  assert.equal(
    medixMediaUrl("/api/medix/artifacts/abc/clip.mp4"),
    "/api/medix/artifacts/abc/clip.mp4"
  );
  assert.equal(
    medixMediaUrl("http://internal/api/artifacts/abc%2fsecret/clip.mp4"),
    null
  );
});

test("the optional API credential is added only to server request headers", () => {
  const before = process.env.MEDIX_API_TOKEN;
  try {
    delete process.env.MEDIX_API_TOKEN;
    assert.equal(medixApiHeaders().has("authorization"), false);
    process.env.MEDIX_API_TOKEN = "test-secret";
    assert.equal(
      medixApiHeaders({ "content-type": "application/json" }).get(
        "authorization"
      ),
      "Bearer test-secret"
    );
    assert(
      !medixMediaUrl("http://internal/api/artifacts/abc/clip.mp4")?.includes(
        "test-secret"
      )
    );
  } finally {
    if (before === undefined) {
      delete process.env.MEDIX_API_TOKEN;
    } else {
      process.env.MEDIX_API_TOKEN = before;
    }
  }
});

test("a gateway HTML error preserves HTTP status without exposing its response body", async () => {
  const { fetchMedixJson } = await import(
    "../../lib/ai/tools/medix-api-client"
  );
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("private gateway diagnostics", { status: 502 });
    await assert.rejects(
      fetchMedixJson("/api/query", { method: "POST" }),
      (error) =>
        error instanceof Error &&
        error.message.includes("HTTP 502") &&
        !error.message.includes("private")
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("backend requests retain the caller's cancellation signal", async () => {
  const { fetchMedixJson } = await import(
    "../../lib/ai/tools/medix-api-client"
  );
  const previous = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.signal?.aborted, true);
      return Response.json({ ok: true });
    };
    await fetchMedixJson("/api/query", { signal: controller.signal });
  } finally {
    globalThis.fetch = previous;
  }
});
