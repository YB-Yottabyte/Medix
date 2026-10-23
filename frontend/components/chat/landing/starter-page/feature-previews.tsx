import { Play } from "lucide-react";

function WindowBar({ label }: { label: string }) {
  return (
    <div className="flex h-7 items-center gap-1.5 border-neutral-200 border-b bg-neutral-50 px-3">
      <span className="size-1.5 rounded-full bg-neutral-300" />
      <span className="size-1.5 rounded-full bg-neutral-300" />
      <span className="size-1.5 rounded-full bg-neutral-300" />
      <span className="ml-3 text-[9px] text-neutral-500">{label}</span>
    </div>
  );
}

export function EvidenceCardPreview() {
  return (
    <div
      aria-hidden="true"
      className="medix-card-preview relative mt-8 h-48 shrink-0 overflow-hidden rounded-t-xl border border-sky-200/60 bg-sky-50 p-5 pb-0"
    >
      <div className="min-w-[320px] overflow-hidden rounded-t-lg border border-neutral-200 bg-white shadow-lg shadow-sky-900/10">
        <WindowBar label="Video evidence · interface preview" />
        <div className="grid grid-cols-[1.25fr_1fr]">
          <div className="p-3">
            <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-sky-100 via-blue-100 to-indigo-200">
              <div className="absolute -right-3 -bottom-5 size-24 rounded-full border-[12px] border-white/35" />
              <Play className="relative size-8 rounded-full border border-white/80 bg-white/70 p-2 text-primary" />
              <div className="absolute right-2 bottom-2 left-2 h-0.5 rounded bg-white/80">
                <div className="h-full w-2/5 bg-primary/60" />
              </div>
            </div>
            <div className="mt-2 font-medium text-[9px] text-neutral-600">
              Supporting video segment
            </div>
          </div>
          <div className="border-neutral-100 border-l p-3">
            <div className="font-medium text-[9px] text-neutral-700">
              Transcript references
            </div>
            {[1, 2, 3].map((n) => (
              <div className="mt-3 flex gap-2" key={n}>
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary/50" />
                <div className="w-full space-y-1.5">
                  <div className="h-1.5 w-full rounded bg-neutral-200" />
                  <div className="h-1.5 w-3/4 rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResearchCardPreview() {
  return (
    <div
      aria-hidden="true"
      className="medix-card-preview relative mt-4 h-36 shrink-0 overflow-hidden rounded-t-xl border border-indigo-200/60 bg-indigo-50 p-4 pb-0"
    >
      <div className="min-w-[310px] overflow-hidden rounded-t-lg border border-neutral-200 bg-white shadow-indigo-900/10 shadow-lg">
        <WindowBar label="Medix documentation · interface preview" />
        <div className="grid grid-cols-[85px_1fr]">
          <div className="space-y-2 border-neutral-200 border-r bg-neutral-50 p-2 text-[8px] text-neutral-500">
            <div className="rounded bg-primary/10 px-1.5 py-1 text-primary">
              Overview
            </div>
            <div className="px-1.5">Architecture</div>
            <div className="px-1.5">Evaluation</div>
            <div className="px-1.5">Limitations</div>
          </div>
          <div className="p-3">
            <div className="font-semibold text-[11px] text-neutral-800">
              How Medix works
            </div>
            <div className="mt-2 h-1.5 w-full rounded bg-neutral-100" />
            <div className="mt-1.5 h-1.5 w-3/4 rounded bg-neutral-100" />
            <div className="mt-3 flex gap-1">
              {["Question", "Evidence", "Answer"].map((label) => (
                <div
                  className="rounded border border-primary/15 bg-primary/5 px-2 py-2 text-[7px] text-primary"
                  key={label}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
