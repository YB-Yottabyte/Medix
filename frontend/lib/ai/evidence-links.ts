/** Browser-safe evidence links and search actions. No model, filesystem or server tracing imports. */
export type CitedCue = {
  text: string;
  startSeconds: number;
  endSeconds: number;
};

export const COLLECTION_SEARCH_REQUEST = "Search another video for this.";

export function offersCollectionSearch(text: string) {
  return /ask me to search the supported video collection|Should I search another video for this\?|Would you like me to look for another medical source\?/i.test(
    text
  );
}

export function parseEvidenceTimestampHref(href?: string) {
  const match = href?.match(
    /^#medix-evidence=([^&]+)&clip=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/
  );
  if (!match) {
    return null;
  }
  const startSeconds = Number(match[2]);
  const endSeconds = Number(match[3]);
  if (!(Number.isFinite(startSeconds) && Number.isFinite(endSeconds))) {
    return null;
  }
  return {
    endSeconds: Math.max(startSeconds, endSeconds),
    evidenceBundleId: decodeURIComponent(match[1]),
    startSeconds,
  };
}
