"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useEffect } from "react";
import type { ChatMessage } from "@/lib/types";

export type UseAutoResumeParams = {
  autoResume: boolean;
  initialMessages: ChatMessage[];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
};

export function useAutoResume({
  autoResume,
  initialMessages,
  resumeStream,
  setMessages: _setMessages,
}: UseAutoResumeParams) {
  useEffect(() => {
    if (!autoResume) {
      return;
    }

    const mostRecentMessage = initialMessages.at(-1);

    if (mostRecentMessage?.role === "user") {
      resumeStream();
    }
  }, [autoResume, initialMessages.at, resumeStream]);
}
