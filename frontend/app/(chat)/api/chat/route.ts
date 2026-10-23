import { ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  streamText,
  type UIMessageStreamWriter,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import {
  clarificationReply,
  GENERAL_CHAT_PROMPT,
  OUT_OF_SCOPE_REPLY,
  planMedixTurn,
} from "@/lib/ai/chat-routing";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { imageBase64FromParts } from "@/lib/ai/image-input";
import {
  generateVerifiedFollowUp,
  linkFollowUpTimestamps,
  toVerifiedProcedureOutput,
} from "@/lib/ai/medical-follow-up";
import {
  allowedModelIds,
  chatModels,
  DEFAULT_CHAT_MODEL,
  getCapabilities,
  QWEN_CHAT_MODEL,
} from "@/lib/ai/models";
import {
  getFollowUpModel,
  getLanguageModel,
  providerOptionsKey,
} from "@/lib/ai/providers";
import {
  buildConversationContext,
  contextualizeMedicalQuery,
} from "@/lib/ai/query-contextualizer";
import {
  isSmallTalk,
  SMALL_TALK_PROMPT,
  smallTalkReply,
} from "@/lib/ai/small-talk";
import {
  isSolAvailable,
  isSolConnectivityError,
  isSolModel,
  SOL_UNAVAILABLE_MESSAGE,
  solFallbackEnabled,
} from "@/lib/ai/sol";
import {
  createSearchProcedureTool,
  type ProcedureToolOutput,
} from "@/lib/ai/tools/search-procedure";
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
import {
  currentPerformanceTrace,
  measureAsync,
  measureSync,
  performanceCount,
  withPerformanceRequest,
} from "@/lib/performance";
import { checkIpRateLimit } from "@/lib/ratelimit";
import { withResponseTiming } from "@/lib/response-timing-stream";
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
  return measureAsync("response.progressive_delivery", async () => {
    const textId = generateUUID();
    const words = answer.match(/\S+\s*/g) ?? [answer];
    writer.write({ id: textId, type: "text-start" });
    for (let index = 0; index < words.length; index += 4) {
      writer.write({
        delta: words.slice(index, index + 4).join(""),
        id: textId,
        type: "text-delta",
      });
      await new Promise((resolve) => setTimeout(resolve, 18));
    }
    writer.write({ id: textId, type: "text-end" });
  });
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  return withPerformanceRequest(request, () => handlePost(request));
}

