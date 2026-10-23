"use client";

import { ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import { LandingSection } from "./landing-section";

const promptSuggestions = [
  { label: "Medical questions", prompt: "What should I do for a minor burn?" },
  {
    label: "Video evidence",
    prompt: "Show me the video evidence for wound care.",
  },
  { label: "Bandaging", prompt: "How do I bandage a hand?" },
  { label: "Wound care", prompt: "How do I clean a minor wound?" },
  {
    label: "First aid",
    prompt: "How do I check whether a bandage is too tight?",
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
      className="relative flex min-h-dvh items-center overflow-hidden bg-[#f5f5f5] pt-24 pb-16"
      index={0}
    >
      <div className="relative mx-auto w-full max-w-4xl px-5 text-center sm:px-7">
        <motion.h1
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-2xl text-balance font-medium text-[1.8rem] leading-[1.15] tracking-[-0.035em] sm:text-[2.25rem]"
          initial={false}
        >
          Ask Medix, See Why
        </motion.h1>

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-10 max-w-[44rem] sm:mt-12"
          initial={false}
        >
          <div className="rounded-2xl border border-border bg-card p-3 shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-primary/25">
            <textarea
              aria-label="Ask Medix a question"
              className="block min-h-16 w-full resize-none border-0 bg-transparent px-3 pt-2 text-[15px] text-slate-800 leading-6 outline-none placeholder:text-slate-400"
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
              rows={2}
              value={prompt}
            />

            <div className="flex justify-end px-1">
              <button
                aria-label="Send question"
                className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/40"
                disabled={!prompt.trim()}
                onClick={() => startChat()}
                type="button"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {promptSuggestions.map((suggestion) => (
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-card px-3 text-foreground/80 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                key={suggestion.label}
                onClick={() => setPrompt(suggestion.prompt)}
                type="button"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </motion.div>

        <p className="mt-8 text-slate-400 text-xs">
          Research prototype · Not a substitute for professional medical care
        </p>
      </div>
    </LandingSection>
  );
}
