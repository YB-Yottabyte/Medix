/** Accept one inline upload; never fetch caller-controlled URLs. */
export function imageBase64FromParts(
  parts: Array<{ type: string; url?: string }> = []
): string | undefined {
  const files = parts.filter((part) => part.type === "file");
  if (!files.length) {
    return;
  }
  if (files.length !== 1) {
    throw new Error("Attach one JPEG or PNG image at a time.");
  }
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    files[0].url ?? ""
  );
  if (
    !match ||
    match[1].length % 4 !== 0 ||
    Buffer.from(match[1], "base64").length > 5 * 1024 * 1024
  ) {
    throw new Error("Reattach a JPEG or PNG image of at most 5 MB.");
  }
  return match[1];
}
