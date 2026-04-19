"use client";

import { motion } from "framer-motion";
import {
  ArrowUp,
  ArrowUpRight,
  BrainCircuit,
  Github,
  Paperclip,
  Search,
  ShieldPlus,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { generateUUID } from "@/lib/utils";

const capabilityPills = [
  "Procedure search",
  "Image understanding",
  "Video-guided answers",
  "Qdrant retrieval",
  "Follow-up questions",
  "Medical transcripts",
];

const overviewCards = [
  {
    title: "Clinical Search",
    copy: "Search trusted MedVidQA procedures and jump straight into the most relevant treatment videos.",
    icon: Search,
  },
  {
    title: "Visual Triage",
    copy: "Upload an image, add context, and turn what the model sees into a grounded retrieval query.",
    icon: ShieldPlus,
  },
  {
    title: "Conversation Flow",
    copy: "Stay in one thread for clarifications, follow-up questions, and procedure-specific guidance.",
    icon: BrainCircuit,
  },
];

const greetingPlaceholders = [
  "Hello, how can I help today?",
  "Hola, ¿cómo puedo ayudarte hoy?",
  "Bonjour, comment puis-je vous aider?",
  "नमस्ते, मैं आपकी कैसे मदद कर सकता हूँ?",
  "你好，我能帮你什么？",
  "Olá, como posso ajudar hoje?",
  "こんにちは、今日はどのようにお手伝いできますか？",
  "হ্যালো, আজ আমি কীভাবে সাহায্য করতে পারি?",
  "Hallo, wie kann ich Ihnen helfen?",
  "Ciao, come posso aiutarti oggi?",
];

const BOT_NAME = "Medix";

export function StarterPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [typedPlaceholder, setTypedPlaceholder] = useState("");

  const codeHref =
    process.env.NEXT_PUBLIC_CODE_URL || "https://github.com/ZB-ZettaByte/Medix";

  const startChat = (value?: string) => {
    const nextPrompt = (value ?? prompt).trim();
    const chatId = generateUUID();

    if (!nextPrompt) {
      router.push(`/chat/${chatId}`);
      return;
    }

    router.push(`/chat/${chatId}?query=${encodeURIComponent(nextPrompt)}`);
  };

  useEffect(() => {
    const currentGreeting = greetingPlaceholders[placeholderIndex];
    let timeoutId: number;

    if (typedPlaceholder.length < currentGreeting.length) {
      timeoutId = window.setTimeout(() => {
        setTypedPlaceholder(
          currentGreeting.slice(0, typedPlaceholder.length + 1)
        );
      }, 42);
    } else {
      timeoutId = window.setTimeout(() => {
        setTypedPlaceholder("");
        setPlaceholderIndex(
          (current) => (current + 1) % greetingPlaceholders.length
        );
      }, 1400);
    }

    return () => window.clearTimeout(timeoutId);
  }, [placeholderIndex, typedPlaceholder]);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_top,rgba(66,153,225,0.16),transparent_32%),linear-gradient(180deg,#f8fbff_0%,#f3f7fb_42%,#f8fafc_100%)] text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-8rem] left-1/2 h-[20rem] w-[20rem] -translate-x-1/2 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="absolute top-[14rem] right-[-4rem] h-[18rem] w-[18rem] rounded-full bg-cyan-200/30 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-[-2rem] h-[16rem] w-[16rem] rounded-full bg-emerald-100/50 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-6 py-7 md:px-10 md:py-8 lg:px-12">
        <header className="flex items-center justify-between gap-5 rounded-[1.75rem] border border-white/70 bg-white/78 px-6 py-5 shadow-[var(--shadow-float)] backdrop-blur-xl md:px-7 md:py-6">
          <Link className="flex items-center gap-3" href="/">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#0ea5e9)] text-white shadow-lg shadow-sky-500/20">
              <Stethoscope className="size-5" />
            </div>
            <div>
              <div className="font-semibold text-[15px] tracking-[-0.03em]">
                Medix
              </div>
              <div className="mt-0.5 text-[12px] tracking-[0.01em] text-muted-foreground">
                Multimodal medical procedure assistant
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-10 text-[14px] tracking-[0.01em] text-muted-foreground lg:flex">
            <a
              className="transition-colors hover:text-foreground"
              href="#overview"
            >
              Overview
            </a>
            <a
              className="transition-colors hover:text-foreground"
              href="#features"
            >
              Capabilities
            </a>
            <a
              className="transition-colors hover:text-foreground"
              href="#footer"
            >
              Footer
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Button
              asChild
              className="hidden rounded-full md:inline-flex"
              size="sm"
              variant="outline"
            >
              <a href={codeHref} rel="noreferrer" target="_blank">
                <Github className="size-4" />
                View code
                <ArrowUpRight className="size-4" />
              </a>
            </Button>
            <Button
              className="rounded-full bg-slate-950 px-4 text-white hover:bg-slate-800"
              onClick={() => startChat()}
              size="sm"
            >
              Open chat
              <ArrowUpRight className="size-4" />
            </Button>
          </div>
        </header>

        <section
          className="flex flex-1 flex-col items-center py-16 text-center lg:py-24"
          id="features"
        >
          <div className="max-w-4xl">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="mb-7 inline-flex items-center gap-2 rounded-full border border-sky-200/70 bg-white/70 px-3.5 py-1.5 text-[12px] font-medium tracking-[0.01em] text-sky-900 shadow-[var(--shadow-card)] backdrop-blur-md"
              initial={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <Sparkles className="size-3.5" />
              Search procedures, ask follow-ups, analyze images
            </motion.div>

            <motion.h1
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-4xl font-semibold text-4xl tracking-[-0.06em] leading-[0.94] text-balance text-slate-950 md:text-6xl"
              initial={{ opacity: 0, y: 14 }}
              transition={{
                delay: 0.05,
                duration: 0.55,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              Ask medical procedure questions with a calmer, clearer starting
              point.
            </motion.h1>

            <motion.p
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto mt-6 max-w-3xl text-[16px] leading-8 tracking-[0.002em] text-slate-600 md:text-[17px]"
              initial={{ opacity: 0, y: 14 }}
              transition={{
                delay: 0.12,
                duration: 0.55,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              MedVidQA blends multimodal input, grounded transcript retrieval,
              and step-aware video answers so users can get from uncertainty to
              the right procedure faster.
            </motion.p>

            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="mt-12 w-full"
              initial={{ opacity: 0, y: 16 }}
              transition={{
                delay: 0.18,
                duration: 0.55,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <div className="mx-auto w-full max-w-4xl rounded-[1.8rem] border border-slate-200/80 bg-white/92 p-2.5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                <div className="w-full rounded-[1.35rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                  <textarea
                    aria-label="Starter prompt"
                    className="block min-h-[7.75rem] w-full resize-none border-0 bg-transparent px-6 pt-5 pb-3 text-[15px] leading-7 tracking-[0.002em] text-slate-700 outline-none placeholder:text-slate-400"
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
                    rows={4}
                    value={prompt}
                  />
                  <div className="flex flex-col gap-4 border-slate-200/80 border-t px-5 pt-4 pb-4">
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
                    <div className="flex items-center justify-between gap-4 pt-0.5">
                      <div className="flex items-center gap-3">
                        <button
                          aria-label="Attach file"
                          className="flex size-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-sky-200 hover:text-slate-900"
                          type="button"
                        >
                          <Paperclip className="size-3.5" />
                        </button>
                        <div className="flex items-center gap-2 text-slate-500">
                          <div className="text-sm tracking-[0.01em] text-slate-500">
                            {BOT_NAME}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <button
                          aria-label="Send message"
                          className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-sm transition-colors hover:bg-slate-200 hover:text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300"
                          disabled={!prompt.trim()}
                          onClick={() => startChat()}
                          type="button"
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="grid gap-6 pb-14 md:grid-cols-3" id="overview">
          {overviewCards.map(({ title, copy, icon: Icon }, index) => (
            <motion.article
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[2rem] border border-white/80 bg-white/82 p-6 shadow-[var(--shadow-float)] backdrop-blur-xl"
              initial={{ opacity: 0, y: 18 }}
              key={title}
              transition={{
                delay: 0.08 * index,
                duration: 0.48,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#e0f2fe,#f0fdf4)] text-slate-900">
                <Icon className="size-5" />
              </div>
              <h2 className="font-semibold text-2xl tracking-[-0.03em] text-slate-950">
                {title}
              </h2>
              <p className="mt-3 text-[15px] leading-7 text-slate-600">
                {copy}
              </p>
            </motion.article>
          ))}
        </section>

        <footer
          className="mt-auto flex flex-col items-start justify-between gap-5 border-slate-200/80 border-t py-8 text-sm text-slate-500 md:flex-row md:items-center"
          id="footer"
        >
          <div>
            <div className="font-medium text-slate-800">MedVidQA</div>
            <div className="mt-1 max-w-xl">
              Built for grounded medical video retrieval, multimodal analysis,
              and cleaner procedure-first conversations.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              className="transition-colors hover:text-slate-900"
              href="#overview"
            >
              Overview
            </a>
            <a
              className="transition-colors hover:text-slate-900"
              href="#features"
            >
              Capabilities
            </a>
            <a
              className="transition-colors hover:text-slate-900"
              href={codeHref}
            >
              View code
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
