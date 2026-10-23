"use client";

import { ChevronDown, Clock3, X } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatTiming,
  type ResponseTiming,
  stageLabels,
} from "@/lib/response-timing-data";

/** Compact summary first; implementation details stay behind an explicit disclosure. */
export function ResponseTimingDetails({ timing }: { timing: ResponseTiming }) {
  return (
    <div className="space-y-4">
      <dl className="space-y-2.5 text-xs">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Server processing</dt>
          <dd className="shrink-0 font-medium text-foreground tabular-nums">
            {formatTiming(timing.totalMs)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">First answer text</dt>
          <dd className="shrink-0 text-foreground tabular-nums">
            {timing.firstAnswerMs === null
              ? "Not recorded"
              : formatTiming(timing.firstAnswerMs)}
          </dd>
        </div>
      </dl>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Server timings only. Upload, delivery to your browser and display time
        are excluded.
      </p>
      <details className="group/breakdown border-border/60 border-t pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-muted-foreground text-xs transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          Component breakdown
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 transition-transform group-open/breakdown:rotate-180"
          />
        </summary>
        <div className="mt-3 max-h-64 space-y-4 overflow-y-auto overscroll-contain pr-1 text-[11px] leading-relaxed">
          {(["nextjs", "fastapi"] as const).map((layer) => {
            const stages = timing.stages.filter(
              (stage) => stage.layer === layer
            );
            if (!stages.length) {
              return null;
            }
            return (
              <section key={layer}>
                <h4 className="mb-2 font-medium text-foreground">
                  {layer === "nextjs" ? "Next.js" : "FastAPI"}
                </h4>
                <dl className="space-y-2">
                  {stages.map((stage) => (
                    <div
                      className="flex items-baseline justify-between gap-4"
                      key={stage.name}
                    >
                      <dt className="min-w-0 text-muted-foreground">
                        {stageLabels[stage.name]}
                        {stage.calls > 1 && (
                          <span className="ml-1">· {stage.calls} calls</span>
                        )}
                        {stage.errors > 0 && (
                          <span className="ml-1">
                            · {stage.errors} failed attempts
                          </span>
                        )}
                      </dt>
                      <dd className="shrink-0 whitespace-nowrap text-foreground tabular-nums">
                        {formatTiming(stage.durationMs)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
          {timing.backendCalls === 0 ? (
            <p className="text-muted-foreground">
              No backend measurements for this response.
            </p>
          ) : timing.backendDetailed ? null : (
            <p className="text-muted-foreground">
              Detailed backend timings are unavailable for this response.
            </p>
          )}
          <p className="text-muted-foreground">
            Stages may overlap. The total is measured separately; do not add
            component times together. Timing-record storage is excluded.
          </p>
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            Trace ID: {timing.requestId}
          </p>
        </div>
      </details>
    </div>
  );
}

export function ResponseTimingPanel({ timing }: { timing: ResponseTiming }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`Response timing: ${formatTiming(timing.totalMs)}. Show response details`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground/70 tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          data-testid="response-timing"
          title="Response details"
          type="button"
        >
          <Clock3 aria-hidden="true" className="size-3" strokeWidth={1.8} />
          <span>{formatTiming(timing.totalMs)}</span>
          {timing.status === "error" && (
            <span className="sr-only">Incomplete response</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Response details"
        className="max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl p-4 shadow-[var(--shadow-float)]"
        collisionPadding={16}
        data-testid="response-timing-details"
        sideOffset={8}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-medium text-[13px] text-foreground">
            Response details
          </h3>
          <button
            aria-label="Close response details"
            className="-mr-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => setOpen(false)}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
        <ResponseTimingDetails timing={timing} />
      </PopoverContent>
    </Popover>
  );
}
