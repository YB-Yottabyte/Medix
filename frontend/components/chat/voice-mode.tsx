"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowUpIcon, MicIcon, Volume2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChatMessage } from "@/lib/types";
import { getVerifiedVoiceAnswer } from "@/lib/voice-answer";
import { DictationButton } from "./dictation-button";
import { useResponseAudio } from "./response-audio-button";

type VoiceModeProps = {
  messages: ChatMessage[];
  onClose: () => void;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
};

export function VoiceMode({
  messages,
  onClose,
  sendMessage,
  status,
}: VoiceModeProps) {
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [notice, setNotice] = useState("");
  const [answerId, setAnswerId] = useState<string | null>(null);
  const previousAssistantIdRef = useRef<string | null>(null);
  const playedAnswerIdRef = useRef<string | null>(null);
  const { isActive: isSpeaking, toggleSpeech } = useResponseAudio(answer);

  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  useEffect(() => {
    if (!awaitingAnswer) {
      return;
    }
    if (status === "error") {
      setAwaitingAnswer(false);
      setNotice("The answer could not be completed. Please try again.");
      return;
    }
    if (
      status !== "ready" ||
      !lastAssistant ||
      lastAssistant.id === previousAssistantIdRef.current
    ) {
      return;
    }

    const verifiedAnswer = getVerifiedVoiceAnswer(lastAssistant);
    setAwaitingAnswer(false);
    if (verifiedAnswer) {
      setAnswer(verifiedAnswer);
      setAnswerId(lastAssistant.id);
      setNotice("");
    } else {
      setAnswer("");
      setNotice(
        "This response has no checked, cited procedure answer to read aloud. Review it in the chat."
      );
    }
  }, [awaitingAnswer, lastAssistant, status]);

  useEffect(() => {
    if (!answerId || playedAnswerIdRef.current === answerId) {
      return;
    }
    playedAnswerIdRef.current = answerId;
    toggleSpeech().catch(() => undefined);
  }, [answerId, toggleSpeech]);

  const submitQuestion = () => {
    const question = draft.trim();
    if (!question || awaitingAnswer || status !== "ready") {
      return;
    }

    if (isSpeaking) {
      toggleSpeech().catch(() => undefined);
    }
    previousAssistantIdRef.current = lastAssistant?.id ?? null;
    setAwaitingAnswer(true);
    setIsListening(false);
    setAnswer("");
    setAnswerId(null);
    setNotice("");
    setDraft("");
    sendMessage({
      parts: [{ text: question, type: "text" }],
      role: "user",
    }).catch(() => {
      setAwaitingAnswer(false);
      setNotice("The question could not be sent. Please try again.");
    });
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogContent
        className="!fixed !inset-0 !top-0 !left-0 !flex !h-dvh !w-screen !max-w-none !translate-x-0 !translate-y-0 flex-col items-center justify-between overflow-y-auto rounded-none bg-white px-5 py-6 text-slate-950 ring-0 dark:bg-background dark:text-foreground"
        showCloseButton
      >
        <div className="w-full max-w-3xl">
          <DialogTitle className="font-semibold text-base">
            Medix Voice
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-xl text-sm">
            Speak a question, check the transcript, then send it through Medix’s
            evidence pipeline.
          </DialogDescription>
        </div>

        <div className="flex w-full flex-1 flex-col items-center justify-center gap-7 py-8 text-center">
          <div
            aria-hidden
            className="size-24 rounded-full bg-[radial-gradient(circle_at_35%_30%,#f8fafc_0%,#c7d2fe_28%,#818cf8_65%,#dbeafe_100%)] shadow-[0_18px_70px_rgba(99,102,241,0.24)]"
          />
          <div aria-live="polite" className="max-w-2xl space-y-3">
            <p className="font-medium text-slate-600 text-sm dark:text-slate-300">
              {awaitingAnswer
                ? "Checking the evidence…"
                : isListening
                  ? "Listening… Tap the microphone to stop."
                  : isSpeaking
                    ? "Reading the checked answer…"
                    : answer
                      ? "Answer ready"
                      : "Tap the microphone or type a question"}
            </p>
            {answer && (
              <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-left text-base text-slate-800 leading-7 dark:text-slate-100">
                {answer}
              </p>
            )}
            {notice && (
              <p className="text-amber-700 text-sm leading-6 dark:text-amber-300">
                {notice}
              </p>
            )}
          </div>
        </div>

        <div className="w-full max-w-3xl space-y-3">
          <div className="flex items-end gap-2 rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_10px_35px_rgba(15,23,42,0.07)] dark:border-border dark:bg-background">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-muted">
              {!awaitingAnswer && status === "ready" ? (
                <DictationButton
                  onListeningChange={setIsListening}
                  onTranscript={(text) =>
                    setDraft((current) =>
                      current ? `${current.trimEnd()} ${text}` : text
                    )
                  }
                />
              ) : (
                <MicIcon className="size-4 text-slate-400" />
              )}
            </div>
            <textarea
              aria-label="Review your spoken question"
              className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-slate-400"
              disabled={awaitingAnswer}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Your question appears here. You can edit it before sending."
              rows={1}
              value={draft}
            />
            {answer && (
              <button
                aria-label={isSpeaking ? "Stop reading" : "Read answer aloud"}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-muted"
                onClick={() => toggleSpeech().catch(() => undefined)}
                type="button"
              >
                <Volume2Icon className="size-4" />
              </button>
            )}
            <button
              aria-label="Send spoken question"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white disabled:bg-slate-100 disabled:text-slate-300 dark:bg-white dark:text-slate-950"
              disabled={!draft.trim() || awaitingAnswer || status !== "ready"}
              onClick={submitQuestion}
              type="button"
            >
              <ArrowUpIcon className="size-4" />
            </button>
          </div>
          <p className="text-center text-slate-500 text-xs leading-5">
            Voice recognition depends on your browser. Checked answers and
            source citations stay in the chat.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
