"use client";

import { motion } from "framer-motion";
import {
  ArrowUp,
  FileSearch,
  ImageIcon,
  Mic,
  Paperclip,
  Stethoscope,
} from "lucide-react";
import { LandingSection } from "./landing-section";

const promptSuggestions = [
  {
    label: "Ask a question",
    prompt: "What should I do for a minor burn?",
    icon: Stethoscope,
  },
  {
    label: "Use voice",
    prompt: "How do I control bleeding while help is on the way?",
    icon: Mic,
  },
  {
    label: "Add an image",
    prompt: "Can you help me understand what I am looking at?",
    icon: ImageIcon,
  },
  {
    label: "Find evidence",
    prompt: "Show me the video evidence for wound care.",
    icon: FileSearch,
  },
];

export function HeroSection({
  prompt,
  setPrompt,
  typedPlaceholder,
  startChat,
}: {
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  typedPlaceholder: string;
  startChat: (value?: string) => void;
}) {
  return (
    <LandingSection
      className="relative flex min-h-dvh items-center overflow-hidden pt-24 pb-16"
      index={0}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_50%_12%,rgba(224,242,254,0.42),transparent_48%)]" />

      <div className="relative mx-auto w-full max-w-5xl px-5 text-center sm:px-7">
        <motion.h1
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-2xl text-balance text-[2.35rem] font-medium leading-[1.08] tracking-[-0.05em] text-slate-950 sm:text-[3.15rem] md:text-[3.5rem]"
          initial={false}
        >
          What can Medix help with?
        </motion.h1>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-8 max-w-[52rem]"
          initial={false}
        >
          <div className="rounded-[1.65rem] border border-slate-200 bg-white p-3 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.35)] transition-shadow focus-within:shadow-[0_28px_80px_-38px_rgba(15,23,42,0.42)]">
            <textarea
              aria-label="Ask Medix a question"
              className="block min-h-20 w-full resize-none border-0 bg-transparent px-3 pt-2 text-[15px] leading-6 text-slate-800 outline-none placeholder:text-slate-400"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  startChat();
                }
              }}
              placeholder={typedPlaceholder || "Ask Medix"}
              rows={3}
              value={prompt}
            />

            <div className="flex items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-1">
                <button
                  aria-label="Attach a file"
                  className="flex size-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  type="button"
                >
                  <Paperclip className="size-4" />
                </button>
                <button
                  aria-label="Use voice input"
                  className="flex size-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                  type="button"
                >
                  <Mic className="size-4" />
                </button>
              </div>
              <button
                aria-label="Send question"
                className="flex size-10 items-center justify-center rounded-full bg-slate-950 text-white transition-colors hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-300"
                disabled={!prompt.trim()}
                onClick={() => startChat()}
                type="button"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {promptSuggestions.map((suggestion) => {
              const Icon = suggestion.icon;
              return (
                <button
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3.5 py-2 text-xs text-slate-600 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-950"
                  key={suggestion.label}
                  onClick={() => setPrompt(suggestion.prompt)}
                  type="button"
                >
                  <Icon className="size-3.5" />
                  {suggestion.label}
                </button>
              );
            })}
          </div>
        </motion.div>

        <p className="mt-8 text-xs text-slate-400">
          Research prototype · Not a substitute for professional medical care
        </p>
      </div>
    </LandingSection>
  );
}
