"use client";

import { useEffect, useRef, useState } from "react";
import { useActiveChat } from "@/hooks/use-active-chat";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ActiveSourceBar } from "./active-source-bar";
import { ChatHeader } from "./chat-header";
import { Greeting } from "./greeting";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    input,
    setInput,
    isReadonly,
    isLoading,
    currentModelId,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const showEmptyState = messages.length === 0;

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  // A deferral in the transcript can offer a one-click collection search.
  useEffect(() => {
    const handleAsk = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) {
        return;
      }
      sendMessageRef.current({
        role: "user",
        parts: [{ type: "text", text }],
      });
    };
    window.addEventListener("medix:ask", handleAsk);
    return () => window.removeEventListener("medix:ask", handleAsk);
  }, []);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId]);

  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden bg-white dark:bg-background">
      <div className="flex w-full min-w-0 flex-col bg-white dark:bg-background">
        <ChatHeader />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-background">
          {isLoading ? (
            <div className="flex-1 bg-white dark:bg-background" />
          ) : (
            <>
              <Messages
                chatId={chatId}
                isLoading={isLoading}
                isReadonly={isReadonly}
                messages={messages}
                onEditMessage={(msg) => {
                  const text = msg.parts
                    ?.filter((p) => p.type === "text")
                    .map((p) => p.text)
                    .join("");
                  setInput(text ?? "");
                  setEditingMessage(msg);
                }}
                regenerate={regenerate}
                selectedModelId={currentModelId}
                setMessages={setMessages}
                status={status}
              />

              <div
                className={cn(
                  "z-20 w-full shrink-0 animate-in fade-in duration-300",
                  showEmptyState
                    ? "pointer-events-none absolute inset-0 flex items-center justify-center px-3 pt-8 sm:px-6"
                    : "sticky bottom-0 bg-white/95 pt-2 pb-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:bg-background/95 dark:supports-[backdrop-filter]:bg-background/80 md:pb-4"
                )}
              >
                <div
                  className={cn(
                    "w-full",
                    showEmptyState
                      ? "pointer-events-auto max-w-[680px] -translate-y-[4vh]"
                      : "mx-auto max-w-[760px]"
                  )}
                >
                  {showEmptyState && (
                    <div className="mb-7 sm:mb-8">
                      <Greeting />
                    </div>
                  )}
                  {!showEmptyState && (
                    <ActiveSourceBar
                      isReadonly={isReadonly}
                      messages={messages}
                    />
                  )}
                  <div className="flex w-full gap-2 px-1 sm:px-2">
                    {!isReadonly && (
                      <MultimodalInput
                        attachments={attachments}
                        chatId={chatId}
                        editingMessage={editingMessage}
                        input={input}
                        onCancelEdit={() => {
                          setEditingMessage(null);
                          setInput("");
                        }}
                        selectedModelId={currentModelId}
                        sendMessage={
                          editingMessage
                            ? async () => {
                                const msg = editingMessage;
                                setEditingMessage(null);
                                await submitEditedMessage({
                                  message: msg,
                                  text: input,
                                  setMessages,
                                  regenerate,
                                });
                                setInput("");
                              }
                            : sendMessage
                        }
                        setAttachments={setAttachments}
                        setInput={setInput}
                        setMessages={setMessages}
                        status={status}
                        stop={stop}
                      />
                    )}
                  </div>
                  <p className="mx-auto mt-2.5 w-full px-3 text-center text-[10.5px] text-muted-foreground/70">
                    Medix is research software, not a medical device. In an
                    emergency, call your local emergency number.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
