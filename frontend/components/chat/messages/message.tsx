"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from "@/components/ai-elements/tool";
import { ProcedureCard } from "@/components/chat/cards/procedure-card";
import { PreviewAttachment } from "@/components/chat/input/preview-attachment";
import { MessageActions } from "@/components/chat/messages/message-actions";
import { MessageReasoning } from "@/components/chat/messages/message-reasoning";
import { ResponseAudioButton } from "@/components/chat/response-audio-button";
import { SparklesIcon } from "@/components/chat/shared/icons";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";

function normalizeAssistantText(text: string): string {
  if (!text.trim()) {
    return text;
  }

  return text
    .replace(/^\s*\*?\*?(Analysis|Steps|Video)\*?\*?\s*:?\s*$/gim, "")
    .replace(
      /^\s*A verified (MedVidQA|Medix) video is available in the player\.?\s*$/gim,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const PurePreviewMessage = ({
  addToolApprovalResponse: _addToolApprovalResponse,
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
    ? (message.parts
        ?.filter(
          (
            part
          ): part is Extract<
            (typeof message.parts)[number],
            { type: "text" }
          > => part.type === "text" && part.text?.trim().length > 0
        )
        .map((part) => part.text)
        .join("\n\n")
        .trim() ?? "")
    : "";

  const normalizedAssistantText = isAssistant
    ? normalizeAssistantText(assistantText)
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
            if (
              type === "tool-searchProcedure" ||
              type === "tool-analyzeImage"
            ) {
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
      const displayText =
        message.role === "assistant"
          ? normalizeAssistantText(part.text)
          : part.text;

      return (
        <MessageContent
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(displayText)}</MessageResponse>
        </MessageContent>
      );
    }

    if (type === "tool-searchProcedure") {
      const { toolCallId, state } = part;
      const widthClass = "w-[min(100%,560px)]";

      if (state === "output-available") {
        return (
          <div
            className={cn(
              widthClass,
              "animate-[fade-up_0.32s_cubic-bezier(0.22,1,0.36,1)]"
            )}
            key={toolCallId}
          >
            <ProcedureCard output={part.output} />
          </div>
        );
      }

      if (state === "input-streaming") {
        return (
          <div className={widthClass} key={toolCallId}>
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-4 w-3/4 rounded bg-muted/80" />
                  </div>
                  <div className="h-5 w-16 rounded-full bg-muted" />
                </div>
                <div className="h-3 w-40 rounded bg-muted/70" />
                <div className="pt-2">
                  <div className="mb-2 h-3 w-12 rounded bg-muted" />
                  <div className="aspect-video w-full rounded-lg bg-muted/80" />
                </div>
              </div>
            </div>
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
      return null;
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
      {isAssistant && normalizedAssistantText && (
        <div className="pt-1">
          <ResponseAudioButton text={normalizedAssistantText} />
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
