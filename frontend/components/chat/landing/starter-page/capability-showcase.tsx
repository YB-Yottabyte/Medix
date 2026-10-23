"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { codeHref } from "./data";
import { EvidenceCardPreview, ResearchCardPreview } from "./feature-previews";

const examples = [
  {
    question: "Show me how to bandage a hand, with video references.",
    title: "Bandaging",
  },
  {
    question: "Find a demonstration of how to clean a minor wound.",
    title: "Wound care",
  },
  {
    question: "How can I tell whether a bandage is too tight?",
    title: "Follow-up questions",
  },
];

export function CapabilityShowcase({
  startChat,
}: {
  startChat: (value?: string) => void;
}) {
  const reducedMotion = Boolean(useReducedMotion());

  return (
    <div className="bg-[#f5f5f5] text-neutral-950">
      <section
        aria-labelledby="capabilities-title"
        className="scroll-mt-24 border-neutral-200 border-y py-16 md:py-24"
        id="features"
      >
        <div className="mx-auto max-w-5xl px-6">
          <h2
            className="font-semibold text-2xl tracking-tight sm:text-3xl"
            id="capabilities-title"
          >
            Built around your question.
          </h2>
          <div className="medix-feature-deck mt-8 grid gap-4">
            <motion.article
              className="medix-feature-card group relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-[#eeeef6] p-6"
              data-feature-card="medix"
              initial={reducedMotion ? false : { opacity: 0, y: 18 }}
              tabIndex={0}
              transition={{ duration: 0.45 }}
              viewport={{ amount: 0.15, once: true }}
              whileHover={reducedMotion ? undefined : { y: -4 }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-xl">Medix</h3>
                <button
                  className="medix-blue-sweep medix-card-action absolute top-6 right-6 inline-flex min-h-10 items-center gap-1 rounded-xl border border-primary bg-primary px-3 text-primary-foreground text-xs focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => startChat()}
                  type="button"
                >
                  Try Medix
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </button>
              </div>
              <p className="mt-5 text-neutral-500 text-sm leading-6 md:line-clamp-3 md:min-h-[4.5rem]">
                Ask a medical question, review the available evidence, and
                continue with focused follow-ups.
              </p>
              <div
                aria-hidden="true"
                className="medix-card-preview mt-8 h-48 shrink-0 overflow-hidden rounded-t-xl border border-neutral-200 bg-card p-4 transition-transform duration-500 group-hover:-translate-y-1 motion-reduce:transform-none"
              >
                <div className="mb-5 flex items-center gap-1.5 border-border border-b pb-3">
                  <span className="size-1.5 rounded-full bg-primary/50" />
                  <span className="text-[10px] text-muted-foreground">
                    Conversation preview
                  </span>
                </div>
                <div className="ml-8 rounded-xl bg-muted/60 px-3 py-2 text-xs">
                  How do I bandage a hand?
                </div>
                <div className="mt-4 flex items-center gap-2 text-muted-foreground text-xs">
                  <span className="size-2 rounded-full bg-primary/60" />
                  Question · evidence · follow-up
                </div>
                <div className="mt-5 h-9 rounded-xl border border-border bg-background" />
              </div>
            </motion.article>
            <motion.article
              className="medix-feature-card group relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-[#eeeef6] p-6"
              data-feature-card="video"
              initial={reducedMotion ? false : { opacity: 0, y: 18 }}
              tabIndex={0}
              transition={{ delay: reducedMotion ? 0 : 0.08, duration: 0.45 }}
              viewport={{ amount: 0.15, once: true }}
              whileHover={reducedMotion ? undefined : { y: -4 }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <h3 className="font-semibold text-xl">Video evidence</h3>
              <p className="mt-5 text-neutral-500 text-sm leading-6 md:line-clamp-3 md:min-h-[4.5rem]">
                Review supporting clips and timestamped references alongside the
                answer.
              </p>
              <EvidenceCardPreview />
            </motion.article>
            <motion.article
              className="medix-feature-card group relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-[#eeeef6] p-6"
              data-feature-card="research"
              initial={reducedMotion ? false : { opacity: 0, y: 18 }}
              tabIndex={0}
              transition={{ delay: reducedMotion ? 0 : 0.16, duration: 0.45 }}
              viewport={{ amount: 0.15, once: true }}
              whileHover={reducedMotion ? undefined : { y: -4 }}
              whileInView={{ opacity: 1, y: 0 }}
            >
              <h3 className="font-semibold text-xl">Open research</h3>
              <p className="mt-5 text-neutral-500 text-sm leading-6 md:line-clamp-3 md:min-h-[4.5rem]">
                Explore the implementation, evaluation, and current limitations.
              </p>
              <Link
                className="mt-4 inline-flex min-h-10 items-center gap-1 font-medium text-primary text-xs hover:underline"
                href="/docs"
              >
                Read the docs
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
              <ResearchCardPreview />
            </motion.article>
          </div>
        </div>
      </section>
      <section
        aria-labelledby="examples-title"
        className="scroll-mt-24 border-neutral-200 border-b py-14 md:py-20"
        id="examples"
      >
        <div className="mx-auto max-w-5xl px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2
              className="font-semibold text-2xl tracking-tight sm:text-3xl"
              id="examples-title"
            >
              Start with a question.
            </h2>
            <p className="text-neutral-500 text-sm">
              Choose an example, or ask your own.
            </p>
          </div>
          <div className="mt-7 grid gap-3 md:grid-cols-3">
            {examples.map(({ title, question }) => (
              <button
                className="group flex min-h-36 flex-col rounded-xl border border-neutral-200 bg-white/40 p-5 text-left transition-colors hover:border-neutral-400 hover:bg-white focus-visible:outline-2 focus-visible:outline-sky-600 focus-visible:outline-offset-4"
                key={title}
                onClick={() => startChat(question)}
                type="button"
              >
                <span className="flex w-full items-center justify-between gap-3 font-medium text-sm">
                  {title}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none"
                  />
                </span>
                <span className="mt-3 text-neutral-500 text-sm leading-6">
                  {question}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
      <section
        aria-labelledby="get-started-title"
        className="border-neutral-200 border-b py-14 md:py-16"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-7 px-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              className="font-semibold text-2xl tracking-tight sm:text-3xl"
              id="get-started-title"
            >
              Take a closer look at Medix.
            </h2>
            <p className="mt-2 text-neutral-500 text-sm leading-6">
              Sign in to explore Medix, or browse the code on GitHub.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Link
              className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-sky-600 focus-visible:outline-offset-4"
              href="/login"
            >
              Sign in
            </Link>
            <a
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-neutral-300 px-5 font-medium text-sm transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-sky-600 focus-visible:outline-offset-4"
              href={codeHref}
              rel="noreferrer"
              target="_blank"
            >
              GitHub
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
