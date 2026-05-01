import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import type { UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { analyzeImage } from "@/lib/ai/tools/analyze-image";
import { searchProcedure } from "@/lib/ai/tools/search-procedure";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { getAppSession } from "@/lib/dev-session";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

// Image understanding with local Qwen can take longer than standard text-only chat.
export const maxDuration = 300;

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

type AnalyzeImageResult =
  | {
      error: string;
      bodyPart?: never;
      condition?: never;
      severity?: never;
      matchedProcedure?: never;
      videoId?: never;
      startTime?: never;
      endTime?: never;
      confidence?: never;
    }
  | {
      error?: undefined;
      bodyPart: string | null;
      condition: string | null;
      severity: string | null;
      matchedProcedure: string | null;
      videoId: string | null;
      startTime: number | null;
      endTime: number | null;
      confidence: number | null;
    };

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

async function enrichLatestUserMessageWithImageAnalysis(
  uiMessages: ChatMessage[]
): Promise<ChatMessage[]> {
  const lastMessage = uiMessages.at(-1);
  if (!lastMessage || lastMessage.role !== "user") {
    return uiMessages;
  }

  const fileParts = lastMessage.parts.filter((part) => part.type === "file");
  if (fileParts.length === 0) {
    return uiMessages;
  }

  const firstImage = fileParts.find((part) =>
    part.mediaType?.startsWith("image/")
  );
  if (!firstImage) {
    return uiMessages;
  }

  const nonFileParts = lastMessage.parts.filter((part) => part.type !== "file");
  const questionText = nonFileParts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  const rawAnalysis = await analyzeImage.execute?.(
    {
      imageUrl: firstImage.url,
      question: questionText || undefined,
    },
    {
      toolCallId: "preprocess-image-analysis",
      messages: [],
    }
  );

  const analysis: AnalyzeImageResult | null =
    !rawAnalysis || isAsyncIterable(rawAnalysis)
      ? null
      : (rawAnalysis as AnalyzeImageResult);

  let analysisText =
    "Image analysis was requested, but no result was returned. Continue using the user's text only.";

  if (analysis?.error) {
    analysisText = `Image analysis failed: ${analysis.error}`;
  } else if (analysis) {
    analysisText =
      "Image findings to use when answering:\n" +
      `- Body part: ${analysis.bodyPart ?? "unknown"}\n` +
      `- Condition: ${analysis.condition ?? "unknown"}\n` +
      `- Severity: ${analysis.severity ?? "unknown"}\n` +
      `- Closest verified procedure: ${analysis.matchedProcedure ?? "unknown"}`;
  }

  // Avoid pasting raw data: URLs (often hundreds of KB of base64) into the
  // prompt — they blow past Groq's per-request token budget. Only include a
  // short reference for non-data URLs.
  const imageRef = firstImage.url.startsWith("data:")
    ? "(uploaded image)"
    : firstImage.url;
  const enrichedMessage: ChatMessage = {
    ...lastMessage,
    parts: [
      ...nonFileParts,
      {
        type: "text",
        text:
          `Attached medical image: ${imageRef}\n` +
          (questionText
            ? `User question for the image: ${questionText}\n`
            : "") +
          `${analysisText}`,
      },
    ],
  };

  return [...uiMessages.slice(0, -1), enrichedMessage];
}

function prepareMessagesForLanguageModel(
  uiMessages: ChatMessage[]
): ChatMessage[] {
  // The latest user message has already been handled by
  // enrichLatestUserMessageWithImageAnalysis (file parts removed, findings
  // injected). For older messages, file parts are stale: the assistant's
  // prior reply in the conversation history already contains the answer
  // about that image, so we just drop the file parts. We never paste raw
  // data: URLs into the prompt — they alone can exceed Groq's per-request
  // token budget and confuse the model into asking for a re-upload.
  return uiMessages.map((message) => {
    if (message.role !== "user") {
      return message;
    }

    const fileParts = message.parts.filter((part) => part.type === "file");
    if (fileParts.length === 0) {
      return message;
    }

    const nonFileParts = message.parts.filter((part) => part.type !== "file");
    return {
      ...message,
      parts: nonFileParts,
    };
  });
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      getAppSession(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    const maxMessagesPerHour =
      process.env.NODE_ENV === "development"
        ? Number.POSITIVE_INFINITY
        : entitlementsByUserType[userType].maxMessagesPerHour;

    if (messageCount > maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    let uiMessages: ChatMessage[];

    if (isToolApprovalFlow && messages) {
      const dbMessages = convertToUIMessages(messagesFromDb);
      const approvalStates = new Map(
        messages.flatMap(
          (m) =>
            m.parts
              ?.filter(
                (p: Record<string, unknown>) =>
                  p.state === "approval-responded" ||
                  p.state === "output-denied"
              )
              .map((p: Record<string, unknown>) => [
                String(p.toolCallId ?? ""),
                p,
              ]) ?? []
        )
      );
      uiMessages = dbMessages.map((msg) => ({
        ...msg,
        parts: msg.parts.map((part) => {
          if (
            "toolCallId" in part &&
            approvalStates.has(String(part.toolCallId))
          ) {
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
          }
          return part;
        }),
      })) as ChatMessage[];
    } else {
      uiMessages = [
        ...convertToUIMessages(messagesFromDb),
        message as ChatMessage,
      ];
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const modelConfig = chatModels.find((m) => m.id === chatModel);
    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    const imagePreparedMessages =
      await enrichLatestUserMessageWithImageAnalysis(uiMessages);
    const modelReadyMessages = prepareMessagesForLanguageModel(
      imagePreparedMessages
    );
    // Cap conversation history sent to the model to avoid Groq's per-request
    // token-window error ("Please reduce the length of the messages or completion").
    // Keep the most recent N turns; the system prompt is added separately by streamText.
    const MAX_HISTORY_MESSAGES = 12;
    const trimmedReadyMessages =
      modelReadyMessages.length > MAX_HISTORY_MESSAGES
        ? modelReadyMessages.slice(-MAX_HISTORY_MESSAGES)
        : modelReadyMessages;
    const modelMessages = await convertToModelMessages(trimmedReadyMessages);

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        const result = streamText({
          model: getLanguageModel(chatModel),
          system: systemPrompt({ requestHints, supportsTools }),
          messages: modelMessages,
          temperature: 0.3,
          // Cap completion size so input + output stays under Groq's per-request
          // token budget (otherwise Groq returns "Please reduce the length of
          // the messages or completion."). Reasoning models include reasoning
          // tokens in this budget, so leave room for them.
          maxOutputTokens: 2048,
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            isReasoningModel && !supportsTools
              ? []
              : ["searchProcedure", "analyzeImage"],
          providerOptions: {
            ...(modelConfig?.reasoningEffort && {
              openai: { reasoningEffort: modelConfig.reasoningEffort },
            }),
          },
          tools: {
            searchProcedure,
            analyzeImage,
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        dataStream.merge(
          result.toUIMessageStream({ sendReasoning: isReasoningModel })
        );

        if (titlePromise) {
          const title = await titlePromise;
          dataStream.write({ type: "data-chat-title", data: title });
          updateChatTitleById({ chatId: id, title });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
        }
        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          /* non-critical */
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await getAppSession();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
