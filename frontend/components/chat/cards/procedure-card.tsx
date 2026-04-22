type ProcedureOutput = {
  videoId?: string | null;
  videoUrl?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  steps?: Array<{
    time?: number;
    start_time?: number;
    end_time?: number | null;
    description: string;
  }>;
  matchedProcedure?: string | null;
  similarity?: number | null;
  retrievedCount?: number;
  unavailable?: boolean;
  error?: string;
};

export function ProcedureCard({ output }: { output: ProcedureOutput }) {
  if (output?.unavailable) {
    return (
      <div className="w-full max-w-[560px] rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
        <div className="mb-1 font-semibold">
          Verified procedure retrieval temporarily unavailable
        </div>
        <div className="text-xs opacity-90">
          Medix could not reach the verified retrieval backend right now, so no
          transcript-grounded procedure or video match is available at the
          moment.
        </div>
      </div>
    );
  }

  if (output?.error) {
    return (
      <div className="w-full max-w-[560px] rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 text-sm dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
        <div className="mb-1 font-semibold">Procedure search unavailable</div>
        <div className="text-xs opacity-90">{output.error}</div>
      </div>
    );
  }

  const { videoId, startTime, endTime, matchedProcedure, similarity, steps } =
    output;
  const embedSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?start=${Math.floor(startTime ?? 0)}${
        endTime ? `&end=${Math.floor(endTime)}` : ""
      }&rel=0&modestbranding=1`
    : null;

  return (
    <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground text-xs uppercase tracking-wide">
              Matched procedure
            </div>
            <div className="truncate font-medium text-sm">
              {matchedProcedure ?? "Unknown procedure"}
            </div>
          </div>
          {typeof similarity === "number" && (
            <div className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground text-xs">
              {Math.round(similarity * 100)}% match
            </div>
          )}
        </div>

        {startTime != null && (
          <div className="text-muted-foreground text-xs">
            Jumps to {formatTime(startTime)}
            {endTime ? ` – ${formatTime(endTime)}` : ""} of the source video.
          </div>
        )}

        {steps && steps.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">
              Steps
            </summary>
            <ol className="mt-2 space-y-1 text-xs">
              {steps.map((s) => {
                const stepTime =
                  typeof s.start_time === "number"
                    ? s.start_time
                    : typeof s.time === "number"
                      ? s.time
                      : 0;

                return (
                  <li
                    className="flex gap-2"
                    key={`${stepTime}-${s.end_time ?? "na"}-${s.description}`}
                  >
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {formatTime(stepTime)}
                    </span>
                    <span>{s.description}</span>
                  </li>
                );
              })}
            </ol>
          </details>
        )}

        <div className="pt-2">
          <div className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">
            Video
          </div>
          {embedSrc ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
                src={embedSrc}
                title={matchedProcedure ?? "MedVidQA procedure video"}
              />
            </div>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-muted-foreground text-sm">
              No verified video match
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
