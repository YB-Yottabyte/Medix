"use client";

import { motion } from "framer-motion";
import {
  AudioLines,
  LibraryBig,
  MessageSquareText,
  ScanLine,
} from "lucide-react";
import { useEffect, useState } from "react";

const pipelineSteps = [
  {
    title: "Capture",
    body: "Question, voice, or image",
    icon: AudioLines,
  },
  {
    title: "Focus",
    body: "Relevant context",
    icon: ScanLine,
  },
  {
    title: "Retrieve",
    body: "Verified evidence",
    icon: LibraryBig,
  },
  {
    title: "Guide",
    body: "Answer with sources",
    icon: MessageSquareText,
  },
];

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
      setActiveStep((current) => (current + 1) % pipelineSteps.length);
    }, 2200);

    return () => window.clearInterval(intervalId);
  }, [prefersReducedMotion]);

  return (
    <section className="bg-[#f5f6f7] py-24 md:py-32" id="pipeline">
      <div className="mx-auto max-w-[92rem] px-5 sm:px-7 md:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-[11px] font-semibold tracking-[0.15em] text-sky-700 uppercase">
            How it works
          </div>
          <h2 className="mt-4 text-balance text-[2.5rem] font-medium leading-[1.08] tracking-[-0.05em] text-slate-950 sm:text-5xl">
            One simple path from question to evidence.
          </h2>
        </div>

        <div className="relative mt-16">
          <div className="absolute top-7 right-[12%] left-[12%] hidden h-px bg-slate-300 md:block">
            <motion.div
              animate={{ scaleX: (activeStep + 1) / pipelineSteps.length }}
              className="h-full origin-left bg-slate-950"
              initial={false}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-4 md:gap-6">
            {pipelineSteps.map((step, index) => {
              const Icon = step.icon;
              const isActive = activeStep === index;

              return (
                <button
                  className="group relative z-10 rounded-[1.5rem] border border-slate-200 bg-white p-5 text-left transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm md:border-transparent md:bg-transparent md:p-0 md:text-center md:hover:translate-y-0 md:hover:border-transparent md:hover:shadow-none"
                  key={step.title}
                  onClick={() => setActiveStep(index)}
                  type="button"
                >
                  <motion.div
                    animate={{
                      backgroundColor: isActive ? "#020617" : "#ffffff",
                      color: isActive ? "#ffffff" : "#475569",
                      scale: isActive ? 1.08 : 1,
                    }}
                    className="flex size-14 items-center justify-center rounded-full border border-slate-200 shadow-sm md:mx-auto"
                    initial={false}
                    transition={{ duration: 0.35 }}
                  >
                    <Icon className="size-5" />
                  </motion.div>
                  <div className="mt-5 text-[10px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
                    0{index + 1}
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">{step.body}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
