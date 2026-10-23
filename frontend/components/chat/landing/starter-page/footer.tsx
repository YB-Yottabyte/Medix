import { ArrowUpRight, Github } from "lucide-react";
import Link from "next/link";
import { MedixBrand } from "@/components/chat/medix-brand";
import { codeHref } from "./data";
import { FooterMascot } from "./footer-mascot";

const linkClass =
  "inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary";

export function StarterPageFooter() {
  return (
    <footer
      className="relative isolate mt-56 text-foreground sm:mt-80"
      id="footer"
    >
      <FooterMascot />
      <div className="relative z-20 border-border border-t bg-background">
        <div className="mx-auto grid max-w-[72rem] gap-10 px-6 py-14 sm:px-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:py-16">
          <div>
            <Link
              aria-label="Medix home"
              className="inline-flex transition-opacity hover:opacity-75"
              href="/"
            >
              <MedixBrand className="text-[25px]" />
            </Link>
            <p className="mt-4 max-w-xs text-muted-foreground text-sm leading-6">
              Medical questions, grounded in video evidence.
            </p>
          </div>
          <nav
            aria-label="Footer navigation"
            className="grid grid-cols-2 gap-8"
          >
            <div>
              <h2 className="mb-2 font-medium text-foreground text-xs">
                Explore Medix
              </h2>
              <ul>
                <li>
                  <Link className={linkClass} href="#features">
                    How it works
                  </Link>
                </li>
                <li>
                  <Link className={linkClass} href="#examples">
                    Examples
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="mb-2 font-medium text-foreground text-xs">
                Project
              </h2>
              <ul>
                <li>
                  <Link className={linkClass} href="/docs">
                    Documentation
                  </Link>
                </li>
                <li>
                  <a
                    className={linkClass}
                    href={codeHref}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Github aria-hidden="true" className="size-4" />
                    GitHub
                    <ArrowUpRight aria-hidden="true" className="size-3" />
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>
        <div className="border-border border-t">
          <div className="mx-auto flex max-w-[72rem] flex-col gap-2 px-6 py-6 text-muted-foreground text-xs leading-5 sm:flex-row sm:justify-between sm:px-8">
            <span>© 2026 Medix</span>
            <p>
              Research software. Not a substitute for professional medical care.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
