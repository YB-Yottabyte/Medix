"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type { CitedCue } from "@/lib/ai/medical-follow-up";
import { cn } from "@/lib/utils";

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

/**
 * Shows the transcript segments an answer was built from. Grounding is the
 * point of the system, so it should be inspectable — but it stays collapsed,
 * and it exposes only spoken text and timestamps, never cue or bundle IDs.
 */
export function EvidenceProvenance({
  cues,
  onSeek,
}: {
  cues: CitedCue[];
  onSeek?: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);

  if (cues.length === 0) {
    return null;
  }

  return (
    <div className="mt-2.5">
      <button
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDownIcon
          className={cn(
            "size-3 transition-transform",
            open ? "rotate-0" : "-rotate-90"
          )}
        />
        {open
          ? "Hide what this is based on"
          : `Why this answer (${cues.length} transcript ${
              cues.length === 1 ? "moment" : "moments"
            })`}
      </button>

      {open && (
        <ul className="mt-2 space-y-1.5 border-border/60 border-l-2 pl-3">
          {cues.map((cue) => (
            <li
              className="text-[12px] leading-5 text-muted-foreground"
              key={`${cue.startSeconds}-${cue.text.slice(0, 24)}`}
            >
              <button
                className="mr-1.5 rounded bg-[#edf5f8] px-1 py-0.5 font-mono font-semibold text-[#174a62] text-[10px] transition-colors hover:bg-[#dcecf2] disabled:cursor-default dark:bg-sky-950/45 dark:text-sky-200"
                disabled={!onSeek}
                onClick={() => onSeek?.(cue.startSeconds)}
                title={onSeek ? "Play this moment" : undefined}
                type="button"
              >
                {formatTime(cue.startSeconds)}–{formatTime(cue.endSeconds)}
              </button>
              <span className="italic">“{cue.text}”</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
