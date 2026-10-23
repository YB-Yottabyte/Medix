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
import { VoiceMode } from "./voice-mode";

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
  const [voiceOpen, setVoiceOpen] = useState(false);
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
        parts: [{ text, type: "text" }],
        role: "user",
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
      setVoiceOpen(false);
    }
  }, [chatId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (
      !url.pathname.endsWith(`/chat/${chatId}`) ||
      url.searchParams.get("voice") !== "1"
    ) {
      return;
    }
    setVoiceOpen(true);
    url.searchParams.delete("voice");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [chatId]);

  return (
    <div className="flex h-dvh w-full flex-row overflow-hidden bg-background">
      <div className="flex w-full min-w-0 flex-col bg-background">
        <ChatHeader />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          {isLoading ? (
            <div className="flex-1 bg-background" />
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
                  "fade-in z-20 w-full shrink-0 animate-in duration-300",
                  showEmptyState
                    ? "pointer-events-none absolute inset-0 flex items-center justify-center px-3 pt-8 sm:px-6"
                    : "sticky bottom-0 bg-background/95 pt-2 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:pb-4"
                )}
              >
                <div
                  className={cn(
                    "w-full",
                    showEmptyState
                      ? "pointer-events-auto max-w-[720px] -translate-y-[3vh]"
                      : "mx-auto max-w-[760px]"
                  )}
                >
                  {showEmptyState && (
                    <div className="mb-10 sm:mb-12">
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
                        className={
                          showEmptyState
                            ? "[&_textarea]:min-h-20 [&_textarea]:text-[15px]"
                            : undefined
                        }
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
                                  regenerate,
                                  setMessages,
                                  text: input,
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
      {voiceOpen && !isReadonly && (
        <VoiceMode
          messages={messages}
          onClose={() => setVoiceOpen(false)}
          sendMessage={sendMessage}
          status={status}
        />
      )}
    </div>
  );
}
