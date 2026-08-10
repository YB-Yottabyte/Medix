import { ArrowUp, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { codeHref } from "./data";

const footerColumns = [
  {
    title: "Product",
    links: [
      { label: "Ask a question", href: "/" },
      { label: "Guided answers", href: "#features" },
      { label: "Video guidance", href: "#features" },
      { label: "Voice and image input", href: "#features" },
    ],
  },
  {
    title: "Evidence",
    links: [
      { label: "Timestamped citations", href: "#features" },
      { label: "Verified video sources", href: "#features" },
      { label: "Evidence retrieval", href: "#pipeline" },
      { label: "How the pipeline works", href: "#pipeline" },
    ],
  },
  {
    title: "Research",
    links: [
      { label: "Research overview", href: "#quest3-research" },
      { label: "Caregiver interaction", href: "#quest3-research" },
      { label: "Prototype scope", href: "#quest3-research" },
      { label: "Safety context", href: "#quest3-research" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub repository", href: codeHref, external: true },
      { label: "View source code", href: codeHref, external: true },
      { label: "Feature overview", href: "#features" },
      { label: "System workflow", href: "#pipeline" },
    ],
  },
] satisfies Array<{
  title: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
}>;

export function StarterPageFooter() {
  return (
    <footer className="bg-white pt-16 pb-8 md:pt-24" id="footer">
      <div className="mx-auto max-w-[92rem] px-5 sm:px-7 md:px-10">
        <nav
          aria-label="Footer navigation"
          className="grid grid-cols-2 gap-x-8 gap-y-14 pb-20 sm:grid-cols-4 md:gap-x-14 md:pb-24"
        >
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-normal text-slate-400">
                {column.title}
              </h2>
              <ul className="mt-6 space-y-4">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      className="group inline-flex items-center gap-1.5 text-sm leading-5 text-slate-800 transition-colors hover:text-sky-700"
                      href={link.href}
                      rel={link.external ? "noreferrer" : undefined}
                      target={link.external ? "_blank" : undefined}
                    >
                      {link.label}
                      {link.external && (
                        <ArrowUpRight className="size-3.5 text-slate-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-sky-700" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 pt-6">
          <div className="flex flex-col gap-5 text-xs text-slate-400 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span>© 2026 Medix Research Prototype</span>
              <span>ASU Barrett Honors College</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span>Not a medical device</span>
              <Link
                className="group inline-flex items-center gap-1.5 text-slate-500 transition-colors hover:text-slate-950"
                href="#"
              >
                Back to top
                <ArrowUp className="size-3 transition-transform duration-200 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
