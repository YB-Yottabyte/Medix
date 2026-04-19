import { getAppSession } from "@/lib/dev-session";
import { ChatbotError } from "@/lib/errors";

export async function POST(request: Request) {
  const session = await getAppSession();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not configured for speech-to-text." },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return Response.json(
        { error: "Speech-to-text requires an audio file." },
        { status: 400 }
      );
    }

    const groqFormData = new FormData();
    groqFormData.append("file", file, file.name || "speech.webm");
    groqFormData.append("model", "whisper-large-v3-turbo");
    groqFormData.append("language", "en");
    groqFormData.append("response_format", "json");
    groqFormData.append("temperature", "0");

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: groqFormData,
      }
    );

    const responseText = await groqResponse.text();

    if (!groqResponse.ok) {
      return Response.json(
        { error: `Groq transcription request failed: ${responseText}` },
        { status: groqResponse.status }
      );
    }

    const parsed = JSON.parse(responseText) as { text?: string };

    return Response.json({ text: parsed.text ?? "" }, { status: 200 });
  } catch (error) {
    return Response.json(
      {
        error: `Could not reach Groq speech-to-text service. ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      { status: 502 }
    );
  }
}
