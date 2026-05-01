"use client";

import { motion } from "framer-motion";
import { ArrowRight, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { capabilityPills } from "./data";
import { LandingSection } from "./landing-section";

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
    <LandingSection className="relative py-24 md:py-32" index={0}>
      <div className="mx-auto max-w-7xl px-6 md:px-10 lg:px-12">
        <div className="text-center">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="group mx-auto flex w-fit items-center gap-4 rounded-full border border-slate-200 bg-white/95 p-1 pl-4 shadow-md shadow-slate-200/60 transition-colors duration-300 hover:bg-background"
            initial={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="text-foreground text-sm">
              HCI Research · ASU Barrett Honors College
            </span>
            <span className="block h-4 w-px bg-slate-200" />
            <div className="bg-background size-7 overflow-hidden rounded-full border border-slate-200 duration-500">
              <div className="flex w-14 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0">
                <span className="flex size-7">
                  <ArrowRight className="m-auto size-3.5" />
                </span>
                <span className="flex size-7">
                  <ArrowRight className="m-auto size-3.5" />
                </span>
              </div>
            </div>
          </motion.div>

          <motion.h1
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            className="mx-auto mt-7 max-w-4xl text-balance text-5xl text-slate-950 max-md:font-semibold md:text-7xl lg:mt-12 xl:text-[5.25rem]"
            initial={{ opacity: 0, filter: "blur(12px)", y: 12 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          >
            Hands-free medical guidance for caregivers
          </motion.h1>

          <motion.p
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            className="mx-auto mt-6 max-w-3xl text-balance text-lg leading-8 text-slate-600"
            initial={{ opacity: 0, filter: "blur(12px)", y: 12 }}
            transition={{
              delay: 0.08,
              duration: 0.9,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            Medix uses voice, egocentric video, and visual grounding to guide
            non-expert caregivers through CPR, wound care, and emergency
            procedures — hands-free, in real time.
          </motion.p>

          <motion.div
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            className="mt-9 flex flex-col items-center justify-center gap-2 md:flex-row"
            initial={{ opacity: 0, filter: "blur(12px)", y: 12 }}
            transition={{
              delay: 0.16,
              duration: 0.9,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="rounded-[calc(var(--radius-xl)+0.125rem)] border border-slate-200 bg-slate-950/5 p-0.5">
              <Button
                className="group relative min-h-14 overflow-hidden rounded-xl border-slate-200 bg-white px-8 py-7 text-base text-slate-950"
                onClick={() => startChat()}
                size="lg"
                variant="outline"
              >
                <span className="absolute inset-0 -translate-x-full bg-slate-950 transition-transform duration-300 ease-out group-hover:translate-x-0" />
                <span className="relative z-10 transition-colors duration-300 ease-out group-hover:text-white">
                  Try the Demo
                </span>
              </Button>
            </div>
            <Button
              asChild
              className="group relative min-h-14 overflow-hidden rounded-xl border border-slate-200 bg-white px-8 py-7 text-base text-slate-950"
              size="lg"
              variant="outline"
            >
              <a
                href="https://github.com/ZB-ZettaByte/Medix"
                rel="noreferrer"
                target="_blank"
              >
                <span className="absolute inset-0 -translate-x-full bg-slate-950 transition-transform duration-300 ease-out group-hover:translate-x-0" />
                <span className="relative z-10 transition-colors duration-300 ease-out group-hover:text-white">
                  Read the Paper
                </span>
              </a>
            </Button>
          </motion.div>
        </div>

        <motion.section
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          className="relative mx-auto mt-14 max-w-5xl md:mt-16"
          id="features"
          initial={{ opacity: 0, filter: "blur(12px)", y: 12 }}
          transition={{
            delay: 0.24,
            duration: 0.95,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <div className="rounded-[2rem] border border-slate-200 bg-white p-3 shadow-[0_22px_52px_-36px_rgba(15,23,42,0.12)] md:p-4">
            <div className="overflow-hidden rounded-[1.65rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))]">
              <textarea
                aria-label="Starter prompt"
                className="block min-h-[7rem] w-full resize-none border-0 bg-transparent px-7 pt-5 pb-3 text-[15px] leading-7 tracking-[0.002em] text-slate-700 outline-none placeholder:text-slate-400"
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
                placeholder={typedPlaceholder || " "}
                rows={5}
                value={prompt}
              />

              <div className="border-t border-slate-200/80 px-6 pt-3 pb-4">
                <div className="flex flex-wrap justify-center gap-2">
                  {capabilityPills.map((pill) => (
                    <button
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-600 transition-colors hover:border-sky-200 hover:text-slate-950"
                      key={pill}
                      onClick={() =>
                        setPrompt((current) =>
                          current ? `${current} ${pill}` : pill
                        )
                      }
                      type="button"
                    >
                      {pill}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      aria-label="Attach file"
                      className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-sky-200 hover:text-slate-900"
                      type="button"
                    >
                      <Paperclip className="size-4" />
                    </button>
                    <div className="text-sm text-slate-500">
                      Medix assistant
                    </div>
                  </div>

                  <button
                    aria-label="Send message"
                    className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-sm transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
                    disabled={!prompt.trim()}
                    onClick={() => startChat()}
                    type="button"
                  >
                    <ArrowRight className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      </div>
    </LandingSection>
  );
}
