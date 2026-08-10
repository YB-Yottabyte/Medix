import { CheckIcon, Volume2Icon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatMessage } from "@/lib/types";
import copyIcon from "@/public/icons/copy.png";
import {
  MessageAction as Action,
  MessageActions as Actions,
} from "../ai-elements/message";
import { MoreHorizontalIcon, PencilEditIcon, StopIcon } from "./icons";
import { useResponseAudio } from "./response-audio-button";

export function PureMessageActions({
  message,
  isLoading,
  onEdit,
}: {
  message: ChatMessage;
  isLoading: boolean;
  onEdit?: () => void;
}) {
  const [_, copyToClipboard] = useCopyToClipboard();
  const [hasCopied, setHasCopied] = useState(false);
  const copiedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedResetTimer.current) {
        clearTimeout(copiedResetTimer.current);
      }
    },
    []
  );

  const textFromParts = message.parts
    ?.map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (
        (part.type === "tool-searchProcedure" ||
          part.type === "tool-analyzeImage") &&
        part.state === "output-available" &&
        "answer" in part.output
      ) {
        return part.output.answer ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  const { isActive: isReading, toggleSpeech } = useResponseAudio(
    textFromParts ?? ""
  );

  if (isLoading) {
    return null;
  }

  const handleCopy = async () => {
    if (!textFromParts) {
      return;
    }

    await copyToClipboard(textFromParts);
    setHasCopied(true);

    if (copiedResetTimer.current) {
      clearTimeout(copiedResetTimer.current);
    }
    copiedResetTimer.current = setTimeout(() => setHasCopied(false), 1600);
  };

  if (message.role === "user") {
    return (
      <Actions className="-mr-0.5 justify-end opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
        <div className="flex items-center gap-0.5">
          {onEdit && (
            <Action
              className="size-7 text-muted-foreground/50 hover:text-foreground"
              data-testid="message-edit-button"
              onClick={onEdit}
              tooltip="Edit"
            >
              <PencilEditIcon />
            </Action>
          )}
          <Action
            className="size-7 text-muted-foreground/50 hover:text-foreground"
            onClick={handleCopy}
            tooltip={hasCopied ? "Copied" : "Copy"}
            tooltipSide="bottom"
          >
            {hasCopied ? (
              <CheckIcon className="size-4" strokeWidth={1.8} />
            ) : (
              <Image
                alt=""
                aria-hidden
                className="size-4 opacity-60 dark:invert"
                height={16}
                src={copyIcon}
                width={16}
              />
            )}
          </Action>
        </div>
      </Actions>
    );
  }

  return (
    <Actions className="-ml-1 mt-0.5 text-muted-foreground/60">
      <Action
        className="size-8 rounded-lg hover:bg-muted hover:text-foreground"
        onClick={handleCopy}
        tooltip={hasCopied ? "Copied" : "Copy"}
        tooltipSide="bottom"
      >
        {hasCopied ? (
          <CheckIcon className="size-4" strokeWidth={1.8} />
        ) : (
          <Image
            alt=""
            aria-hidden
            className="size-4 opacity-60 dark:invert"
            height={16}
            src={copyIcon}
            width={16}
          />
        )}
      </Action>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Action
            className="size-8 rounded-lg hover:bg-muted hover:text-foreground"
            label="More response actions"
          >
            <MoreHorizontalIcon />
          </Action>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[180px] rounded-2xl border border-border/60 bg-white p-1.5 shadow-[0_14px_40px_-18px_rgba(15,23,42,0.28)]"
          side="bottom"
        >
          <DropdownMenuItem
            className="cursor-pointer rounded-xl px-3 py-2.5 text-[13px]"
            disabled={!textFromParts}
            onSelect={() => {
              toggleSpeech().catch(() => undefined);
            }}
          >
            {isReading ? (
              <StopIcon size={16} />
            ) : (
              <Volume2Icon className="size-4" strokeWidth={1.8} />
            )}
            <span>{isReading ? "Stop reading" : "Read aloud"}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Actions>
  );
}

export const MessageActions = PureMessageActions;
