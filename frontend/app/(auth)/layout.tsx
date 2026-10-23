import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Toaster } from "sonner";
import { MedixBrand } from "@/components/chat/medix-brand";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background font-sans text-foreground">
      <Toaster
        position="top-center"
        theme="light"
        toastOptions={{
          className:
            "!bg-white !text-slate-950 !border-slate-200 !shadow-[0_16px_40px_rgba(15,23,42,0.12)]",
        }}
      />
      <header className="absolute inset-x-0 top-0 z-10 flex h-20 items-center justify-between px-5 sm:px-8 lg:px-10">
        <Link
          aria-label="Medix home"
          className="font-semibold text-[19px] text-slate-950 tracking-[-0.045em] transition-opacity hover:opacity-65"
          href="/"
        >
          <MedixBrand className="text-[25px]" />
        </Link>
        <Link
          className="flex h-9 items-center gap-1.5 rounded-full px-3 font-normal text-[12.5px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
          href="/"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to Medix
        </Link>
      </header>

      <main className="relative z-[1] grid min-h-dvh place-items-center px-5 pt-24 pb-20 sm:px-8">
        <section className="fade-in slide-in-from-bottom-2 w-full max-w-[420px] animate-in rounded-2xl border border-border bg-card p-6 shadow-sm duration-500 sm:p-8">
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
