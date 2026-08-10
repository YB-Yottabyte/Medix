"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const pieces = [
  {
    className: "left-1 top-1 h-[4.25rem] w-[1.05rem]",
    enter: { x: -34, y: -16, rotate: -8 },
    rotate: 0,
    delay: 0.52,
  },
  {
    className: "left-[1.9rem] top-[0.7rem] h-[3.75rem] w-[1.05rem]",
    enter: { x: -22, y: 30, rotate: -52 },
    rotate: -27,
    delay: 0.76,
  },
  {
    className: "right-[1.9rem] top-[0.7rem] h-[3.75rem] w-[1.05rem]",
    enter: { x: 22, y: 30, rotate: 52 },
    rotate: 27,
    delay: 1,
  },
  {
    className: "right-1 top-1 h-[4.25rem] w-[1.05rem]",
    enter: { x: 34, y: -16, rotate: 8 },
    rotate: 0,
    delay: 1.24,
  },
] as const;

let introPlayedForDocument = false;

function didDocumentLoadAtCurrentPath() {
  const navigationEntry = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;

  if (!navigationEntry) {
    return true;
  }

  try {
    return new URL(navigationEntry.name).pathname === window.location.pathname;
  } catch {
    return true;
  }
}

function startIntroSound() {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextConstructor) {
    return () => undefined;
  }

  const context = new AudioContextConstructor();
  let played = false;
  let closeTimer: number | undefined;

  const play = async () => {
    if (played) {
      return;
    }

    try {
      await context.resume();
      if (context.state !== "running") {
        return;
      }

      played = true;
      const start = context.currentTime + 0.12;
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(174, start);
      oscillator.frequency.exponentialRampToValueAtTime(348, start + 2.75);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(900, start);
      filter.frequency.exponentialRampToValueAtTime(2200, start + 2.7);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.024, start + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.95);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 3);

      closeTimer = window.setTimeout(() => {
        context.close().catch(() => undefined);
      }, 3500);
    } catch {
      // Browsers may block audio until the first user gesture.
    }
  };

  play().catch(() => undefined);
  window.addEventListener("pointerdown", play, { once: true });
  window.addEventListener("keydown", play, { once: true });

  return () => {
    window.removeEventListener("pointerdown", play);
    window.removeEventListener("keydown", play);
    if (closeTimer) {
      window.clearTimeout(closeTimer);
    }
    if (context.state !== "closed") {
      context.close().catch(() => undefined);
    }
  };
}

export function BrandIntro({ onComplete }: { onComplete: () => void }) {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [visible, setVisible] = useState(false);
  const completeRef = useRef(onComplete);
  const shouldPlayRef = useRef<boolean | null>(null);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (shouldPlayRef.current === null) {
      shouldPlayRef.current =
        !introPlayedForDocument && didDocumentLoadAtCurrentPath();
      introPlayedForDocument = true;
    }

    if (prefersReducedMotion || !shouldPlayRef.current) {
      completeRef.current();
      return;
    }

    setVisible(true);
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const stopSound = startIntroSound();
    const timer = window.setTimeout(() => {
      stopSound();
      setVisible(false);
    }, 4400);

    return () => {
      window.clearTimeout(timer);
      stopSound();
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [prefersReducedMotion]);

  return (
    <AnimatePresence
      onExitComplete={() => {
        document.documentElement.style.overflow = "";
        completeRef.current();
      }}
    >
      {visible && (
        <motion.div
          animate={{ backgroundColor: "#05070b", opacity: 1 }}
          aria-label="Medix introduction"
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
          exit={{
            backgroundColor: "#ffffff",
            opacity: 0,
            transition: {
              backgroundColor: { duration: 0.62 },
              opacity: { duration: 0.64 },
            },
          }}
          initial={{ backgroundColor: "#020305", opacity: 1 }}
          role="status"
        >
          <motion.div
            animate={{ opacity: [0, 0.4, 0.18], scale: [0.75, 1.1, 1] }}
            className="absolute size-72 rounded-full bg-sky-500/20 blur-[90px] sm:size-96"
            initial={false}
            transition={{
              duration: 4.2,
              ease: [0.22, 1, 0.36, 1],
              times: [0, 0.42, 1],
            }}
          />

          <motion.div
            animate={{ opacity: 1, scale: [0.98, 1, 0.98] }}
            className="relative flex flex-col items-center"
            initial={{ opacity: 1, scale: 0.98 }}
            transition={{
              duration: 4.4,
              ease: [0.22, 1, 0.36, 1],
              times: [0, 0.72, 1],
            }}
          >
            <div className="relative h-20 w-28 sm:h-24 sm:w-32">
              {pieces.map((piece, index) => (
                <motion.div
                  animate={{
                    opacity: 1,
                    rotate: piece.rotate,
                    scale: 1,
                    x: 0,
                    y: 0,
                  }}
                  className={`absolute overflow-hidden rounded-full ${piece.className}`}
                  initial={{
                    opacity: 0,
                    rotate: piece.enter.rotate,
                    scale: 0.72,
                    x: piece.enter.x,
                    y: piece.enter.y,
                  }}
                  key={piece.className}
                  transition={{
                    delay: piece.delay,
                    duration: 1.35,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <motion.div
                    animate={{ opacity: [0, 1, 1, 0], x: ["-45%", "8%"] }}
                    className="absolute inset-y-0 -left-full w-[300%] bg-[linear-gradient(115deg,#0b2447_8%,#0284c7_32%,#a5f3fc_49%,#2563eb_67%,#091426_92%)]"
                    initial={{ opacity: 0, x: "-45%" }}
                    transition={{
                      delay: 1.08 + index * 0.12,
                      duration: 1.8,
                      ease: "easeInOut",
                      times: [0, 0.16, 0.7, 1],
                    }}
                  />
                  <motion.div
                    animate={{ opacity: [0, 0, 1] }}
                    className="absolute inset-0 bg-white"
                    initial={{ opacity: 0 }}
                    transition={{
                      delay: 1.75 + index * 0.08,
                      duration: 1.4,
                      ease: "easeOut",
                      times: [0, 0.58, 1],
                    }}
                  />
                </motion.div>
              ))}
            </div>

            <motion.div
              animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
              className="mt-7 overflow-hidden text-white"
              initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0 }}
              transition={{
                delay: 2.62,
                duration: 1.28,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <motion.div
                animate={{ letterSpacing: ["0.34em", "0.24em"] }}
                className="flex items-center text-xl font-semibold sm:text-2xl"
                initial={false}
                transition={{
                  delay: 2.92,
                  duration: 1.02,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span>M</span>
                <span
                  aria-hidden
                  className="mx-[0.12em] inline-block h-[0.85em] w-[0.34em] bg-sky-400 [clip-path:polygon(0_0,32%_0,100%_100%,68%_100%)]"
                />
                <span>EDIX</span>
              </motion.div>
            </motion.div>
          </motion.div>

          <span className="sr-only">Loading the Medix research experience</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
