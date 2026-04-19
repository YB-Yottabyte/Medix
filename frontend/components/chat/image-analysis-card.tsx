"use client";

import { ResponseAudioButton } from "./response-audio-button";

type ImageAnalysisOutput = {
  bodyPart?: string | null;
  condition?: string | null;
  severity?: string | null;
  matchedProcedure?: string | null;
  videoId?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  answer?: string | null;
  confidence?: number | null;
  error?: string;
};

const SEVERITY_COLORS: Record<string, string> = {
  mild: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  moderate:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  severe: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  emergency: "bg-red-600 text-white",
};

export function ImageAnalysisCard({ output }: { output: ImageAnalysisOutput }) {
  if (output?.error) {
    return (
      <div className="w-full max-w-[560px] rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
        <div className="mb-1 font-semibold">Image analysis failed</div>
        <div className="text-xs opacity-90">{output.error}</div>
      </div>
    );
  }

  const severity = (output.severity ?? "").toLowerCase();
  const severityClass =
    SEVERITY_COLORS[severity] ?? "bg-secondary text-secondary-foreground";

  return (
    <div className="w-full max-w-[560px] space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground text-xs uppercase tracking-wide">
          Vision analysis
        </div>
        {output.severity && (
          <div
            className={`rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide ${severityClass}`}
          >
            {output.severity}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Body part" value={output.bodyPart} />
        <Field label="Condition" value={output.condition} />
      </div>

      {output.matchedProcedure && (
        <div className="rounded-md bg-secondary/50 p-3">
          <div className="text-muted-foreground text-xs uppercase tracking-wide">
            Suggested procedure
          </div>
          <div className="font-medium text-sm">{output.matchedProcedure}</div>
        </div>
      )}

      {output.answer && (
        <div className="rounded-lg border border-border/60 bg-background p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-muted-foreground text-xs uppercase tracking-wide">
              Response
            </div>
            <ResponseAudioButton text={output.answer} />
          </div>
          <div className="whitespace-pre-wrap text-sm leading-6">
            {output.answer}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="font-medium text-sm">{value ?? "—"}</div>
    </div>
  );
}
