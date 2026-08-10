import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  type UIMessageStreamWriter,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import {
  generateVerifiedFollowUp,
  linkFollowUpTimestamps,
} from "@/lib/ai/medical-follow-up";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
  QWEN_CHAT_MODEL,
} from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import {
  getFollowUpModel,
  getLanguageModel,
  providerOptionsKey,
} from "@/lib/ai/providers";
import { contextualizeMedicalQuery } from "@/lib/ai/query-contextualizer";
import { isSmallTalk, SMALL_TALK_PROMPT } from "@/lib/ai/small-talk";
import {
  isSolAvailable,
  isSolConnectivityError,
  isSolModel,
  SOL_UNAVAILABLE_MESSAGE,
  solFallbackEnabled,
} from "@/lib/ai/sol";
import { createSearchProcedureTool } from "@/lib/ai/tools/search-procedure";
import type { UserType } from "@/lib/auth/types";
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
import {
  convertToUIMessages,
  generateUUID,
  getTextFromMessage,
} from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

async function writeProgressiveAnswer(
  writer: UIMessageStreamWriter<ChatMessage>,
  answer: string
) {
  const textId = generateUUID();
  const words = answer.match(/\S+\s*/g) ?? [answer];
  writer.write({ type: "text-start", id: textId });
  for (let index = 0; index < words.length; index += 4) {
    writer.write({
      type: "text-delta",
      id: textId,
      delta: words.slice(index, index + 4).join(""),
    });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
  writer.write({ type: "text-end", id: textId });
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
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

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
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

    const modelCapabilities = await getCapabilities();
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;
    const supportsTools = capabilities?.tools === true;

    const modelMessages = await convertToModelMessages(uiMessages);
    const latestUserMessage = [...uiMessages]
      .reverse()
      .find((currentMessage) => currentMessage.role === "user");
    const latestQuestion = latestUserMessage
      ? getTextFromMessage(latestUserMessage)
      : "";
    const history =
      latestUserMessage && uiMessages.at(-1)?.id === latestUserMessage.id
        ? uiMessages.slice(0, -1)
        : uiMessages;
    // A Sol-backed selection depends on a live SSH tunnel and GPU job. Probe
    // once, cheaply, so an expired session becomes a clear message instead of
    // a hang or a raw connection error.
    let effectiveChatModel = chatModel;
    let solUnavailable = false;
    if (isSolModel(chatModel) && !(await isSolAvailable())) {
      solUnavailable = true;
      if (solFallbackEnabled()) {
        effectiveChatModel = QWEN_CHAT_MODEL;
      }
    }
    const languageModel = getLanguageModel(effectiveChatModel);
    const modelConfig = chatModels.find((m) => m.id === effectiveChatModel);
    // Greetings, thanks, and "what can you do" never reach retrieval.
    const smallTalk = isSmallTalk(latestQuestion);
    const queryContext = await contextualizeMedicalQuery({
      history,
      latestQuestion,
      rewriteModel: languageModel,
    });
    const searchProcedure = createSearchProcedureTool({
      retrievalQuery: queryContext.query,
      queryWasContextualized: queryContext.wasContextualized,
      activeEvidence:
        queryContext.retrievalDecision === "continue_current_evidence"
          ? queryContext.context.activeEvidence
          : null,
      continueCurrentEvidenceFirst:
        queryContext.retrievalDecision === "continue_current_evidence",
      followUpQuestion: latestQuestion,
    });

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        if (solUnavailable && !solFallbackEnabled()) {
          await writeProgressiveAnswer(dataStream, SOL_UNAVAILABLE_MESSAGE);
          return;
        }

        const activeEvidence = queryContext.context.activeEvidence;
        if (
          queryContext.retrievalDecision === "continue_current_evidence" &&
          activeEvidence
        ) {
          // The local model runs three passes before any text appears, so tell
          // the interface what this turn is doing instead of leaving a bare
          // "Thinking..." for the whole time.
          dataStream.write({
            type: "data-follow-up-status",
            data: "Checking the current video",
          });

          // A same-topic follow-up is answered here as text only: no tool call,
          // no /api/query, no new media workspace, and always on local Qwen
          // rather than the model selected in the interface.
          const followUp = await generateVerifiedFollowUp({
            model: getFollowUpModel(),
            question: latestQuestion,
            activeEvidence,
            recentConversation: queryContext.context.recentTranscript,
          });
          const answer = activeEvidence.evidenceBundleId
            ? linkFollowUpTimestamps(
                followUp.answer,
                activeEvidence.evidenceBundleId
              )
            : followUp.answer;
          await writeProgressiveAnswer(dataStream, answer);

          // Provenance for the answer just written. Spoken transcript text and
          // timestamps only: no cue IDs, no bundle internals.
          if (followUp.citedCues.length > 0) {
            dataStream.write({
              type: "data-follow-up-evidence",
              data: {
                evidenceBundleId: activeEvidence.evidenceBundleId,
                cues: followUp.citedCues,
              },
            });
          }

          if (titlePromise) {
            const title = await titlePromise;
            dataStream.write({ type: "data-chat-title", data: title });
            updateChatTitleById({ chatId: id, title });
          }
          return;
        }

        const result = streamText({
          model: languageModel,
          system: smallTalk
            ? `${systemPrompt({ requestHints, supportsTools })}\n\n${SMALL_TALK_PROMPT}`
            : systemPrompt({
                requestHints,
                supportsTools,
                retrievalQuery: queryContext.query,
                retrievalDecision: queryContext.retrievalDecision,
                activeProcedure: queryContext.context.activeProcedure,
              }),
          messages: modelMessages,
          temperature: 0.3,
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            smallTalk || (isReasoningModel && !supportsTools)
              ? []
              : ["searchProcedure"],
          providerOptions: {
            ...(modelConfig?.reasoningEffort && {
              [providerOptionsKey(effectiveChatModel)]: {
                reasoningEffort: modelConfig.reasoningEffort,
              },
            }),
          },
          tools: {
            searchProcedure,
          },
          prepareStep:
            !smallTalk &&
            supportsTools &&
            queryContext.retrievalDecision === "continue_current_evidence"
              ? ({ stepNumber }) =>
                  stepNumber === 0
                    ? {
                        activeTools: ["searchProcedure"],
                        toolChoice: {
                          type: "tool" as const,
                          toolName: "searchProcedure" as const,
                        },
                      }
                    : undefined
              : undefined,
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
        if (isSolModel(effectiveChatModel) && isSolConnectivityError(error)) {
          return SOL_UNAVAILABLE_MESSAGE;
        }
        console.error("Chat stream error:", error);
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
