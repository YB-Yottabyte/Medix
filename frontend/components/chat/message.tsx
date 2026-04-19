"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput } from "../ai-elements/tool";
import { SparklesIcon } from "./icons";
import { ImageAnalysisCard } from "./image-analysis-card";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { ProcedureCard } from "./procedure-card";
import { ResponseAudioButton } from "./response-audio-button";

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onEdit?: (message: ChatMessage) => void;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex flex-row justify-end gap-2"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            name: attachment.filename ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };

  const assistantText = isAssistant
    ? message.parts
        ?.filter(
          (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
            part.type === "text" && part.text?.trim().length > 0
        )
        .map((part) => part.text)
        .join("\n\n")
        .trim() ?? ""
    : "";

  const orderedParts = isAssistant
    ? (message.parts ?? [])
        .map((part, index) => ({ part, index }))
        .sort((a, b) => {
          const getPriority = (type: string) => {
            if (type === "reasoning") {
              return 0;
            }
            if (type === "text") {
              return 1;
            }
            if (type === "tool-searchProcedure" || type === "tool-analyzeImage") {
              return 2;
            }
            return 3;
          };

          const priorityDiff =
            getPriority(a.part.type) - getPriority(b.part.type);
          return priorityDiff !== 0 ? priorityDiff : a.index - b.index;
        })
        .map(({ part }) => part)
    : message.parts;

  const parts = orderedParts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    if (type === "text") {
      return (
        <MessageContent
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
        </MessageContent>
      );
    }

    if (type === "tool-searchProcedure") {
      const { toolCallId, state } = part;
      const widthClass = "w-[min(100%,560px)]";

      if (state === "output-available") {
        return (
          <div className={widthClass} key={toolCallId}>
            <ProcedureCard output={part.output} />
          </div>
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <Tool className="w-full" defaultOpen={true}>
            <ToolHeader state={state} type="tool-searchProcedure" />
            <ToolContent>
              {state === "input-available" && <ToolInput input={part.input} />}
            </ToolContent>
          </Tool>
        </div>
      );
    }

    if (type === "tool-analyzeImage") {
      const { toolCallId, state } = part;
      const widthClass = "w-[min(100%,560px)]";

      if (state === "output-available") {
        return (
          <div className={widthClass} key={toolCallId}>
            <ImageAnalysisCard output={part.output} />
          </div>
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <Tool className="w-full" defaultOpen={true}>
            <ToolHeader state={state} type="tool-analyzeImage" />
            <ToolContent>
              {state === "input-available" && <ToolInput input={part.input} />}
            </ToolContent>
          </Tool>
        </div>
      );
    }

    return null;
  });

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onEdit={onEdit ? () => onEdit(message) : undefined}
      vote={vote}
    />
  );

  const content = isThinking ? (
    <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
      <Shimmer className="font-medium" duration={1}>
        Thinking...
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
      {isAssistant && assistantText && (
        <div className="pt-1">
          <ResponseAudioButton text={assistantText} />
        </div>
      )}
      {actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3"
        )}
      >
        {isAssistant && (
          <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SparklesIcon size={13} />
            </div>
          </div>
        )}
        {isAssistant ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">{content}</div>
        ) : (
          content
        )}
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message w-full"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
            <SparklesIcon size={13} />
          </div>
        </div>

        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
          <Shimmer className="font-medium" duration={1}>
            Thinking...
          </Shimmer>
        </div>
      </div>
    </div>
  );
};
