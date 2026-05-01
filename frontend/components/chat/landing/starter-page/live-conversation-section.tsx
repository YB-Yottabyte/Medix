"use client";

import { motion } from "framer-motion";
import { Sparkles, Stethoscope } from "lucide-react";
import { LandingSection } from "./landing-section";

export function LiveConversationSection({
  typedQuestion,
  typedResponse,
  showThinking,
  showProcedureCard,
}: {
  typedQuestion: string;
  typedResponse: string;
  showThinking: boolean;
  showProcedureCard: boolean;
}) {
  return (
    <LandingSection className="py-24 md:py-32" index={1}>
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10 lg:px-12">
        <motion.div
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          className="mx-auto mb-8 max-w-2xl text-center md:mb-10"
          initial={{ opacity: 0, filter: "blur(12px)", y: 12 }}
          transition={{
            delay: 0.28,
            duration: 0.8,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] text-slate-950 md:text-4xl">
            See how Medix listens and surfaces the right procedure
          </h2>
        </motion.div>

        <motion.section
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          className="w-full rounded-[2rem] border border-white/10 bg-[#111418] p-8 shadow-[0_20px_54px_-38px_rgba(15,23,42,0.28)] md:p-12 lg:p-14"
          initial={{ opacity: 0, filter: "blur(12px)", y: 12 }}
          transition={{
            delay: 0.32,
            duration: 0.95,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <div className="overflow-hidden rounded-[1.8rem] border border-white/10 bg-[#141414] p-3 shadow-[0_14px_36px_-32px_rgba(0,0,0,0.35)] md:p-4">
            <div className="relative overflow-hidden rounded-[1.45rem] border border-white/8 bg-[linear-gradient(135deg,#1a1a1c_0%,#111214_52%,#18181b_100%)] p-4 md:p-5">
              <div className="rounded-[1.35rem] border border-white/8 bg-[#1a1b1f]/95 shadow-sm">
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-rose-300" />
                    <span className="size-2.5 rounded-full bg-amber-300" />
                    <span className="size-2.5 rounded-full bg-emerald-300" />
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-[11px] font-medium tracking-[0.04em] text-sky-100 uppercase">
                    <Sparkles className="size-3.5" />
                    Live Medix conversation
                  </div>
                </div>

                <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_19rem] xl:p-6">
                  <div className="min-h-[46rem] p-5 md:min-h-[50rem] md:p-6">
                    <div className="space-y-5">
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-[1.35rem] rounded-br-md border border-slate-200/80 bg-white px-4 py-3 text-left shadow-sm">
                          <div className="text-sm leading-7 text-slate-800">
                            {typedQuestion || (
                              <span className="text-slate-300">
                                Waiting for the question...
                              </span>
                            )}
                            <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-slate-300 align-middle" />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#20222a,#0f1115)] text-white">
                          <Stethoscope className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1 rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-4 shadow-sm">
                          <div className="mb-2 flex items-center gap-2 text-xs text-white/45">
                            <span className="font-medium text-white/88">
                              Medix
                            </span>
                            {showThinking ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="size-1.5 rounded-full bg-white/35" />
                                <span className="size-1.5 rounded-full bg-white/35 [animation-delay:120ms]" />
                                <span className="size-1.5 rounded-full bg-white/35 [animation-delay:240ms]" />
                                Thinking
                              </span>
                            ) : (
                              <span>Responding</span>
                            )}
                          </div>

                          <div className="text-left text-[15px] leading-7 text-white/84">
                            {typedResponse || (
                              <span className="text-white/28">
                                Preparing the response...
                              </span>
                            )}
                            {!showThinking && (
                              <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-white/35 align-middle" />
                            )}
                          </div>

                          <motion.div
                            animate={{
                              opacity: showProcedureCard ? 1 : 0,
                              y: showProcedureCard ? 0 : 12,
                            }}
                            className="mt-4 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/5 shadow-sm"
                            initial={false}
                            transition={{
                              duration: 0.32,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                          >
                            <div className="border-b border-white/8 px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.08em] text-white/35">
                                Matched procedure
                              </div>
                              <div className="mt-1 font-medium text-white/92">
                                How to treat cuts and scrapes?
                              </div>
                              <div className="mt-1 text-sm text-white/45">
                                Jumps to 0:12 - 0:49 of the source video.
                              </div>
                            </div>

                            <div className="px-4 py-4">
                              <div className="overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#10151d]">
                                <div className="relative aspect-[16/9] bg-[linear-gradient(135deg,#2b3442_0%,#111827_100%)]">
                                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.14),transparent_42%)]" />
                                  <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/65 to-transparent" />
                                  <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-medium text-white">
                                    VIDEO
                                  </div>
                                  <div className="absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-medium text-white">
                                    0:37
                                  </div>
                                  <div className="absolute inset-x-0 top-[46%] flex -translate-y-1/2 justify-center">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/92 shadow-lg ring-1 ring-black/10">
                                      <div className="ml-0.5 h-0 w-0 border-y-[7px] border-y-transparent border-l-[10px] border-l-slate-900" />
                                    </div>
                                  </div>
                                  <div className="absolute bottom-3 left-3 right-3 text-sm font-medium text-white">
                                    How to treat cuts and scrapes
                                  </div>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="rounded-[1.2rem] border border-white/8 bg-white/5 px-4 py-4 shadow-sm">
                      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/35">
                        Demo flow
                      </div>
                      <div className="mt-2 text-sm leading-6 text-white/68">
                        Ask a question, wait through a brief thinking state,
                        and watch Medix attach grounded procedural guidance for
                        the caregiver.
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      {[
                        ["Segmentation", "Focus the relevant region first"],
                        ["Groq Vision", "Interpret the image before search"],
                        ["Qdrant Search", "Retrieve the closest transcript"],
                        ["Neon Metadata", "Attach procedure and timing data"],
                      ].map(([title, body]) => (
                        <div
                          className="rounded-[1.05rem] border border-white/8 bg-white/5 px-4 py-3 shadow-sm"
                          key={title}
                        >
                          <div className="text-sm font-medium text-white/90">
                            {title}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-white/45">
                            {body}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.section>
      </div>
    </LandingSection>
  );
}
