"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export function FutureWorkflowPlaceholder({
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
