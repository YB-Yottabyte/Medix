"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn, generateUUID } from "@/lib/utils";
import { menuItems } from "./data";

const wordmarkLetters = ["E", "D", "I", "X"] as const;

function MedixWordmark({ collapseStage }: { collapseStage: number }) {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const visibleLetterCount = Math.max(
    0,
    wordmarkLetters.length - collapseStage
  );

  return (
    <motion.span
      className="relative inline-flex h-9 items-center overflow-visible text-[1.6rem] font-semibold leading-none tracking-[-0.025em] text-slate-950"
      data-medix-wordmark
    >
      <motion.span
        animate={{ opacity: 1, x: 0 }}
        className="relative z-10 inline-block"
        initial={prefersReducedMotion ? false : { opacity: 0, x: -12 }}
        transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
      >
        M
      </motion.span>
      <motion.span
        animate={{ opacity: 1, scaleY: 1 }}
        aria-hidden
        className="mx-[0.14em] inline-block h-[0.92em] w-[0.28em] shrink-0 origin-center bg-sky-500 [clip-path:polygon(0_0,34%_0,100%_100%,66%_100%)] transition-[margin,transform] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:mx-[0.2em] group-hover:scale-x-110"
        initial={prefersReducedMotion ? false : { opacity: 0, scaleY: 0.16 }}
        transition={{
          delay: prefersReducedMotion ? 0 : 0.5,
          duration: 1.8,
          ease: [0.22, 1, 0.36, 1],
        }}
      />
      <motion.span
        animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
        className="inline-flex items-center overflow-hidden"
        initial={
          prefersReducedMotion
            ? false
            : {
                clipPath: "inset(0 100% 0 0)",
                opacity: 0,
              }
        }
        transition={{
          delay: prefersReducedMotion ? 0 : 0.82,
          duration: 3.9,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {wordmarkLetters.map((letter, index) => {
          const isVisible = index < visibleLetterCount;

          return (
            <motion.span
              animate={{
                marginRight: isVisible && index < 3 ? "0.025em" : "0em",
                opacity: isVisible ? 1 : 0,
                width: isVisible ? "auto" : 0,
                x: isVisible ? 0 : -5,
              }}
              className="inline-block overflow-hidden"
              data-wordmark-letter={letter}
              initial={false}
              key={letter}
              transition={{
                duration: prefersReducedMotion ? 0 : 1.25,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {letter}
            </motion.span>
          );
        })}
      </motion.span>
    </motion.span>
  );
}

export function HeroHeader() {
  const router = useRouter();
  const [menuState, setMenuState] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [wordmarkCollapseStage, setWordmarkCollapseStage] = useState(0);

  useEffect(() => {
    let animationFrame: number | undefined;

    const updateFromScroll = () => {
      const scrollTop = window.scrollY;
      const nextStage = Math.min(4, Math.floor(scrollTop / 220));

      setIsScrolled(scrollTop > 24);
      setWordmarkCollapseStage(nextStage);
      animationFrame = undefined;
    };

    const handleScroll = () => {
      if (animationFrame === undefined) {
        animationFrame = window.requestAnimationFrame(updateFromScroll);
      }
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, []);

  const openChat = () => router.push(`/chat/${generateUUID()}`);

  return (
    <header>
      <motion.nav
        animate={{ opacity: 1 }}
        className="fixed inset-x-0 top-0 z-40 px-3 sm:px-5"
        initial={{ opacity: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          className={cn(
            "mx-auto mt-3 max-w-[92rem] rounded-[1.35rem] border border-transparent px-3 transition-all duration-500 sm:px-5",
            isScrolled &&
              "max-w-[88rem] border-slate-200/80 bg-white/88 shadow-[0_14px_45px_-30px_rgba(15,23,42,0.28)] backdrop-blur-xl"
          )}
        >
          <div className="flex h-16 items-center justify-between gap-6">
            <Link
              aria-label="Medix home"
              className="group flex items-center px-1 py-2"
              href="/"
            >
              <MedixWordmark collapseStage={wordmarkCollapseStage} />
            </Link>

            <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-[13px] text-slate-600 lg:flex">
              {menuItems.map((item) => (
                <li key={item.name}>
                  <Link
                    className="transition-colors hover:text-slate-950"
                    href={item.href}
                    rel={item.external ? "noreferrer" : undefined}
                    target={item.external ? "_blank" : undefined}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="hidden items-center gap-2 lg:flex">
              <Link
                className="flex h-10 items-center rounded-full px-4 text-[13px] font-medium text-slate-600 transition-colors duration-300 hover:bg-slate-100 hover:text-slate-950"
                href="/login"
              >
                Log in
              </Link>
              <Button
                className="group relative h-10 overflow-hidden rounded-full border-slate-300 bg-white px-5 text-[13px] text-slate-950 shadow-none transition-colors duration-500 hover:bg-white hover:text-white"
                onClick={openChat}
                variant="outline"
              >
                <span className="absolute inset-0 bg-slate-950 [clip-path:polygon(0_100%,0_100%,0_100%)] transition-[clip-path] duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:[clip-path:polygon(0_100%,0_-100%,200%_100%)]" />
                <span className="relative z-10 flex items-center gap-1.5">
                  Try Medix
                  <ArrowUpRight className="size-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </Button>
            </div>

            <button
              aria-label={menuState ? "Close menu" : "Open menu"}
              className="relative flex size-10 items-center justify-center rounded-full bg-white text-slate-800 shadow-sm ring-1 ring-slate-200 lg:hidden"
              onClick={() => setMenuState((current) => !current)}
              type="button"
            >
              {menuState ? (
                <X className="size-4" />
              ) : (
                <Menu className="size-4" />
              )}
            </button>
          </div>

          <div
            className={cn(
              "grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 lg:hidden",
              menuState
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0"
            )}
          >
            <div className="min-h-0">
              <div className="border-t border-slate-200/80 py-4">
                <ul className="grid gap-1">
                  {menuItems.map((item) => (
                    <li key={item.name}>
                      <Link
                        className="block rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-100"
                        href={item.href}
                        onClick={() => setMenuState(false)}
                      >
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2 px-1">
                  <Button asChild className="rounded-full" variant="outline">
                    <Link href="/login">Log in</Link>
                  </Button>
                  <Button
                    className="group relative overflow-hidden rounded-full border-slate-300 bg-white text-slate-950 shadow-none hover:bg-white hover:text-white"
                    onClick={openChat}
                    variant="outline"
                  >
                    <span className="absolute inset-0 bg-slate-950 [clip-path:polygon(0_100%,0_100%,0_100%)] transition-[clip-path] duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:[clip-path:polygon(0_100%,0_-100%,200%_100%)]" />
                    <span className="relative z-10 flex items-center gap-1.5">
                      Try ChatGPT
                      <ArrowUpRight className="size-3.5" />
                    </span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.nav>
    </header>
  );
}
