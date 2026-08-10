"use client";

import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { codeHref } from "./data";

export function ResearchSection({
  startChat,
}: {
  startChat: (value?: string) => void;
}) {
  return (
    <section className="bg-white py-20 md:py-28" id="quest3-research">
      <div className="mx-auto max-w-[92rem] px-5 sm:px-7 md:px-10">
        <div className="rounded-[2rem] bg-[#f3f3f3] px-6 py-20 text-center sm:px-10 md:py-28">
          <div className="text-[11px] font-semibold tracking-[0.15em] text-slate-500 uppercase">
            ASU Barrett Honors College
          </div>
          <h2 className="mx-auto mt-5 max-w-3xl text-balance text-[2.5rem] font-medium leading-[1.08] tracking-[-0.05em] text-slate-950 sm:text-5xl md:text-6xl">
            Built for research. Designed for clarity.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-slate-500">
            Medix studies evidence-grounded guidance for caregivers.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button
              className="group rounded-full bg-slate-950 px-5 text-white hover:bg-slate-800"
              onClick={() => startChat()}
            >
              Try Medix
              <ArrowRight className="ml-1 size-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button
              asChild
              className="rounded-full border-slate-200 bg-white px-5 text-slate-800 hover:bg-slate-50"
              variant="outline"
            >
              <a href={codeHref} rel="noreferrer" target="_blank">
                View research code
                <ArrowUpRight className="ml-1 size-4" />
              </a>
            </Button>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-slate-400">
          Medix is a research prototype, not a medical device. It does not
          replace professional judgment or emergency care.
        </p>
      </div>
    </section>
  );
}
