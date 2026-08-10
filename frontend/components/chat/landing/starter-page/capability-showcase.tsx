"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  FileSearch,
  ImageIcon,
  MessageCircleMore,
  Mic,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

const expandTransition = {
  duration: 0.68,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export function CapabilityShowcase({
  startChat,
}: {
  startChat: (value?: string) => void;
}) {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [activeCard, setActiveCard] = useState(0);

  return (
    <section className="bg-white py-24 md:py-32" id="features">
      <div className="mx-auto max-w-[92rem] px-5 sm:px-7 md:px-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[2.5rem] font-medium tracking-[-0.05em] text-slate-950 sm:text-5xl">
              Explore Medix
            </h2>
            <p className="mt-3 text-base text-slate-500">
              Guidance, evidence, and context—kept together.
            </p>
          </div>
          <button
            className="group flex w-fit items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-950"
            onClick={() => startChat()}
            type="button"
          >
            Try Medix
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>

        <div className="mt-12 rounded-[2.25rem] border border-slate-200 bg-white p-3 sm:p-4">
          <fieldset
            aria-label="Medix feature cards"
            className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0 lg:h-[35rem] lg:flex-row"
          >
            <motion.article
              animate={{ flexGrow: activeCard === 0 ? 1.7 : 0.78 }}
              aria-label="Guided answers feature"
              className="relative flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] bg-[#f2f4f7] p-6 outline-none ring-sky-500/25 transition-shadow focus-visible:ring-4 sm:p-8 lg:min-h-0 lg:basis-0"
              initial={false}
              layout
              onFocus={() => setActiveCard(0)}
              onMouseEnter={() => setActiveCard(0)}
              tabIndex={0}
              transition={expandTransition}
            >
              <div className="relative z-10 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold tracking-[0.15em] text-slate-400 uppercase">
                    Guided answers
                  </div>
                  <h3 className="mt-4 max-w-xl text-2xl font-medium leading-[1.1] tracking-[-0.04em] text-slate-950 sm:text-3xl">
                    See the next step—and the moment behind it.
                  </h3>
                  <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500">
                    Concise guidance opens at the exact point in a verified
                    medical video.
                  </p>
                </div>
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm">
                  <Play className="ml-0.5 size-4 fill-slate-700" />
                </div>
              </div>

              <div className="relative mt-auto pt-8">
                <div className="relative h-60 overflow-hidden rounded-[1.4rem] bg-[radial-gradient(circle_at_76%_18%,rgba(125,211,252,0.95),transparent_28%),linear-gradient(145deg,#0f172a,#155e75_58%,#38bdf8)] shadow-[0_28px_70px_-40px_rgba(15,23,42,0.65)]">
                  <div className="absolute -right-14 -bottom-24 size-64 rounded-full border-[42px] border-white/10" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      animate={
                        prefersReducedMotion
                          ? undefined
                          : { scale: [1, 1.06, 1] }
                      }
                      className="flex size-16 items-center justify-center rounded-full border border-white/35 bg-white/15 text-white shadow-xl backdrop-blur-xl"
                      transition={{
                        duration: 3.4,
                        ease: "easeInOut",
                        repeat: Number.POSITIVE_INFINITY,
                      }}
                    >
                      <Play className="ml-1 size-5 fill-white" />
                    </motion.div>
                  </div>
                  <div className="absolute right-5 bottom-5 left-5">
                    <div className="h-1 rounded-full bg-white/20">
                      <motion.div
                        animate={{ width: ["28%", "68%", "28%"] }}
                        className="h-full rounded-full bg-white"
                        transition={{
                          duration: 7,
                          ease: "easeInOut",
                          repeat: Number.POSITIVE_INFINITY,
                        }}
                      />
                    </div>
                    <div className="mt-3 flex justify-between gap-4 text-[11px] text-white/70">
                      <span className="truncate">
                        Apply firm, direct pressure
                      </span>
                      <span>0:44</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.article>

            <motion.article
              animate={{ flexGrow: activeCard === 1 ? 1.7 : 0.78 }}
              aria-label="Source trail feature"
              className="relative flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] bg-[#ecefff] p-6 outline-none ring-indigo-500/25 transition-shadow focus-visible:ring-4 sm:p-8 lg:min-h-0 lg:basis-0"
              initial={false}
              layout
              onFocus={() => setActiveCard(1)}
              onMouseEnter={() => setActiveCard(1)}
              tabIndex={0}
              transition={expandTransition}
            >
              <div className="flex items-center justify-between gap-3">
                <FileSearch className="size-5 text-indigo-700" />
                <span className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-medium text-indigo-700">
                  Source attached
                </span>
              </div>
              <h3 className="mt-8 max-w-xl text-2xl font-medium leading-[1.1] tracking-[-0.04em] text-slate-950 sm:text-3xl">
                Know why every step is there.
              </h3>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500">
                Timestamped evidence stays attached, so every important claim
                can be checked.
              </p>

              <div className="relative mt-auto h-56 overflow-hidden pt-7">
                <motion.div
                  animate={
                    prefersReducedMotion ? undefined : { y: [8, -42, 8] }
                  }
                  className="space-y-3"
                  transition={{
                    duration: 8,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                  }}
                >
                  {[
                    ["0:16", "Pack the wound firmly"],
                    ["0:31", "Add gauze until full"],
                    ["0:44", "Maintain direct pressure"],
                    ["0:58", "Reassess while help arrives"],
                  ].map(([time, text]) => (
                    <div
                      className="flex items-center gap-3 rounded-2xl border border-indigo-100 bg-white/85 px-4 py-3 text-xs text-slate-600 shadow-sm"
                      key={time}
                    >
                      <ShieldCheck className="size-3.5 shrink-0 text-indigo-600" />
                      <span className="font-mono text-[10px] text-indigo-500">
                        {time}
                      </span>
                      <span className="truncate">{text}</span>
                    </div>
                  ))}
                </motion.div>
              </div>
            </motion.article>

            <motion.article
              animate={{ flexGrow: activeCard === 2 ? 1.7 : 0.78 }}
              aria-label="Hands-busy input feature"
              className="relative flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] bg-[linear-gradient(150deg,#d9faec,#f8facb)] p-6 outline-none ring-emerald-500/25 transition-shadow focus-visible:ring-4 sm:p-8 lg:min-h-0 lg:basis-0"
              initial={false}
              layout
              onFocus={() => setActiveCard(2)}
              onMouseEnter={() => setActiveCard(2)}
              tabIndex={0}
              transition={expandTransition}
            >
              <div className="flex items-center justify-between gap-3">
                <Sparkles className="size-5 text-emerald-700" />
                <span className="text-[10px] font-semibold tracking-[0.13em] text-emerald-900/45 uppercase">
                  Multimodal
                </span>
              </div>
              <h3 className="mt-8 max-w-xl text-2xl font-medium leading-[1.1] tracking-[-0.04em] text-slate-950 sm:text-3xl">
                Keep moving. Ask however you need.
              </h3>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500">
                Move between voice, images, and follow-ups without losing the
                conversation.
              </p>

              <div className="relative mt-auto h-56">
                <motion.div
                  animate={
                    prefersReducedMotion
                      ? undefined
                      : { x: [-5, 6, -5], y: [0, -4, 0] }
                  }
                  className="absolute top-6 left-0 flex size-28 items-center justify-center rounded-[1.75rem] bg-white/75 text-emerald-700 shadow-lg shadow-emerald-900/5 backdrop-blur-xl"
                  transition={{
                    duration: 5,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                  }}
                >
                  <Mic className="size-7" />
                </motion.div>
                <motion.div
                  animate={
                    prefersReducedMotion
                      ? undefined
                      : { x: [5, -6, 5], y: [0, 5, 0] }
                  }
                  className="absolute right-0 bottom-2 flex size-32 items-center justify-center rounded-[1.75rem] border border-white/70 bg-white/60 text-emerald-800 shadow-lg shadow-emerald-900/5 backdrop-blur-xl"
                  transition={{
                    duration: 6,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                  }}
                >
                  <ImageIcon className="size-8" />
                </motion.div>
              </div>
            </motion.article>
          </fieldset>
        </div>

        <div className="mt-20 border-t border-slate-200 pt-10">
          <div className="grid gap-10 md:grid-cols-3 md:gap-16">
            {[
              {
                icon: MessageCircleMore,
                title: "Context that carries forward",
                body: "Follow-up questions stay connected to the original evidence.",
              },
              {
                icon: ShieldCheck,
                title: "Sources, not black boxes",
                body: "Inspect the timestamp supporting each critical step.",
              },
              {
                icon: Play,
                title: "Only the moment you need",
                body: "Jump directly to the relevant section of the video.",
              },
            ].map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title}>
                  <Icon className="size-5 text-sky-700" />
                  <h3 className="mt-5 text-lg font-semibold tracking-[-0.025em] text-slate-950">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {feature.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
