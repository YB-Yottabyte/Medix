"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Menu,
  Paperclip,
  Sparkles,
  Stethoscope,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn, generateUUID } from "@/lib/utils";

const codeHref =
  process.env.NEXT_PUBLIC_CODE_URL || "https://github.com/ZB-ZettaByte/Medix";

const menuItems: Array<{ name: string; href: string; external?: boolean }> = [
  { name: "How It Works", href: "#features" },
  { name: "Pipeline", href: "#pipeline" },
  { name: "Quest 3 Research", href: "#quest3-research" },
];

const capabilityPills = [
  "Voice Input",
  "Grounded SAM 2",
  "Qdrant Search",
  "Groq LLaMA",
  "AR Overlay",
  "MedVidQA Dataset",
];

const greetingPlaceholders = [
  "Hello, how can I help today?",
  "Hola, ¿cómo puedo ayudarte hoy?",
  "Bonjour, comment puis-je vous aider?",
  "नमस्ते, मैं आपकी कैसे मदद कर सकता हूँ?",
  "你好，我能帮你什么？",
  "Olá, como posso ajudar hoje?",
  "こんにちは、どのようにお手伝いできますか？",
  "Hallo, wie kann ich Ihnen helfen?",
  "Ciao, come posso aiutarti oggi?",
];

const demoQuestion =
  "Hey, I cut my hand while cooking. Does this look like something I can treat at home?";

const demoResponse =
  "From what I can see, this looks like a minor cut that is usually manageable at home if the bleeding slows down and the wound is not very deep. Press a clean cloth or sterile gauze on it for a few minutes, rinse it gently under cool running water, and cover it with a clean bandage. If the bleeding keeps going, the cut is deep, or the skin edges stay open, you should get medical care.";

const alternatingSectionBackgrounds = ["bg-white", "bg-[#f8fafc]"] as const;

function LandingSection({
  index,
  id,
  className,
  children,
}: {
  index: number;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        alternatingSectionBackgrounds[index % alternatingSectionBackgrounds.length],
        className
      )}
      id={id}
    >
      {children}
    </section>
  );
}

