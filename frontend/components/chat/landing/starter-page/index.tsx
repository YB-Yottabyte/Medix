"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { generateUUID } from "@/lib/utils";
import { demoQuestion, demoResponse, greetingPlaceholders } from "./data";
import { StarterPageFooter } from "./footer";
import { FutureWorkflowPlaceholder } from "./future-workflow-placeholder";
import { HeroHeader } from "./hero-header";
import { HeroSection } from "./hero-section";
import { LiveConversationSection } from "./live-conversation-section";
import { MultimodalWorkflowShowcase } from "./multimodal-workflow-showcase";
import { PipelineSection } from "./pipeline-section";

export function StarterPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const [prompt, setPrompt] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [typedPlaceholder, setTypedPlaceholder] = useState("");
  const [typedQuestion, setTypedQuestion] = useState("");
  const [typedResponse, setTypedResponse] = useState("");
  const [showProcedureCard, setShowProcedureCard] = useState(false);
  const [showThinking, setShowThinking] = useState(false);

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
      }, 36);
    } else {
      timeoutId = window.setTimeout(() => {
        setTypedPlaceholder("");
        setPlaceholderIndex(
          (current) => (current + 1) % greetingPlaceholders.length
        );
      }, 1350);
    }

    return () => window.clearTimeout(timeoutId);
  }, [placeholderIndex, typedPlaceholder]);

  useEffect(() => {
    let cancelled = false;

    const typeText = async (
      text: string,
      setter: React.Dispatch<React.SetStateAction<string>>,
      speed: number
    ) => {
      setter("");

      for (let index = 0; index < text.length; index += 1) {
        if (cancelled) {
          return;
        }

        setter(text.slice(0, index + 1));
        await new Promise((resolve) => window.setTimeout(resolve, speed));
      }
    };

    const runDemo = async () => {
      while (!cancelled) {
        setShowProcedureCard(false);
        setShowThinking(false);
        await typeText(demoQuestion, setTypedQuestion, 22);
        if (cancelled) {
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 450));
        if (cancelled) {
          return;
        }

        setShowThinking(true);
        await new Promise((resolve) => window.setTimeout(resolve, 950));
        if (cancelled) {
          return;
        }

        setShowThinking(false);
        await typeText(demoResponse, setTypedResponse, 10);
        if (cancelled) {
          return;
        }

        setShowProcedureCard(true);
        await new Promise((resolve) => window.setTimeout(resolve, 2400));
        if (cancelled) {
          return;
        }

        setTypedQuestion("");
        setTypedResponse("");
        setShowProcedureCard(false);
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    };

    runDemo();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <HeroHeader />
      <main className="relative min-h-dvh overflow-hidden bg-white text-foreground">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 isolate hidden opacity-75 lg:block"
        >
          <div className="absolute top-0 left-0 h-[32rem] w-[12rem] -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(210,40%,90%,0.26)_0,hsla(210,40%,96%,0.06)_70%,transparent_100%)]" />
          <div className="absolute top-[-6rem] left-1/2 h-[20rem] w-[20rem] -translate-x-1/2 rounded-full bg-slate-200/12 blur-2xl" />
          <div className="absolute top-32 right-[-2rem] h-[18rem] w-[18rem] rounded-full bg-slate-100/40 blur-2xl" />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <motion.div
            animate={
              prefersReducedMotion
                ? { opacity: 0.14 }
                : {
                    opacity: [0.16, 0.24, 0.16],
                    scale: [1, 1.04, 1],
                    x: [0, 18, 0],
                    y: [0, -12, 0],
                  }
            }
            className="absolute top-24 left-[8%] h-40 w-40 rounded-full bg-sky-100/35 blur-2xl will-change-transform"
            transition={{
              duration: 20,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
            }}
          />
          <motion.div
            animate={
              prefersReducedMotion
                ? { opacity: 0.1 }
                : {
                    opacity: [0.1, 0.16, 0.1],
                    scale: [1.01, 0.98, 1.01],
                    x: [0, -20, 0],
                    y: [0, 16, 0],
                  }
            }
            className="absolute top-[28rem] right-[6%] h-52 w-52 rounded-full bg-slate-200/35 blur-2xl will-change-transform"
            transition={{
              duration: 24,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
            }}
          />
          <motion.div
            animate={
              prefersReducedMotion
                ? { opacity: 0.08 }
                : {
                    opacity: [0.08, 0.14, 0.08],
                    rotate: [0, 3, 0],
                    y: [0, 12, 0],
                  }
            }
            className="absolute bottom-24 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full bg-cyan-100/30 blur-2xl will-change-transform"
            transition={{
              duration: 22,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
            }}
          />
          <motion.div
            animate={
              prefersReducedMotion
                ? { opacity: 0.12 }
                : { opacity: [0.12, 0.22, 0.12] }
            }
            className="absolute inset-x-0 top-[22rem] mx-auto hidden h-px max-w-5xl bg-gradient-to-r from-transparent via-slate-200 to-transparent lg:block"
            transition={{
              duration: 10,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
            }}
          />
          <motion.div
            animate={
              prefersReducedMotion
                ? { opacity: 0.18 }
                : {
                    opacity: [0.18, 0.28, 0.18],
                    x: ["-8%", "8%", "-8%"],
                  }
            }
            className="absolute top-0 left-1/2 h-[24rem] w-[64rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.82)_0%,rgba(226,232,240,0.16)_42%,rgba(255,255,255,0)_72%)] will-change-transform"
            transition={{
              duration: 26,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
            }}
          />
          <motion.div
            animate={
              prefersReducedMotion
                ? { opacity: 0.06 }
                : {
                    opacity: [0.06, 0.12, 0.06],
                    y: [0, 18, 0],
                  }
            }
            className="absolute inset-x-0 bottom-[20%] mx-auto h-28 max-w-6xl bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(226,232,240,0.3)_48%,rgba(255,255,255,0)_100%)] blur-xl will-change-transform"
            transition={{
              duration: 18,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
            }}
          />
        </div>

        <div
          aria-hidden
          className="absolute inset-0 -z-10 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--color-background)_76%)]"
        />

        <HeroSection
          prompt={prompt}
          setPrompt={setPrompt}
          startChat={startChat}
          typedPlaceholder={typedPlaceholder}
        />

        <LiveConversationSection
          showProcedureCard={showProcedureCard}
          showThinking={showThinking}
          typedQuestion={typedQuestion}
          typedResponse={typedResponse}
        />

        <PipelineSection prefersReducedMotion={Boolean(prefersReducedMotion)} />

        <section className="bg-[#f8fafc] py-28 md:py-32" id="quest3-research">
          <div className="mx-auto w-full max-w-7xl px-6 md:px-10 lg:px-12">
            <div className="space-y-24">
              <MultimodalWorkflowShowcase
                prefersReducedMotion={Boolean(prefersReducedMotion)}
              />
              <FutureWorkflowPlaceholder
                prefersReducedMotion={Boolean(prefersReducedMotion)}
              />
            </div>
          </div>
        </section>

        <StarterPageFooter />
      </main>
    </>
  );
}
