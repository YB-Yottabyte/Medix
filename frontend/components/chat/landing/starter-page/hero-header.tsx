"use client";

import { Menu, Stethoscope, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { codeHref, menuItems } from "./data";

export function HeroHeader() {
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
