import { generateText } from "ai";
import { z } from "zod";
import { titlePrompt } from "@/lib/ai/prompts";
import { getTitleModel } from "@/lib/ai/providers";
import {
  getChatById,
  saveChat,
  saveMessages,
  updateChatTitleById,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { getAppSession } from "@/lib/dev-session";
import { generateUUID } from "@/lib/utils";

const partSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const messageSchema = z.object({
  id: z.string().uuid().optional(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(partSchema),
});

const requestSchema = z.object({
  chatId: z.string().uuid(),
  visibility: z.enum(["public", "private"]),
  userMessage: messageSchema,
  assistantMessage: messageSchema,
});

async function generateTitle(message: z.infer<typeof messageSchema>) {
  const text = message.parts
    .filter(
      (
        part
      ): part is z.infer<typeof partSchema> & { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join(" ")
    .trim();

  if (!text.trim()) {
    return "New Consultation";
  }

  const { text: title } = await generateText({
    model: getTitleModel(),
    system: titlePrompt,
    prompt: text,
  });

  return (
    title
      .replace(/^[#*"\s]+/, "")
      .replace(/["]+$/, "")
      .trim() || "New Consultation"
  );
}

export async function POST(request: Request) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { chatId, visibility, userMessage, assistantMessage } = parsed.data;

  const existingChat = await getChatById({ id: chatId });
  if (!existingChat) {
    const title = await generateTitle(userMessage);
    await saveChat({
      id: chatId,
      userId: session.user.id,
      title,
      visibility,
    });
    await updateChatTitleById({ chatId, title });
  } else if (existingChat.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const messagesToSave: DBMessage[] = [
    {
      id: userMessage.id ?? generateUUID(),
      chatId,
      role: userMessage.role,
      parts: userMessage.parts,
      attachments: [],
      createdAt: now,
    },
    {
      id: assistantMessage.id ?? generateUUID(),
      chatId,
      role: assistantMessage.role,
      parts: assistantMessage.parts,
      attachments: [],
      createdAt: new Date(now.getTime() + 1),
    },
  ];

  await saveMessages({ messages: messagesToSave });

  return Response.json({
    success: true,
    userMessageId: messagesToSave[0].id,
    assistantMessageId: messagesToSave[1].id,
  });
}
