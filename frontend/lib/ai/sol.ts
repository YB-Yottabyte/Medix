/**
 * Temporary Sol (supercomputer) evaluation endpoint.
 *
 * Sol reaches this machine through an SSH tunnel to a GPU job. Any of the
 * tunnel closing, the job expiring, or the model server stopping makes the
 * endpoint vanish, so every call is bounded by a timeout and every failure is
 * translated into one user-facing sentence. Raw network or Ollama errors must
 * never reach the interface.
 *
 * This is an evaluation configuration. Production defaults are unchanged:
 * DEFAULT_CHAT_MODEL is still GPT-OSS and the follow-up pipeline still runs on
 * local Qwen 3.5 9B.
 */

const DEFAULT_SOL_BASE_URL = "http://localhost:11500";

export const SOL_CHAT_MODEL = process.env.SOL_CHAT_MODEL ?? "qwen3.6:27b";

/** Health probes must fail fast; a dead tunnel should not stall a request. */
const HEALTH_TIMEOUT_MS = 3000;
/** A 27B model on a shared GPU is slow but must not hang forever. */
const REQUEST_TIMEOUT_MS = 120_000;

export const SOL_UNAVAILABLE_MESSAGE =
  "The supercomputer model is currently unavailable. Please start or reconnect the Sol session and try again.";

export function solOllamaBaseUrl(
  baseUrl = process.env.SOL_OLLAMA_BASE_URL ?? DEFAULT_SOL_BASE_URL
) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

export function isSolModel(modelId: string) {
  return modelId === SOL_CHAT_MODEL;
}

/**
 * Fallback to the local model is opt-in and off by default. Silently rerouting
 * a medical answer to a different model than the one the user selected is a
 * decision for the operator, not a default.
 */
export function solFallbackEnabled() {
  return process.env.SOL_FALLBACK_TO_LOCAL === "true";
}

/** Bounded fetch so a hung tunnel surfaces as an error instead of stalling. */
export function solFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * True when the tunnel is open, the server answers, and the model is loaded.
 * Never throws: any failure is reported as unavailable.
 */
export async function isSolAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${solOllamaBaseUrl()}/models`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    return Boolean(
      payload.data?.some((entry) => entry.id === SOL_CHAT_MODEL)
    );
  } catch {
    return false;
  }
}

/**
 * Recognises the failure signatures of a closed tunnel, an expired GPU job, or
 * a stopped model server, so they can be reported as one calm sentence.
 */
export function isSolConnectivityError(error: unknown): boolean {
  const text = (
    error instanceof Error
      ? `${error.name} ${error.message} ${String(error.cause ?? "")}`
      : String(error)
  ).toLowerCase();
  return (
    text.includes("econnrefused") ||
    text.includes("econnreset") ||
    text.includes("enotfound") ||
    text.includes("ehostunreach") ||
    text.includes("etimedout") ||
    text.includes("socket hang up") ||
    text.includes("timeouterror") ||
    text.includes("aborterror") ||
    text.includes("fetch failed") ||
    text.includes("terminated") ||
    text.includes("11500")
  );
}
