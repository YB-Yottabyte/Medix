import { currentPerformanceTrace, measureAsync } from "../../performance";
import { parseBackendTimings } from "../../response-timing-data";

const DEFAULT_MEDIX_API_URL = "http://127.0.0.1:5001";
const REQUEST_TIMEOUT_MS = 180_000;

export function medixApiEndpoint(path: string): string {
  const boundUrl = process.env.MEDIX_API_URL?.trim();
  if (!boundUrl && process.env.VERCEL === "1") {
    throw new Error(
      "MEDIX_API_URL is missing: configure the frontend-to-app service binding"
    );
  }
  const configured = boundUrl || DEFAULT_MEDIX_API_URL;
  const base = new URL(
    configured.includes("://") ? configured : `http://${configured}`
  );
  if (!["http:", "https:"].includes(base.protocol)) {
    throw new Error("MEDIX_API_URL must use HTTP or HTTPS");
  }
  return `${base.href.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** The shared token is server-only and must never be serialized into tool output. */
export function medixApiHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (process.env.MEDIX_API_TOKEN) {
    headers.set("Authorization", `Bearer ${process.env.MEDIX_API_TOKEN}`);
  }
  return headers;
}

export async function fetchMedixJson<T>(
  path: string,
  init: RequestInit
): Promise<T> {
  return measureAsync("backend.round_trip", async () => {
    let response: Response;
    try {
      response = await fetch(medixApiEndpoint(path), {
        ...init,
        cache: "no-store",
        headers: {
          ...Object.fromEntries(medixApiHeaders(init.headers)),
          ...(currentPerformanceTrace()
            ? { "x-medix-request-id": currentPerformanceTrace()?.request_id }
            : {}),
        },
        signal: init.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new Error("Unable to reach the Medix backend", { cause: error });
    }
    const trace = currentPerformanceTrace();
    if (
      trace &&
      response.headers.get("x-medix-request-id") === trace.request_id
    ) {
      trace.backendTimings.push(
        parseBackendTimings(response.headers.get("server-timing") ?? "")
      );
    }
    const payload = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!response.ok) {
      throw new Error(
        `Medix backend request failed (HTTP ${response.status}): ${payload?.error ?? "processing failed"}`
      );
    }
    if (payload === null) {
      throw new Error("Medix backend returned an invalid JSON response");
    }
    return payload;
  });
}
