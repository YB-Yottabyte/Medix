import { tool } from "ai";
import { z } from "zod";
import { fetchMedixJson } from "./medix-api-client";

type ImageResponse = {
  recognition?: {
    detected_body_part?: string | null;
    detected_condition?: string | null;
    detected_severity?: string | null;
    top_match?: {
      question?: string | null;
      confidence?: number | null;
    } | null;
  };
  video_id?: string | null;
  answer_start?: number | null;
  answer_end?: number | null;
  ai_guidance?: string | null;
  confidence?: number | null;
};

export const analyzeImage = tool({
  description:
    "Analyze a user-provided medical image and find a matching first-aid procedure. Use only an image URL supplied in the conversation.",
  execute: async ({ imageUrl }) => {
    try {
      const url = validateRemoteImageUrl(imageUrl);
      const imageResponse = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!imageResponse.ok) {
        throw new Error(`Image download returned ${imageResponse.status}`);
      }

      const mediaType =
        imageResponse.headers.get("content-type") ?? "image/jpeg";
      if (!mediaType.startsWith("image/")) {
        throw new Error("The attachment URL did not return an image");
      }

      const form = new FormData();
      form.append("image", await imageResponse.blob(), "medical-image");
      const result = await fetchMedixJson<ImageResponse>("/api/image_query", {
        body: form,
        method: "POST",
      });
      const recognition = result.recognition;
      const topMatch = recognition?.top_match;

      return {
        answer: result.ai_guidance ?? null,
        bodyPart: recognition?.detected_body_part ?? null,
        condition: recognition?.detected_condition ?? null,
        confidence: result.confidence ?? topMatch?.confidence ?? null,
        endTime: result.answer_end ?? null,
        matchedProcedure: topMatch?.question ?? null,
        severity: recognition?.detected_severity ?? null,
        startTime: result.answer_start ?? null,
        videoId: result.video_id ?? null,
      };
    } catch (error: unknown) {
      return {
        error: error instanceof Error ? error.message : "Image analysis failed",
      };
    }
  },
  inputSchema: z.object({
    imageUrl: z
      .string()
      .url()
      .describe("The exact URL of the image attached by the user"),
  }),
});

function validateRemoteImageUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP(S) image URLs are supported");
  }

  const hostname = url.hostname.toLowerCase();
  const isPrivate =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === "169.254.169.254";
  if (isPrivate) {
    throw new Error("Private-network image URLs are not allowed");
  }
  return url;
}
