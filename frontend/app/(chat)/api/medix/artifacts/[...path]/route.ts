import {
  medixApiEndpoint,
  medixApiHeaders,
} from "@/lib/ai/tools/medix-api-client";
import { getAppSession } from "@/lib/dev-session";

/** Stream only canonical MP4 clips. Never accept an arbitrary upstream URL. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getAppSession();
  if (!session?.user) {
    return new Response(null, { status: 401 });
  }
  const { path } = await params;
  if (
    !path.length ||
    path.some(
      (part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === ".."
    ) ||
    !path.at(-1)?.endsWith(".mp4")
  ) {
    return new Response(null, { status: 400 });
  }
  const headers = medixApiHeaders();
  for (const name of [
    "range",
    "if-range",
    "if-none-match",
    "if-modified-since",
  ]) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  try {
    const upstream = await fetch(
      medixApiEndpoint(
        `/api/artifacts/${path.map(encodeURIComponent).join("/")}`
      ),
      {
        cache: "no-store",
        headers,
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]),
      }
    );
    const responseHeaders = new Headers({
      "Cache-Control": "private, no-store",
    });
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
    ]) {
      const value = upstream.headers.get(name);
      if (value) {
        responseHeaders.set(name, value);
      }
    }
    return new Response(upstream.body, {
      headers: responseHeaders,
      status: upstream.status,
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
