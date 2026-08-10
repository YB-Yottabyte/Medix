const DEFAULT_MEDIX_API_URL = "http://127.0.0.1:5001";
const REQUEST_TIMEOUT_MS = 180_000;

export function medixApiEndpoint(path: string): string {
  const baseUrl = process.env.MEDIX_API_URL ?? DEFAULT_MEDIX_API_URL;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function fetchMedixJson<T>(
  path: string,
  init: RequestInit
): Promise<T> {
  try {
    const response = await fetch(medixApiEndpoint(path), {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(
        payload.error ?? `Medix backend returned ${response.status}`
      );
    }
    return payload;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown backend error";
    throw new Error(`Unable to reach the Medix backend: ${message}`, {
      cause: error,
    });
  }
}
