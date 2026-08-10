import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Toaster } from "sonner";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-white font-sans text-slate-950">
      <Toaster
        position="top-center"
        theme="light"
        toastOptions={{
          className:
            "!bg-white !text-slate-950 !border-slate-200 !shadow-[0_16px_40px_rgba(15,23,42,0.12)]",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-18rem] left-1/2 h-[34rem] w-[54rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(186,230,253,0.24)_0%,rgba(224,242,254,0.1)_42%,transparent_72%)] blur-2xl"
      />

      <header className="absolute inset-x-0 top-0 z-10 flex h-20 items-center justify-between px-5 sm:px-8 lg:px-10">
        <Link
          aria-label="Medix home"
          className="text-[19px] font-semibold tracking-[-0.045em] text-slate-950 transition-opacity hover:opacity-65"
          href="/"
        >
          Medix
        </Link>
        <Link
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-normal text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
          href="/"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to Medix
        </Link>
      </header>

      <main className="relative z-[1] grid min-h-dvh place-items-center px-5 pt-24 pb-20 sm:px-8">
        <section className="w-full max-w-[390px] animate-in fade-in slide-in-from-bottom-2 duration-500">
          {children}
        </section>
      </main>

      <footer className="absolute inset-x-0 bottom-0 z-10 px-5 pb-6 text-center text-[10.5px] text-slate-400 sm:px-8">
        Medix is research software and is not a substitute for professional
        medical care.
      </footer>
    </div>
  );
}
