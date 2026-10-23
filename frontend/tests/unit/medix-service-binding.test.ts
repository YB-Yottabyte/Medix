import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchMedixJson,
  medixApiEndpoint,
} from "../../lib/ai/tools/medix-api-client";

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  apply(values);
  try {
    await run();
  } finally {
    apply(previous);
  }
}

test("standalone development retains its local backend default", async () => {
  await withEnvironment({ VERCEL: undefined, MEDIX_API_URL: undefined }, () => {
    assert.equal(
      medixApiEndpoint("/api/query"),
      "http://127.0.0.1:5001/api/query"
    );
  });
});

test("Vercel runtime refuses a missing or blank binding instead of calling localhost", async () => {
  for (const url of [undefined, "", "   "]) {
    await withEnvironment({ VERCEL: "1", MEDIX_API_URL: url }, () => {
      assert.throws(() => medixApiEndpoint("/api/query"), /service binding/);
    });
  }
});

test("deployment binding is read at request time and preserves its base path", async () => {
  await withEnvironment({ VERCEL: "1", MEDIX_API_URL: undefined }, () => {
    process.env.MEDIX_API_URL = "https://private.example/preview-1/";
    assert.equal(
      medixApiEndpoint("/api/image_query"),
      "https://private.example/preview-1/api/image_query"
    );
    process.env.MEDIX_API_URL = "https://private.example/preview-2/";
    assert.equal(
      medixApiEndpoint("/api/tts"),
      "https://private.example/preview-2/api/tts"
    );
  });
});

test("a bound request retains application authentication and the API path", async () => {
  await withEnvironment(
    {
      VERCEL: "1",
      MEDIX_API_URL: "https://internal.example/",
      MEDIX_API_TOKEN: "test-binding-token",
    },
    async () => {
      const previous = globalThis.fetch;
      try {
        globalThis.fetch = async (url, init) => {
          assert.equal(
            String(url),
            "https://internal.example/api/multimodal/query"
          );
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer test-binding-token"
          );
          assert.equal(init?.method, "POST");
          return Response.json({ answer: "fixture answer" });
        };
        assert.deepEqual(
          await fetchMedixJson("/api/multimodal/query", { method: "POST" }),
          { answer: "fixture answer" }
        );
      } finally {
        globalThis.fetch = previous;
      }
    }
  );
});
