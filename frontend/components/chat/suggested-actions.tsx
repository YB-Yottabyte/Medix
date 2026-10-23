"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { motion } from "motion/react";
import { memo } from "react";
import { suggestions } from "@/lib/constants";
import type { ChatMessage } from "@/lib/types";
import { Suggestion } from "../ai-elements/suggestion";
import type { VisibilityType } from "./visibility-selector";

type SuggestedActionsProps = {
  chatId: string;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  selectedVisibilityType: VisibilityType;
};

function PureSuggestedActions({ chatId, sendMessage }: SuggestedActionsProps) {
  const suggestedActions = suggestions;

  return (
    <div
      className="flex w-full flex-wrap justify-center gap-2 pb-1"
      data-testid="suggested-actions"
      style={{
        msOverflowStyle: "none",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {suggestedActions.map((suggestedAction, index) => (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="max-w-full"
          exit={{ opacity: 0, y: 16 }}
          initial={{ opacity: 0, y: 16 }}
          key={suggestedAction}
          transition={{
            delay: 0.06 * index,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <Suggestion
            className="h-auto min-h-10 max-w-full whitespace-normal rounded-xl border border-border bg-card px-3 py-2 text-left text-foreground/80 text-xs leading-relaxed transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            onClick={(suggestion) => {
              window.history.pushState(
                {},
                "",
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
              );
              sendMessage({
                parts: [{ text: suggestion, type: "text" }],
                role: "user",
              });
            }}
            suggestion={suggestedAction}
          >
            {suggestedAction}
          </Suggestion>
        </motion.div>
      ))}
    </div>
  );
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }

    return true;
  }
);
