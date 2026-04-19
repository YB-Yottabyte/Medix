import { z } from "zod";
import { getAppSession } from "@/lib/dev-session";
import { ChatbotError } from "@/lib/errors";

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

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not configured for text-to-speech." },
      { status: 500 }
    );
  }

  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "canopylabs/orpheus-v1-english",
        voice: "hannah",
        input: text,
        response_format: "wav",
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();

      try {
        const parsed = JSON.parse(errorText) as {
          error?: { code?: string; message?: string };
        };

        if (parsed.error?.code === "model_terms_required") {
          return Response.json(
            {
              error:
                "Groq Orpheus TTS is not enabled yet. An organization admin must accept the model terms for canopylabs/orpheus-v1-english in Groq Console: https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english",
            },
            { status: 403 }
          );
        }
      } catch {
        /* keep generic error below if body is not JSON */
      }

      return Response.json(
        { error: `Groq TTS request failed: ${errorText}` },
        { status: groqResponse.status }
      );
    }

    const audioBuffer = await groqResponse.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: `Could not reach Groq text-to-speech service. ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      { status: 502 }
    );
  }
}
