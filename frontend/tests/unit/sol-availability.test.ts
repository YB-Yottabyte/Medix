import assert from "node:assert/strict";
import test from "node:test";
import {
  isSolAvailable,
  isSolConnectivityError,
  isSolModel,
  SOL_CHAT_MODEL,
  SOL_UNAVAILABLE_MESSAGE,
  solFallbackEnabled,
  solOllamaBaseUrl,
} from "../../lib/ai/sol";

test("normalizes the Sol host to the OpenAI-compatible endpoint", () => {
  assert.equal(
    solOllamaBaseUrl("http://localhost:11500"),
    "http://localhost:11500/v1"
  );
  assert.equal(
    solOllamaBaseUrl("http://localhost:11500/"),
    "http://localhost:11500/v1"
  );
  assert.equal(
    solOllamaBaseUrl("http://localhost:11500/v1"),
    "http://localhost:11500/v1"
  );
});

test("identifies the Sol-backed model", () => {
  assert.equal(isSolModel(SOL_CHAT_MODEL), true);
  assert.equal(isSolModel("qwen3.5:9b-q4_K_M"), false);
  assert.equal(isSolModel("openai/gpt-oss-20b"), false);
});

test("availability reports false for every session failure mode", async () => {
  const originalFetch = globalThis.fetch;
  const cases: [string, () => Promise<Response>][] = [
    // Tunnel closed / nothing listening.
    [
      "connection refused",
      () =>
        Promise.reject(new Error("fetch failed: ECONNREFUSED 127.0.0.1:11500")),
    ],
    // GPU job expired mid-session.
    ["socket hang up", () => Promise.reject(new Error("socket hang up"))],
    // Tunnel open but server not answering: must time out, not hang.
    [
      "timeout",
      () =>
        Promise.reject(
          Object.assign(new Error("timed out"), { name: "TimeoutError" })
        ),
    ],
    // Server up but returning an error status.
    [
      "http 503",
      () => Promise.resolve(new Response("upstream down", { status: 503 })),
    ],
    // Server up but the model is not loaded.
    [
      "model missing",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "some-other-model" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        ),
    ],
    // Server up but returning non-JSON (e.g. a proxy error page).
    [
      "non-json body",
      () =>
        Promise.resolve(
          new Response("<html>Bad Gateway</html>", { status: 200 })
        ),
    ],
  ];

  try {
    for (const [label, responder] of cases) {
      globalThis.fetch = responder as unknown as typeof fetch;
      assert.equal(await isSolAvailable(), false, label);
    }

    // Healthy session with the model loaded.
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: SOL_CHAT_MODEL }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )) as unknown as typeof fetch;
    assert.equal(await isSolAvailable(), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("connectivity errors are recognised, unrelated errors are not", () => {
  for (const error of [
    new Error("fetch failed"),
    new Error("connect ECONNREFUSED 127.0.0.1:11500"),
    new Error("read ECONNRESET"),
    new Error("socket hang up"),
    Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    }),
    Object.assign(new Error("aborted"), { name: "AbortError" }),
    new Error("getaddrinfo ENOTFOUND sol.cluster"),
    new Error("terminated"),
  ]) {
    assert.equal(isSolConnectivityError(error), true, error.message);
  }

  // A model or validation problem must not be disguised as a session outage.
  for (const error of [
    new Error("model produced invalid JSON"),
    new Error("rate limit exceeded"),
    new Error("unauthorized"),
  ]) {
    assert.equal(isSolConnectivityError(error), false, error.message);
  }
});

test("the outage message names the recovery action and leaks no internals", () => {
  assert.match(
    SOL_UNAVAILABLE_MESSAGE,
    /supercomputer model is currently unavailable/i
  );
  assert.match(SOL_UNAVAILABLE_MESSAGE, /reconnect the Sol session/i);
  // No hostnames, ports, stack traces, or provider names.
  assert.doesNotMatch(
    SOL_UNAVAILABLE_MESSAGE,
    /\b11500\b|\blocalhost\b|\bollama\b|\bECONN[A-Z]+|\bfetch\b|\bhttps?:/i
  );
});

test("falling back to the local model is opt-in, not the default", () => {
  const original = process.env.SOL_FALLBACK_TO_LOCAL;
  try {
    delete process.env.SOL_FALLBACK_TO_LOCAL;
    assert.equal(solFallbackEnabled(), false);
    process.env.SOL_FALLBACK_TO_LOCAL = "false";
    assert.equal(solFallbackEnabled(), false);
    process.env.SOL_FALLBACK_TO_LOCAL = "true";
    assert.equal(solFallbackEnabled(), true);
  } finally {
    if (original === undefined) {
      delete process.env.SOL_FALLBACK_TO_LOCAL;
    } else {
      process.env.SOL_FALLBACK_TO_LOCAL = original;
    }
  }
});
