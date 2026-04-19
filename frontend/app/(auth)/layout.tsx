import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { SparklesIcon } from "@/components/chat/icons";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh w-screen bg-sidebar">
      <div className="flex w-full flex-col bg-background p-8 xl:w-[600px] xl:shrink-0 xl:rounded-r-2xl xl:border-r xl:border-border/40 md:p-16">
        <Link
          className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          href="/"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back
        </Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10">
          <div className="flex flex-col gap-2">
            <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SparklesIcon size={14} />
            </div>
            {children}
          </div>
        </div>
      </div>

      <div className="hidden flex-1 flex-col overflow-hidden pl-12 xl:flex">
        <div className="flex items-center gap-1.5 pt-8 text-[13px] text-muted-foreground/50">
          <span className="font-medium text-muted-foreground">MedVidQA</span>
          <span>multimodal medical assistant</span>
        </div>
        <div className="flex flex-1 items-center pt-4">
          <div className="max-w-xl rounded-3xl border border-border/40 bg-card/70 p-8 shadow-[var(--shadow-card)]">
            <div className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              MedVidQA
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Verified medical guidance with retrieval, image analysis, and
              video support.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              This workspace is tailored for MedVidQA rather than the original
              template’s document and artifact tools. Sign in to access the
              streamlined chat experience for procedure retrieval, multimodal
              questions, and video-backed answers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
