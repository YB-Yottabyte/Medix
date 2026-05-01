"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LandingSection } from "./landing-section";

export function PipelineSection({
  prefersReducedMotion,
}: {
  prefersReducedMotion: boolean;
}) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % 4);
    }, 2400);

    return () => window.clearInterval(intervalId);
  }, [prefersReducedMotion]);

  const pipelineSteps = [
    {
      title: "Capture",
      body: "Voice, image, or scene input enters the Medix workflow.",
    },
    {
      title: "Ground",
      body: "SAM-style segmentation locks Medix onto the relevant region.",
    },
    {
      title: "Retrieve",
      body: "Transcript search and metadata attach the right procedure clip.",
    },
    {
      title: "Respond",
      body: "Medix returns a concise answer with guided video support.",
    },
  ];

  return (
    <LandingSection className="py-24 md:py-28" id="pipeline" index={2}>
      <div className="mx-auto max-w-7xl px-6 md:px-10 lg:px-12">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="max-w-xl">
            <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-400 uppercase">
              Pipeline
            </div>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] text-slate-950 md:text-4xl">
              The Medix pipeline turns raw input into grounded guidance
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-600">
              This is the system view behind the demo: Medix captures context,
              grounds attention, retrieves the best procedure evidence, and
              returns a response that stays useful under pressure.
            </p>

            <div className="mt-8 space-y-4">
              {pipelineSteps.map((step, index) => {
                const isActive = index === activeStep;
                const isComplete = index < activeStep;

                return (
                  <motion.div
                    animate={{
                      opacity: isActive || isComplete ? 1 : 0.62,
                      y: isActive ? -2 : 0,
                      scale: isActive ? 1.01 : 1,
                    }}
                    className={cn(
                      "rounded-[1.35rem] border px-5 py-4 shadow-sm transition-colors duration-300",
                      isActive
                        ? "border-white bg-white text-slate-950"
                        : "border-slate-200 bg-white text-slate-950"
                    )}
                    initial={false}
                    key={step.title}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          isActive
                            ? "bg-slate-950 text-white"
                            : isComplete
                              ? "bg-white text-slate-950"
                              : "bg-slate-100 text-slate-500"
                        )}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <div className="text-base font-semibold text-slate-950">
                          {step.title}
                        </div>
                        <div className="mt-1 text-sm leading-6 text-slate-600">
                          {step.body}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="mx-auto w-full max-w-[38rem]">
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#111418] p-4 shadow-[0_28px_70px_-44px_rgba(0,0,0,0.42)] md:p-5">
              <div className="overflow-hidden rounded-[1.65rem] border border-white/10 bg-[linear-gradient(180deg,#171a20_0%,#0f1318_100%)]">
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-rose-300" />
                    <span className="size-2.5 rounded-full bg-amber-300" />
                    <span className="size-2.5 rounded-full bg-emerald-300" />
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-medium tracking-[0.06em] text-white/78 uppercase">
                    Medix pipeline
                  </div>
                </div>

                <div className="p-5 md:p-6">
                  <div className="grid gap-4">
                    {pipelineSteps.map((step, index) => {
                      const isActive = index === activeStep;
                      const isComplete = index < activeStep;

                      return (
                        <div className="flex items-center gap-3" key={step.title}>
                          <div className="relative flex h-full w-8 justify-center">
                            <motion.div
                              animate={{
                                backgroundColor: isComplete
                                  ? "rgb(255 255 255)"
                                  : isActive
                                    ? "rgb(255 255 255)"
                                    : "rgba(255,255,255,0.18)",
                                scale: isActive ? 1.1 : 1,
                              }}
                              className="relative z-10 mt-2 h-4 w-4 rounded-full border-2 border-[#111418] shadow-sm"
                              initial={false}
                              transition={{ duration: 0.35, ease: "easeOut" }}
                            />
                            {index < pipelineSteps.length - 1 && (
                              <div className="absolute top-6 bottom-[-1.15rem] w-px bg-white/10">
                                <motion.div
                                  animate={{
                                    height:
                                      activeStep > index
                                        ? "100%"
                                        : activeStep === index
                                          ? "45%"
                                          : "0%",
                                  }}
                                  className="w-full bg-white"
                                  initial={false}
                                  transition={{ duration: 0.65, ease: "easeOut" }}
                                />
                              </div>
                            )}
                          </div>

                          <motion.div
                            animate={{
                              opacity: isActive || isComplete ? 1 : 0.55,
                              scale: isActive ? 1.01 : 1,
                              borderColor: isActive
                                ? "rgba(255,255,255,0)"
                                : "rgba(255,255,255,0.08)",
                            }}
                            className={cn(
                              "flex-1 rounded-[1.3rem] border px-4 py-4 shadow-sm",
                              isActive
                                ? "bg-white text-slate-950"
                                : "bg-white/5 text-white"
                            )}
                            initial={false}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div
                                  className={cn(
                                    "text-sm font-semibold",
                                    isActive ? "text-slate-950" : "text-white"
                                  )}
                                >
                                  {step.title}
                                </div>
                                <div
                                  className={cn(
                                    "mt-1 text-sm leading-6",
                                    isActive ? "text-slate-600" : "text-white/68"
                                  )}
                                >
                                  {step.body}
                                </div>
                              </div>
                              <motion.div
                                animate={{
                                  opacity: isActive ? 1 : 0.32,
                                  x: isActive ? 0 : -6,
                                }}
                                className={cn(
                                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                                  isActive
                                    ? "bg-slate-950 text-white"
                                    : "bg-white/8 text-white"
                                )}
                                initial={false}
                              >
                                <ArrowRight className="size-4" />
                              </motion.div>
                            </div>

                            {isActive && (
                              <motion.div
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                                initial={{ opacity: 0, y: 6 }}
                                transition={{ duration: 0.35, ease: "easeOut" }}
                              >
                                {index === 0 &&
                                  "Incoming stream: image, prompt, and caregiver context."}
                                {index === 1 &&
                                  "Grounded region selected before reasoning begins."}
                                {index === 2 &&
                                  "Procedure timestamps and transcript evidence attached."}
                                {index === 3 &&
                                  "Response assembled with concise text plus video guidance."}
                              </motion.div>
                            )}
                          </motion.div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LandingSection>
  );
}
