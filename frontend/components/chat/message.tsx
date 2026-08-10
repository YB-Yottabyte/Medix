"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  type CitedCue,
  COLLECTION_SEARCH_REQUEST,
  offersCollectionSearch,
  parseEvidenceTimestampHref,
} from "@/lib/ai/medical-follow-up";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput } from "../ai-elements/tool";
import { useDataStream } from "./data-stream-provider";
import { EvidenceProvenance } from "./evidence-provenance";
import { ImageAnalysisCard } from "./image-analysis-card";
import { MessageActions } from "./message-actions";
import { PreviewAttachment } from "./preview-attachment";
import { ProcedureCard, ProcedureCardSkeleton } from "./procedure-card";

const PurePreviewMessage = ({
  message,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
}: {
  message: ChatMessage;
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

  useDataStream();

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;
  const followUpStatus = message.parts?.find(
    (part) => part.type === "data-follow-up-status"
  )?.data as string | undefined;
  const followUpEvidence = message.parts?.find(
    (part) => part.type === "data-follow-up-evidence"
  )?.data as { evidenceBundleId: string | null; cues: CitedCue[] } | undefined;

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
  const hasProcedureOutput =
    isAssistant &&
    message.parts?.some(
      (part) =>
        part.type === "tool-searchProcedure" &&
        part.state === "output-available"
    );
  const lastProcedurePartIndex = message.parts.reduce(
    (latestIndex, part, index) =>
      part.type === "tool-searchProcedure" ? index : latestIndex,
    -1
  );

  const parts = message.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (type === "reasoning") {
      return null;
    }

    if (type === "text") {
      if (hasProcedureOutput) {
        return null;
      }
      // A deferral offers to search the collection. Retrieval only happens on
      // an explicit request, so that offer is given a one-click affordance.
      const offersSearch =
        isAssistant && !isLoading && offersCollectionSearch(part.text);
      return (
        <MessageContent
          className={cn(
            "min-w-0 max-w-full break-words text-[13.5px] leading-[1.7]",
            // Assistant prose is capped at a readable measure; the evidence
            // workspace below is rendered separately and stays full width.
            isAssistant && "max-w-[72ch]",
            {
              "w-fit max-w-[min(80%,56ch)] overflow-hidden rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
                message.role === "user",
            },
            isAssistant &&
              isLoading &&
              "after:ml-1 after:inline-block after:h-3 after:w-[2px] after:translate-y-[2px] after:animate-pulse after:rounded-full after:bg-foreground/20 after:content-['']"
          )}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse
            components={{
              a: ({ children, href }) => {
                const timestamp = parseEvidenceTimestampHref(href);
                if (!timestamp) {
                  return <a href={href}>{children}</a>;
                }
                return (
                  <button
                    className="inline-flex rounded-md bg-[#edf5f8] px-1.5 py-0.5 font-mono font-semibold text-[#174a62] text-[0.82em] no-underline transition-colors hover:bg-[#dcecf2] dark:bg-sky-950/45 dark:text-sky-200"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("medix:seek-evidence", {
                          detail: timestamp,
                        })
                      )
                    }
                    title="Play this cited moment"
                    type="button"
                  >
                    {children}
                  </button>
                );
              },
            }}
          >
            {sanitizeText(part.text)}
          </MessageResponse>
          {isAssistant && !isLoading && followUpEvidence && (
            <EvidenceProvenance
              cues={followUpEvidence.cues}
              onSeek={(seconds) =>
                followUpEvidence.evidenceBundleId
                  ? window.dispatchEvent(
                      new CustomEvent("medix:seek-evidence", {
                        detail: {
                          evidenceBundleId: followUpEvidence.evidenceBundleId,
                          startSeconds: seconds,
                        },
                      })
                    )
                  : undefined
              }
            />
          )}
          {offersSearch && !isReadonly && (
            <button
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1.5 font-medium text-[12px] text-foreground/80 transition-colors hover:bg-muted"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("medix:ask", {
                    detail: { text: COLLECTION_SEARCH_REQUEST },
                  })
                )
              }
              type="button"
            >
              Search the video collection
            </button>
          )}
        </MessageContent>
      );
    }

    if (type === "tool-searchProcedure") {
      const { toolCallId, state } = part;
      const widthClass = "w-full max-w-[1080px]";

      // A follow-up can escalate from the current evidence to a new source.
      // Render only the latest evidence decision so two videos never appear
      // for one assistant turn.
      if (index !== lastProcedurePartIndex) {
        return null;
      }

      if (state === "output-available") {
        return (
          <div className={widthClass} key={toolCallId}>
            <ProcedureCard
              isAnswerStreaming={isLoading}
              output={part.output}
              writtenAnswer={assistantText}
            />
          </div>
        );
      }

      return (
        <div className={widthClass} key={toolCallId}>
          <ProcedureCardSkeleton
            searchingAdditionalEvidence={
              state === "input-available" &&
              part.input.action === "search_new_source"
            }
          />
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
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onEdit={onEdit ? () => onEdit(message) : undefined}
    />
  );

  const content = isThinking ? (
    <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
      <Shimmer className="font-medium" duration={1}>
        {`${followUpStatus ?? "Thinking"}...`}
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
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
          isUser ? "flex flex-col items-end gap-2" : "flex items-start"
        )}
      >
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
      <div className="flex items-start">
        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
          <Shimmer className="font-medium" duration={1}>
            Thinking...
          </Shimmer>
        </div>
      </div>
    </div>
  );
};
