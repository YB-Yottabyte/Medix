import { z } from "zod";
import { getAppSession } from "@/lib/dev-session";
import { ChatbotError } from "@/lib/errors";
import { medixApiEndpoint } from "@/lib/ai/tools/medix-api-client";

const ttsSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  const session = await getAppSession();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  let text: string;

  try {
    const parsed = ttsSchema.parse(await request.json());
    text = parsed.text;
  } catch {
    return new ChatbotError(
      "bad_request:api",
      "Text-to-speech requires 1-200 characters of input."
    ).toResponse();
  }

  try {
    const kokoroResponse = await fetch(medixApiEndpoint("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      cache: "no-store",
      signal: AbortSignal.timeout(300_000),
    });

    if (!kokoroResponse.ok) {
      const payload = (await kokoroResponse.json().catch(() => null)) as {
        error?: string;
      } | null;
      return Response.json(
        {
          error:
            payload?.error ??
            `Kokoro TTS request failed with status ${kokoroResponse.status}.`,
        },
        { status: kokoroResponse.status }
      );
    }

    const audioBuffer = await kokoroResponse.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: `Could not reach the local Kokoro text-to-speech service. ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      { status: 502 }
    );
  }
}
