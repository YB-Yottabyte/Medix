/** Route canonical clip URLs through the authenticated, same-origin media proxy.
 * This also avoids leaking private backend hosts or mixed HTTP content on HTTPS.
 */
export function medixMediaUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, "http://medix.invalid");
    const match = /^\/api\/(?:v2\/)?artifacts\/(.+\.mp4)$/.exec(url.pathname);
    if (!match) {
      return value;
    }
    const parts = match[1].split("/").map(decodeURIComponent);
    if (
      parts.some(
        (part) =>
          !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "." || part === ".."
      )
    ) {
      return null;
    }
    return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/medix/artifacts/${parts.map(encodeURIComponent).join("/")}`;
  } catch {
    return null;
  }
}