function HeroHeader() {
  const [menuState, setMenuState] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 40);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header>
      <nav
        className="fixed inset-x-0 top-0 z-30 px-3"
        data-state={menuState ? "active" : "inactive"}
      >
        <div
          className={cn(
            "mx-auto mt-3 max-w-6xl px-4 transition-all duration-300 md:px-6 lg:px-10",
            isScrolled &&
              "max-w-5xl rounded-[1.65rem] border border-slate-200/80 bg-white/92 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.14)]"
          )}
        >
          <div className="relative flex flex-wrap items-center justify-between gap-5 py-4 lg:gap-0 lg:py-5">
            <div className="flex w-full items-center justify-between lg:w-auto">
              <Link
                aria-label="home"
                className="flex items-center gap-3"
                href="/"
              >
                <div className="flex size-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#0ea5e9)] text-white shadow-lg shadow-sky-500/20">
                  <Stethoscope className="size-5" />
                </div>
                <div>
                  <div className="font-semibold text-[15px] tracking-[-0.03em] text-slate-950">
                    Medix
                  </div>
                  <div className="mt-0.5 text-[12px] tracking-[0.01em] text-slate-500">
                    AI-powered medical guidance research prototype
                  </div>
                </div>
              </Link>

              <button
                aria-label={menuState ? "Close Menu" : "Open Menu"}
                className="relative z-20 -m-2.5 block cursor-pointer p-2.5 text-slate-700 lg:hidden"
                onClick={() => setMenuState((current) => !current)}
                type="button"
              >
                <Menu className="size-6 duration-200 data-[state=active]:rotate-180 data-[state=active]:scale-0 data-[state=active]:opacity-0" />
                <X className="absolute inset-0 m-auto size-6 -rotate-180 scale-0 opacity-0 duration-200 data-[state=active]:rotate-0 data-[state=active]:scale-100 data-[state=active]:opacity-100" />
              </button>
            </div>

            <div className="absolute inset-0 m-auto hidden size-fit lg:block">
              <ul className="flex gap-8 text-sm text-slate-600">
                {menuItems.map((item) => (
                  <li key={item.name}>
                    <Link
                      className="group relative block pb-1 duration-150 hover:text-slate-950"
                      href={item.href}
                      rel={item.external ? "noreferrer" : undefined}
                      target={item.external ? "_blank" : undefined}
                    >
                      <span>{item.name}</span>
                      <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-slate-950 transition-transform duration-300 ease-out group-hover:scale-x-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div
              className={cn(
                "mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-3 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none",
                menuState && "block"
              )}
            >
              <div className="lg:hidden">
                <ul className="space-y-6 text-base text-slate-600">
                  {menuItems.map((item) => (
                    <li key={item.name}>
                      <Link
                        className="group relative inline-block pb-1 duration-150 hover:text-slate-950"
                        href={item.href}
                        onClick={() => setMenuState(false)}
                        rel={item.external ? "noreferrer" : undefined}
                        target={item.external ? "_blank" : undefined}
                      >
                        <span>{item.name}</span>
                        <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 rounded-full bg-slate-950 transition-transform duration-300 ease-out group-hover:scale-x-100" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
                <Button
                  asChild
                  className={cn(isScrolled && "lg:hidden")}
                  size="sm"
                  variant="outline"
                >
                  <a
                    className="group relative min-h-12 overflow-hidden rounded-xl border-slate-200 bg-white px-6 py-3 text-sm text-slate-950"
                    href={codeHref}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="absolute inset-0 -translate-x-full bg-slate-950 transition-transform duration-300 ease-out group-hover:translate-x-0" />
                    <span className="relative z-10 transition-colors duration-300 ease-out group-hover:text-white">
                      View Code
                    </span>
                  </a>
                </Button>
                <Button
                  asChild
                  className={cn(isScrolled ? "lg:inline-flex" : "hidden")}
                  size="sm"
                >
                  <Link
                    className="group relative min-h-12 overflow-hidden rounded-xl bg-white px-6 py-3 text-sm text-slate-950"
                    href="#features"
                  >
                    <span className="absolute inset-0 -translate-x-full bg-slate-950 transition-transform duration-300 ease-out group-hover:translate-x-0" />
                    <span className="relative z-10 transition-colors duration-300 ease-out group-hover:text-white">
                      Try the Demo
                    </span>
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}

function MultimodalWorkflowShowcase({
  prefersReducedMotion,
}: {
  prefersReducedMotion: boolean;
}) {
  const [typedPrompt, setTypedPrompt] = useState("");
  const [showAttachmentClick, setShowAttachmentClick] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showSegmentation, setShowSegmentation] = useState(false);
  const [showAnalyzeClick, setShowAnalyzeClick] = useState(false);
  const [showSegmentedAttachment, setShowSegmentedAttachment] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [showProcedure, setShowProcedure] = useState(false);
  const showEditor = (showUpload || showSegmentation || showAnalyzeClick) && !typedPrompt;
  const showSentMessage = showSend || showThinking || typedAnswer.length > 0;
  const showAssistantMessage = showThinking || typedAnswer.length > 0;
  const composerText = showSend ? "" : typedPrompt;
  useEffect(() => {
    let cancelled = false;
    const prompt =
      "I uploaded this cut on my hand. Focus on the marked region and tell me if it seems safe to bandage at home.";
    const answer =
      "This looks like a minor cut near the thumb base. Clean it, bandage it, and seek urgent care if bleeding continues.";

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

    const run = async () => {
      while (!cancelled) {
        setShowAttachmentClick(false);
        setShowUpload(false);
        setShowSegmentation(false);
        setShowAnalyzeClick(false);
        setShowSegmentedAttachment(false);
        setShowSend(false);
        setShowThinking(false);
        setShowProcedure(false);
        setTypedPrompt("");
        setTypedAnswer("");

        await new Promise((resolve) => window.setTimeout(resolve, 250));
        if (cancelled) return;
        setShowAttachmentClick(true);

        await new Promise((resolve) => window.setTimeout(resolve, 900));
        if (cancelled) return;
        setShowUpload(true);

        await new Promise((resolve) => window.setTimeout(resolve, 1050));
        if (cancelled) return;
        setShowSegmentation(true);

        await new Promise((resolve) => window.setTimeout(resolve, 1100));
        if (cancelled) return;
        setShowAnalyzeClick(true);

        await new Promise((resolve) => window.setTimeout(resolve, 700));
        if (cancelled) return;
        setShowSegmentedAttachment(true);

        await new Promise((resolve) => window.setTimeout(resolve, 400));
        if (cancelled) return;
        await typeText(prompt, setTypedPrompt, 20);
        if (cancelled) return;

        await new Promise((resolve) => window.setTimeout(resolve, 500));
        if (cancelled) return;
        setShowSend(true);

        await new Promise((resolve) => window.setTimeout(resolve, 1100));
        if (cancelled) return;
        setShowThinking(true);

        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (cancelled) return;
        setShowThinking(false);
        await typeText(answer, setTypedAnswer, 15);
        if (cancelled) return;

        setShowProcedure(true);
        await new Promise((resolve) => window.setTimeout(resolve, 2800));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <div className="mx-auto w-full max-w-[30rem]">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#111418] shadow-[0_30px_70px_-42px_rgba(15,23,42,0.42)]">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-rose-300" />
                <span className="size-2.5 rounded-full bg-amber-300" />
                <span className="size-2.5 rounded-full bg-emerald-300" />
              </div>
              <div className="rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1 text-[11px] font-medium tracking-[0.06em] text-sky-100 uppercase">
                Multimodal demo
              </div>
            </div>
          </div>

          <div className="grid h-[66rem] grid-cols-[8rem_minmax(0,1fr)] bg-[linear-gradient(180deg,#151a21_0%,#0f1318_100%)]">
            <div className="border-r border-white/8 bg-white/[0.03] px-3 py-4">
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/78">
                New chat
              </div>
              <div className="mt-4 text-[10px] font-semibold tracking-[0.12em] text-white/30 uppercase">
                History
              </div>
              <div className="mt-2 rounded-lg border border-dashed border-white/10 px-2 py-2 text-xs text-white/48">
                Visual consult
              </div>
            </div>

            <div className="p-4">
              <div className="relative overflow-hidden rounded-[1.5rem] border border-white/8 bg-white/[0.02] p-3 shadow-sm">
                <div className="relative h-[61rem] rounded-[1.2rem] bg-[linear-gradient(180deg,#171c23_0%,#10141a_100%)]">
                  <div className="space-y-4 px-4 py-4 pb-52">
                    <motion.div
                      animate={{
                        opacity: showSentMessage ? 1 : 0,
                        y: showSentMessage ? 0 : 14,
                        scale: showSend ? [1, 0.98, 1] : 1,
                      }}
                      className="flex justify-end pt-1"
                      initial={false}
                      transition={{
                        duration: 0.42,
                        ease: "easeOut",
                      }}
                    >
                      <div className="max-w-[82%] rounded-[1.3rem] rounded-br-md border border-slate-200/80 bg-white px-3 py-3 shadow-sm">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Paperclip className="size-3.5" />
                          Region attachment sent
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-800">
                          {typedPrompt}
                        </div>
                      </div>
                    </motion.div>

                    <motion.div
                      animate={{
                        opacity: showAssistantMessage ? 1 : 0,
                        y: showAssistantMessage ? 0 : 16,
                      }}
                      className="max-w-[88%] rounded-[1.2rem] border border-white/10 bg-white/6 p-4 shadow-sm"
                      initial={false}
                      transition={{
                        duration: 0.45,
                        ease: "easeOut",
                      }}
                    >
                      <div className="mb-2 flex items-center gap-2 text-xs text-white/45">
                        <span className="font-medium text-white/88">Medix</span>
                        {showThinking ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="size-1.5 rounded-full bg-white/35" />
                            <span className="size-1.5 rounded-full bg-white/35 [animation-delay:120ms]" />
                            <span className="size-1.5 rounded-full bg-white/35 [animation-delay:240ms]" />
                            Analyzing image + text
                          </span>
                        ) : (
                          <span>Response</span>
                        )}
                      </div>
                      <div className="text-sm leading-7 text-white/84">
                        {showThinking
                          ? "Reviewing the segmented region, checking first-aid guidance, and preparing the safest next steps."
                          : typedAnswer ||
                            "Waiting for the multimodal response..."}
                      </div>
                      <motion.div
                        animate={{
                          opacity: showProcedure ? 1 : 0,
                          y: showProcedure ? 0 : 12,
                        }}
                        className="mt-4 rounded-[1.1rem] border border-white/10 bg-white/5 p-3"
                        initial={false}
                      >
                        <div className="text-[11px] uppercase tracking-[0.08em] text-white/35">
                          Retrieved procedure
                        </div>
                        <div className="mt-2 overflow-hidden rounded-[0.95rem] border border-white/10 bg-[#10151d]">
                          <div className="relative h-36 bg-[linear-gradient(135deg,#2f3a4a_0%,#111827_100%)]">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_42%)]" />
                            <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />
                            <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-medium text-white">
                              VIDEO
                            </div>
                            <div className="absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-medium text-white">
                              1:21
                            </div>
                            <div className="absolute inset-x-0 top-[42%] flex -translate-y-1/2 justify-center">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/92 shadow-lg ring-1 ring-black/10">
                                <div className="ml-0.5 h-0 w-0 border-y-[7px] border-y-transparent border-l-[10px] border-l-slate-900" />
                              </div>
                            </div>
                            <div className="absolute bottom-3 left-3 right-3 pr-2 text-base leading-6 font-medium text-white">
                              How to bandage a hand
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </motion.div>
                  </div>

                  <motion.div
                    animate={{
                      opacity: showEditor ? 1 : 0,
                      scale: showEditor ? 1 : 0.96,
                      y: showEditor ? 0 : -12,
                      pointerEvents: showEditor ? "auto" : "none",
                    }}
                    className="absolute inset-x-4 top-4 z-20 rounded-[1.35rem] border border-slate-200/80 bg-white p-4 shadow-[0_24px_60px_-32px_rgba(15,23,42,0.2)]"
                    initial={false}
                    transition={{
                      duration: 0.38,
                      ease: "easeOut",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase">
                          Select region to analyze
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          Mark the area of concern before Medix responds.
                        </div>
                      </div>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                        Segmented
                      </span>
                    </div>

                    <div className="mt-3 rounded-[1.1rem] border border-slate-200 bg-[linear-gradient(135deg,#8d6454_0%,#d9a487_48%,#9c705b_100%)] p-3">
                      <div className="relative h-44 overflow-hidden rounded-[0.9rem]">
                        <motion.div
                          animate={
                            showSegmentation
                              ? { opacity: [0.18, 0.42, 0.18], x: [-12, 22, -12] }
                              : { opacity: 0.12, x: 0 }
                          }
                          className="absolute inset-y-0 left-8 w-14 rounded-full bg-white/18 blur-xl"
                          transition={{
                            duration: 2.6,
                            ease: "easeInOut",
                            repeat: Number.POSITIVE_INFINITY,
                          }}
                        />
                        <motion.div
                          animate={{
                            scale: [1, 1.8, 2.2],
                            opacity: [0.45, 0.18, 0],
                          }}
                          className="absolute left-[64%] top-[56%] h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-200"
                          transition={{
                            duration: 1.6,
                            ease: "easeOut",
                            repeat: Number.POSITIVE_INFINITY,
                          }}
                        />
                        <div className="absolute left-[64%] top-[56%] z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-sky-400 shadow-[0_0_0_6px_rgba(125,211,252,0.18)]" />
                        <div className="absolute inset-y-8 right-12 w-10 rounded-md border border-fuchsia-400" />
                      </div>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <motion.div
                        animate={{
                          scale: showEditor ? [1, 0.96, 1] : 1,
                          backgroundColor:
                            showAnalyzeClick
                              ? ["rgb(15 23 42)", "rgb(2 132 199)", "rgb(15 23 42)"]
                              : "rgb(15 23 42)",
                        }}
                        className="rounded-full bg-slate-950 px-4 py-2 text-xs font-medium text-white"
                        transition={{
                          duration: 0.7,
                          ease: "easeInOut",
                        }}
                      >
                        Analyze
                      </motion.div>
                    </div>
                  </motion.div>

                  <div className="absolute inset-x-4 bottom-4 rounded-[1.1rem] border border-white/10 bg-[#171c23] p-2.5 shadow-sm">
                    <div className="rounded-[0.95rem] border border-white/10 bg-white/5 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-xs text-white/45">
                        <motion.div
                          animate={{
                            scale: showAttachmentClick ? [1, 0.86, 1] : 1,
                            backgroundColor: showAttachmentClick
                              ? [
                                  "rgba(255,255,255,0.08)",
                                  "rgba(14,165,233,0.18)",
                                  "rgba(255,255,255,0.08)",
                                ]
                              : "rgba(255,255,255,0.08)",
                          }}
                          className="flex size-7 items-center justify-center rounded-full"
                          transition={{ duration: 0.6, ease: "easeInOut" }}
                        >
                          <Paperclip className="size-3.5" />
                        </motion.div>
                        {showUpload
                          ? "Image attached"
                          : "Attach an image or ask a question"}
                        {showSegmentation && (
                          <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-100">
                            Segmented
                          </span>
                        )}
                      </div>
                      {!showSend && showSegmentedAttachment && (
                        <motion.div
                          animate={{
                            opacity: showSegmentedAttachment ? 1 : 0.45,
                            y: showSegmentedAttachment ? 0 : 6,
                          }}
                          className="mt-3 flex items-center gap-3 rounded-[0.95rem] border border-white/10 bg-white/6 px-3 py-2"
                          initial={false}
                          transition={{
                            duration: 0.35,
                            ease: "easeOut",
                          }}
                        >
                          <div className="h-12 w-12 overflow-hidden rounded-lg border border-white/10 bg-[linear-gradient(135deg,#b97961_0%,#dfad8f_45%,#8b5f4c_100%)]">
                            <div className="relative h-full w-full">
                              {showSegmentation && (
                                <div className="absolute inset-y-1 right-2 w-3 rounded-sm border border-fuchsia-400" />
                              )}
                              <div className="flex h-full items-center justify-center text-[10px] font-medium text-white/90">
                                IMG
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-white/88">
                              Segmented image ready
                            </div>
                            <div className="mt-1 text-[11px] text-white/45">
                              Added to the chat before prompting.
                            </div>
                          </div>
                        </motion.div>
                      )}
                      <div className="mt-3 min-h-[2.25rem] text-sm leading-6 text-white/84">
                        {composerText || (
                          <span className="text-white/28">
                            Ask anything...
                          </span>
                        )}
                        {!prefersReducedMotion && !showSend && composerText && (
                          <span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-white/35 align-middle" />
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="text-xs text-white/45">
                          {showAttachmentClick && !showUpload
                            ? "Opening image analysis"
                            : showAnalyzeClick && !showSend
                              ? "Analyzing selected region"
                            : showSend
                            ? "Sent to Medix"
                            : showSegmentation
                              ? "Image + selected region ready"
                              : "Waiting for region analysis"}
                        </div>
                        <motion.div
                          animate={{
                            opacity: showSend ? 1 : 0.55,
                            scale: showSend ? [1, 0.9, 1] : 1,
                            x: showSend ? [0, 4, 0] : 0,
                          }}
                          transition={{
                            duration: 0.9,
                            ease: "easeInOut",
                          }}
                        >
                          <div
                            className={cn(
                              "flex size-8 items-center justify-center rounded-full text-white transition-colors duration-200",
                              showSend ? "bg-sky-500" : "bg-white/12"
                            )}
                          >
                            <ArrowRight className="size-4" />
                          </div>
                        </motion.div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-xl">
        <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-400 uppercase">
          Multimodal feature
        </div>
        <h3 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] text-slate-950 md:text-4xl">
          Upload, segment, ask, and respond in one flow
        </h3>
        <p className="mt-4 max-w-lg text-base leading-7 text-slate-600">
          Medix combines the uploaded image, segmented region, typed question,
          and retrieval step before answering.
        </p>
      </div>
    </div>
  );
}

function FutureWorkflowPlaceholder({
  prefersReducedMotion,
}: {
  prefersReducedMotion: boolean;
}) {
  const [showCapture, setShowCapture] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showGuidance, setShowGuidance] = useState(false);
  const [showEscalation, setShowEscalation] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        setShowCapture(false);
        setShowOverlay(false);
        setShowGuidance(false);
        setShowEscalation(false);

        await new Promise((resolve) => window.setTimeout(resolve, 300));
        if (cancelled) return;
        setShowCapture(true);

        await new Promise((resolve) => window.setTimeout(resolve, 800));
        if (cancelled) return;
        setShowOverlay(true);

        await new Promise((resolve) => window.setTimeout(resolve, 900));
        if (cancelled) return;
        setShowGuidance(true);

        await new Promise((resolve) => window.setTimeout(resolve, 1100));
        if (cancelled) return;
        setShowEscalation(true);

        await new Promise((resolve) => window.setTimeout(resolve, 2200));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <div className="max-w-xl">
        <div className="text-[11px] font-semibold tracking-[0.16em] text-slate-400 uppercase">
          Future research
        </div>
        <h3 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] text-slate-950 md:text-4xl">
          Meta Quest 3 can scan the scene and anchor help in view
        </h3>
        <p className="mt-4 max-w-lg text-base leading-7 text-slate-600">
          We are exploring hands-free capture, egocentric scene scanning, and
          overlays that keep procedure guidance locked to the caregiver's point
          of view.
        </p>
      </div>

      <div className="mx-auto w-full max-w-[30rem]">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[#15181d] shadow-[0_30px_70px_-42px_rgba(15,23,42,0.24)]">
          <div className="border-b border-white/8 px-4 py-3">
            <div className="flex items-center justify-between text-sm text-white/78">
              <span>Meta Quest 3 scan mode</span>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] tracking-[0.06em] uppercase">
                Research preview
              </span>
            </div>
          </div>

          <div className="p-4">
            <div className="relative overflow-hidden rounded-[1.5rem] border border-white/8 bg-[linear-gradient(180deg,#1d2229_0%,#111418_100%)] px-4 py-5">
              <motion.div
                animate={{
                  opacity: showCapture ? 1 : 0.2,
                  scale: showCapture ? 1 : 0.96,
                }}
                className="rounded-[1.2rem] border border-white/8 bg-[radial-gradient(circle_at_50%_25%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(135deg,#2d333c_0%,#1b2026_100%)] p-4"
                initial={false}
              >
                <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-white/45">
                  <span>Egocentric video scan</span>
                  <span className="rounded-full border border-white/10 bg-white/6 px-2 py-1 text-[10px] text-white/75">
                    Quest 3
                  </span>
                </div>
                <div className="relative h-48 overflow-hidden rounded-[1rem] border border-white/8 bg-[linear-gradient(135deg,#374151_0%,#1f2937_100%)]">
                  <div className="absolute inset-x-8 top-6 h-20 rounded-full bg-white/6 blur-2xl" />
                  <div className="absolute left-[16%] top-[18%] h-32 w-24 rounded-[40%] border border-white/6 bg-white/4" />
                  <div className="absolute right-[18%] top-[25%] h-20 w-16 rounded-[40%] border border-white/6 bg-white/4" />
                  <div className="absolute left-[40%] top-[18%] h-24 w-28 rounded-[2rem] border border-white/6 bg-white/4" />

                  {showCapture && (
                    <motion.div
                      animate={{
                        opacity: [0.16, 0.36, 0.16],
                        y: [-8, 96, -8],
                      }}
                      className="absolute inset-x-6 top-0 h-16 bg-gradient-to-b from-sky-300/20 via-cyan-200/8 to-transparent blur-sm"
                      transition={{
                        duration: 2.8,
                        ease: "easeInOut",
                        repeat: Number.POSITIVE_INFINITY,
                      }}
                    />
                  )}

                  {showCapture && (
                    <div className="absolute left-4 bottom-4 rounded-full border border-white/10 bg-black/45 px-3 py-1 text-[10px] font-medium tracking-[0.08em] text-white/78 uppercase backdrop-blur">
                      Scanning room context
                    </div>
                  )}

                  {showOverlay && (
                    <>
                      <motion.div
                        animate={{
                          scale: [1, 1.7, 2.2],
                          opacity: [0.42, 0.18, 0],
                        }}
                        className="absolute left-[53%] top-[42%] h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-200"
                        transition={{
                          duration: 1.6,
                          ease: "easeOut",
                          repeat: Number.POSITIVE_INFINITY,
                        }}
                      />
                      <div className="absolute left-[53%] top-[42%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-sky-400 shadow-[0_0_0_6px_rgba(125,211,252,0.14)]" />
                      <div className="absolute left-[30%] top-[56%] h-10 w-20 rounded-xl border border-emerald-300/70" />
                      <div className="absolute right-[14%] top-[26%] rounded-lg border border-sky-300/45 bg-sky-400/12 px-2 py-1 text-[10px] font-medium text-sky-100">
                        hand detected
                      </div>
                      <div className="absolute left-[34%] top-[62%] rounded-lg border border-emerald-300/45 bg-emerald-400/12 px-2 py-1 text-[10px] font-medium text-emerald-100">
                        bandage nearby
                      </div>
                    </>
                  )}

                  {showGuidance && (
                    <motion.div
                      animate={{
                        opacity: [0.86, 1, 0.86],
                        y: [0, -2, 0],
                      }}
                      className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-black/45 px-3 py-3 backdrop-blur"
                      transition={{
                        duration: 2,
                        ease: "easeInOut",
                        repeat: Number.POSITIVE_INFINITY,
                      }}
                    >
                      <div className="text-[10px] font-semibold tracking-[0.08em] text-emerald-300 uppercase">
                        Scan result
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/82">
                        Surface objects, hand position, and procedure anchors in
                        view.
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <motion.div
                  animate={{
                    opacity: showGuidance ? 1 : 0.35,
                    y: showGuidance ? 0 : 10,
                  }}
                  className="rounded-[1.1rem] border border-white/8 bg-white/6 px-4 py-3"
                  initial={false}
                >
                  <div className="text-[11px] uppercase tracking-[0.08em] text-white/45">
                    Scene map
                  </div>
                  <div className="mt-1 text-sm text-white/82">
                    Quest 3 keeps the room scan and injury location in sync.
                  </div>
                </motion.div>

                <motion.div
                  animate={{
                    opacity: showEscalation ? 1 : 0.35,
                    y: showEscalation ? 0 : 10,
                  }}
                  className="rounded-[1.1rem] border border-white/8 bg-white/6 px-4 py-3"
                  initial={false}
                >
                  <div className="text-[11px] uppercase tracking-[0.08em] text-white/45">
                    Anchored help
                  </div>
                  <div className="mt-1 text-sm text-white/82">
                    Guidance stays attached while the caregiver moves.
                  </div>
                </motion.div>
              </div>

              <motion.div
                animate={{
                  opacity: showEscalation ? 1 : 0.35,
                  y: showEscalation ? 0 : 10,
                }}
                className="mt-3 rounded-[1.1rem] border border-white/8 bg-white/6 px-4 py-3"
                initial={false}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.08em] text-white/45">
                      Escalation-aware scan
                    </div>
                    <div className="mt-1 text-sm text-white/82">
                      Future models can flag missing tools, unsafe posture, or
                      signs that the workflow should switch to urgent help.
                    </div>
                  </div>
                  <div className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-amber-100">
                    research
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineSection({
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
                        <div
                          className={cn(
                            "text-base font-semibold",
                            "text-slate-950"
                          )}
                        >
                          {step.title}
                        </div>
                        <div
                          className={cn(
                            "mt-1 text-sm leading-6",
                            "text-slate-600"
                          )}
                        >
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
                Medix uses voice, egocentric video, and visual grounding to
                guide non-expert caregivers through CPR, wound care, and
                emergency procedures — hands-free, in real time.
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
                            and watch Medix attach grounded procedural guidance
                            for the caregiver.
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                          {[
                            ["Segmentation", "Focus the relevant region first"],
                            [
                              "Groq Vision",
                              "Interpret the image before search",
                            ],
                            [
                              "Qdrant Search",
                              "Retrieve the closest transcript",
                            ],
                            [
                              "Neon Metadata",
                              "Attach procedure and timing data",
                            ],
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

        <PipelineSection prefersReducedMotion={Boolean(prefersReducedMotion)} />

        <LandingSection
          className="py-28 md:py-32"
          id="quest3-research"
          index={3}
        >
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
        </LandingSection>

        <footer className="bg-white py-16 md:py-24" id="footer">
          <div className="mx-auto max-w-5xl px-6">
            <Link
              aria-label="go home"
              className="mx-auto flex size-fit items-center gap-3"
              href="/"
            >
              <div className="flex size-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f172a,#0ea5e9)] text-white shadow-lg shadow-sky-500/20">
                <Stethoscope className="size-5" />
              </div>
              <div className="text-left">
                <div className="font-semibold text-[18px] tracking-[-0.03em] text-slate-950">
                  Medix
                </div>
                <div className="mt-0.5 text-sm tracking-[0.01em] text-slate-500">
                  AI-powered medical guidance research prototype
                </div>
              </div>
            </Link>

            <div className="my-8 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm">
              {menuItems.map((link) => (
                <Link
                  className="block text-slate-500 duration-150 hover:text-slate-950"
                  href={link.href}
                  key={link.name}
                  rel={link.external ? "noreferrer" : undefined}
                  target={link.external ? "_blank" : undefined}
                >
                  <span>{link.name}</span>
                </Link>
              ))}
            </div>

            <div className="my-8 flex flex-wrap justify-center gap-5 text-sm">
              <Link
                aria-label="X/Twitter"
                className="block text-slate-500 transition-colors hover:text-slate-950"
                href="https://x.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg
                  className="size-6"
                  height="1em"
                  viewBox="0 0 24 24"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10.488 14.651L15.25 21h7l-7.858-10.478L20.93 3h-2.65l-5.117 5.886L8.75 3h-7l7.51 10.015L2.32 21h2.65zM16.25 19L5.75 5h2l10.5 14z"
                    fill="currentColor"
                  />
                </svg>
              </Link>
              <Link
                aria-label="LinkedIn"
                className="block text-slate-500 transition-colors hover:text-slate-950"
                href="https://linkedin.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg
                  className="size-6"
                  height="1em"
                  viewBox="0 0 24 24"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93zM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37z"
                    fill="currentColor"
                  />
                </svg>
              </Link>
              <Link
                aria-label="Facebook"
                className="block text-slate-500 transition-colors hover:text-slate-950"
                href="https://facebook.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg
                  className="size-6"
                  height="1em"
                  viewBox="0 0 24 24"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95"
                    fill="currentColor"
                  />
                </svg>
              </Link>
              <Link
                aria-label="Threads"
                className="block text-slate-500 transition-colors hover:text-slate-950"
                href="https://threads.net"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg
                  className="size-6"
                  height="1em"
                  viewBox="0 0 24 24"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    color="currentColor"
                    d="M19.25 8.505c-1.577-5.867-7-5.5-7-5.5s-7.5-.5-7.5 8.995s7.5 8.996 7.5 8.996s4.458.296 6.5-3.918c.667-1.858.5-5.573-6-5.573c0 0-3 0-3 2.5c0 .976 1 2 2.5 2s3.171-1.027 3.5-3c1-6-4.5-6.5-6-4"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                  />
                </svg>
              </Link>
              <Link
                aria-label="Instagram"
                className="block text-slate-500 transition-colors hover:text-slate-950"
                href="https://instagram.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg
                  className="size-6"
                  height="1em"
                  viewBox="0 0 24 24"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4zm9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8A1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5a5 5 0 0 1-5 5a5 5 0 0 1-5-5a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3a3 3 0 0 0 3 3a3 3 0 0 0 3-3a3 3 0 0 0-3-3"
                    fill="currentColor"
                  />
                </svg>
              </Link>
              <Link
                aria-label="TikTok"
                className="block text-slate-500 transition-colors hover:text-slate-950"
                href="https://tiktok.com"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg
                  className="size-6"
                  height="1em"
                  viewBox="0 0 24 24"
                  width="1em"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M16.6 5.82s.51.5 0 0A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6c0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64c0 3.33 2.76 5.7 5.69 5.7c3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48"
                    fill="currentColor"
                  />
                </svg>
              </Link>
            </div>

            <span className="block text-center text-sm tracking-[0.01em] text-slate-500">
              © 2026 Medix Research Prototype. All rights reserved.
            </span>
          </div>
        </footer>
      </main>
    </>
  );
}
