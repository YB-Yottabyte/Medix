"use client";

import { motion } from "framer-motion";
import { ArrowRight, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function MultimodalWorkflowShowcase({
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

  const showEditor =
    (showUpload || showSegmentation || showAnalyzeClick) && !typedPrompt;
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
                      transition={{ duration: 0.42, ease: "easeOut" }}
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
                      transition={{ duration: 0.45, ease: "easeOut" }}
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
                    transition={{ duration: 0.38, ease: "easeOut" }}
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
                          backgroundColor: showAnalyzeClick
                            ? [
                                "rgb(15 23 42)",
                                "rgb(2 132 199)",
                                "rgb(15 23 42)",
                              ]
                            : "rgb(15 23 42)",
                        }}
                        className="rounded-full bg-slate-950 px-4 py-2 text-xs font-medium text-white"
                        transition={{ duration: 0.7, ease: "easeInOut" }}
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
                          transition={{ duration: 0.35, ease: "easeOut" }}
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
                          <span className="text-white/28">Ask anything...</span>
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
                          transition={{ duration: 0.9, ease: "easeInOut" }}
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