async function handlePost(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await measureAsync("chat.request_decode", () =>
      request.json()
    );
    requestBody = measureSync("chat.message_validation", () =>
      postRequestBodySchema.parse(json)
    );
  } catch {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      measureAsync("chat.session", () => getAppSession()),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    // Local demos and development must not exhaust the hosted chat quota.
    if (isProductionEnvironment) {
      const userType: UserType = session.user.type;
      const messageCount = await getMessageCountByUserId({
        differenceInHours: 1,
        id: session.user.id,
      });

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
        return new ChatbotError("rate_limit:chat").toResponse();
      }
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await measureAsync("chat.history_lookup", () =>
      getChatById({ id })
    );
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await measureAsync("chat.history_load", () =>
        getMessagesByChatId({ id })
      );
    } else if (message?.role === "user") {
      await measureAsync("chat.create", () =>
        saveChat({
          id,
          title: "New chat",
          userId: session.user.id,
          visibility: selectedVisibilityType,
        })
      );
      titlePromise = isSmallTalk(getTextFromMessage(message))
        ? Promise.resolve("Conversation with Medix")
        : generateTitleFromUserMessage({ message }).catch(
            () => "New conversation"
          );
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

    if (message?.role === "user") {
      await measureAsync("chat.persistence", () =>
        saveMessages({
          messages: [
            {
              attachments: [],
              chatId: id,
              createdAt: new Date(),
              id: message.id,
              parts: message.parts,
              role: "user",
            },
          ],
        })
      );
    }

    const modelCapabilities = await measureAsync("routing.capabilities", () =>
      getCapabilities()
    );
    const capabilities = modelCapabilities[chatModel];
    const isReasoningModel = capabilities?.reasoning === true;

    const latestUserMessage = [...uiMessages]
      .reverse()
      .find((currentMessage) => currentMessage.role === "user");
    const latestQuestion = latestUserMessage
      ? getTextFromMessage(latestUserMessage)
      : "";
    let imageBase64: string | undefined;
    try {
      imageBase64 = measureSync("chat.image_validation", () =>
        imageBase64FromParts(latestUserMessage?.parts)
      );
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Invalid image" },
        { status: 400 }
      );
    }
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
    const languageModel = () => getLanguageModel(effectiveChatModel);
    const modelConfig = chatModels.find((m) => m.id === effectiveChatModel);
    // Greetings, thanks, and "what can you do" never reach retrieval.
    const smallTalk = !imageBase64 && isSmallTalk(latestQuestion);
    const imageOnly = Boolean(imageBase64 && !latestQuestion.trim());
    const turnIntent = imageOnly
      ? "clarify"
      : smallTalk
        ? "general"
        : await planMedixTurn({
            hasImage: Boolean(imageBase64),
            model: languageModel(),
            question: latestQuestion,
            recentConversation:
              buildConversationContext(history).recentTranscript,
          });
    const needsEvidence = turnIntent === "evidence";
    const generalChat = !needsEvidence;
    const queryContext = generalChat
      ? {
          context: buildConversationContext([]),
          query: latestQuestion,
          retrievalDecision: "retrieve_new_source" as const,
          wasContextualized: false,
        }
      : await measureAsync("routing.contextualization", () =>
          contextualizeMedicalQuery({
            history,
            latestQuestion,
            rewriteModel: languageModel(),
          })
        );
    // A new image needs fresh retrieval, but must not discard conversation context.
    if (imageBase64) {
      queryContext.retrievalDecision = "retrieve_new_source";
    }
    performanceCount(
      `mode.${imageBase64 ? (imageOnly ? "image_only" : "text_image") : "text"}`
    );
    performanceCount(`intent.${turnIntent}`);
    performanceCount(`retrieval.${queryContext.retrievalDecision}`);
    const searchProcedure = createSearchProcedureTool({
      activeEvidence:
        queryContext.retrievalDecision === "continue_current_evidence"
          ? queryContext.context.activeEvidence
          : null,
      continueCurrentEvidenceFirst:
        queryContext.retrievalDecision === "continue_current_evidence",
      followUpQuestion: latestQuestion,
      imageBase64,
      queryWasContextualized: queryContext.wasContextualized,
      retrievalQuery: queryContext.query,
    });

    const responseTrace = currentPerformanceTrace();
    let completedResponse: ChatMessage | undefined;
    const stream = createUIMessageStream<ChatMessage>({
      execute: async ({ writer: dataStream }) => {
        if (smallTalk) {
          await writeProgressiveAnswer(
            dataStream,
            smallTalkReply(latestQuestion) ?? "Hey! How can I help?"
          );
          if (titlePromise) {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            await updateChatTitleById({ chatId: id, title });
          }
          return;
        }
        if (turnIntent === "clarify" || turnIntent === "out_of_scope") {
          await writeProgressiveAnswer(
            dataStream,
            turnIntent === "clarify"
              ? imageOnly
                ? "What would you like help with in this photo?"
                : clarificationReply(latestQuestion)
              : OUT_OF_SCOPE_REPLY
          );
          return;
        }
        if (turnIntent === "unavailable") {
          await writeProgressiveAnswer(
            dataStream,
            "I couldn’t determine how to handle that request right now. Please try again; no video search was run."
          );
          return;
        }
        if (solUnavailable && !solFallbackEnabled()) {
          await writeProgressiveAnswer(dataStream, SOL_UNAVAILABLE_MESSAGE);
          return;
        }

        let activeEvidence = queryContext.context.activeEvidence;
        const initialAnswer =
          queryContext.retrievalDecision !== "continue_current_evidence" ||
          !activeEvidence;
        const toolCallId = generateId();
        if (!generalChat && initialAnswer) {
          const input = {
            action: "search_new_source" as const,
            query: queryContext.query,
          };
          dataStream.write({
            input,
            toolCallId,
            toolName: "searchProcedure",
            type: "tool-input-available",
          });
          if (!searchProcedure.execute) {
            throw new Error("Procedure retrieval is unavailable");
          }
          activeEvidence = (await searchProcedure.execute(input, {
            messages: [],
            toolCallId,
          })) as ProcedureToolOutput;
        }
        if (!generalChat && activeEvidence) {
          // Show progress while the bounded grounding passes run.
          dataStream.write({
            data: initialAnswer
              ? "Checking the retrieved evidence"
              : "Checking the current video",
            type: "data-follow-up-status",
          });

          // Both paths render verified claims. Follow-ups keep their existing
          // local model and saved bundle; new answers use the selected model.
          const followUp = await measureAsync("response.composition", () =>
            generateVerifiedFollowUp({
              activeEvidence,
              hasImage: Boolean(imageBase64),
              initialAnswer,
              model: initialAnswer ? languageModel() : getFollowUpModel(),
              question: latestQuestion,
              recentConversation: queryContext.context.recentTranscript,
            })
          );
          performanceCount(`response.outcome.${followUp.evidenceSufficiency}`);
          const firstVideoOnFollowUp =
            !initialAnswer &&
            !activeEvidence.renderMediaWorkspace &&
            followUp.citedCues.length > 0;
          if (firstVideoOnFollowUp) {
            dataStream.write({
              input: {
                action: "continue_current_evidence",
                query: queryContext.query,
              },
              toolCallId,
              toolName: "searchProcedure",
              type: "tool-input-available",
            });
          }
          if (initialAnswer || firstVideoOnFollowUp) {
            dataStream.write({
              output: {
                ...toVerifiedProcedureOutput(activeEvidence, followUp),
                retrievalDecision: "retrieve_new_source",
              },
              toolCallId,
              type: "tool-output-available",
            });
          }
          const answer =
            !initialAnswer &&
            !firstVideoOnFollowUp &&
            activeEvidence.evidenceBundleId
              ? linkFollowUpTimestamps(
                  followUp.answer,
                  activeEvidence.evidenceBundleId,
                  followUp.citedCues
                )
              : followUp.answer;
          await writeProgressiveAnswer(dataStream, answer);

          // Provenance for the answer just written. Spoken transcript text and
          // timestamps only: no cue IDs, no bundle internals.
          if (followUp.citedCues.length > 0) {
            dataStream.write({
              data: {
                cues: followUp.citedCues,
                evidenceBundleId: activeEvidence.evidenceBundleId,
              },
              type: "data-follow-up-evidence",
            });
          }

          if (titlePromise) {
            const title = await titlePromise;
            dataStream.write({ data: title, type: "data-chat-title" });
            updateChatTitleById({ chatId: id, title });
          }
          return;
        }

        const result = streamText({
          experimental_telemetry: {
            functionId: "stream-text",
            isEnabled: isProductionEnvironment,
          },
          maxOutputTokens: 180,
          maxRetries: 0,
          messages: await convertToModelMessages(
            smallTalk
              ? latestUserMessage
                ? [latestUserMessage]
                : []
              : uiMessages.map((message) => ({
                  ...message,
                  parts: message.parts.filter(
                    (part) => part.type === "text" || part.type === "file"
                  ),
                }))
          ),
          model: languageModel(),
          providerOptions: {
            ...(modelConfig?.reasoningEffort && {
              [providerOptionsKey(effectiveChatModel)]: {
                reasoningEffort: modelConfig.reasoningEffort,
              },
            }),
          },
          system: smallTalk ? SMALL_TALK_PROMPT : GENERAL_CHAT_PROMPT,
          temperature: 0.2,
        });

        dataStream.merge(
          result.toUIMessageStream({ sendReasoning: isReasoningModel })
        );

        await measureAsync("response.general_generation", () => result.text);
        if (titlePromise) {
          const title = await titlePromise;
          dataStream.write({ data: title, type: "data-chat-title" });
          await measureAsync("chat.title_persistence", () =>
            updateChatTitleById({ chatId: id, title })
          );
        }
      },
      generateId: generateUUID,
      onError: (error) => {
        const trace = currentPerformanceTrace();
        if (trace) {
          trace.failed = true;
        }
        if (isSolModel(effectiveChatModel) && isSolConnectivityError(error)) {
          return SOL_UNAVAILABLE_MESSAGE;
        }
        console.error("Chat stream error:", error);
        return "Oops, an error occurred!";
      },
      onFinish: async ({ messages: finishedMessages, responseMessage }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await measureAsync("chat.persistence", () =>
                updateMessage({
                  id: finishedMsg.id,
                  parts: finishedMsg.parts,
                })
              );
            } else {
              await measureAsync("chat.persistence", () =>
                saveMessages({
                  messages: [
                    {
                      attachments: [],
                      chatId: id,
                      createdAt: new Date(),
                      id: finishedMsg.id,
                      parts: finishedMsg.parts,
                      role: finishedMsg.role,
                    },
                  ],
                })
              );
            }
          }
        } else if (finishedMessages.length > 0) {
          await measureAsync("chat.persistence", () =>
            saveMessages({
              messages: finishedMessages.map((currentMessage) => ({
                attachments: [],
                chatId: id,
                createdAt: new Date(),
                id: currentMessage.id,
                parts: currentMessage.parts,
                role: currentMessage.role,
              })),
            })
          );
        }
        completedResponse = responseMessage;
      },
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    });

    return createUIMessageStreamResponse({
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ chatId: id, streamId });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch {
          /* non-critical */
        }
      },
      stream: withResponseTiming(stream, responseTrace, async (timing) => {
        if (completedResponse?.role !== "assistant") {
          return;
        }
        await updateMessage({
          id: completedResponse.id,
          parts: [
            ...completedResponse.parts.filter(
              (part) => part.type !== "data-performance"
            ),
            { data: timing, id: timing.requestId, type: "data-performance" },
          ],
        });
      }),
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
