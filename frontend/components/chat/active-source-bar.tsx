"use client";

import { VideoIcon } from "lucide-react";
import { activeSourceLabel } from "@/lib/active-source";
import { COLLECTION_SEARCH_REQUEST } from "@/lib/ai/medical-follow-up";
import type { ChatMessage } from "@/lib/types";

/**
 * Retrieve-vs-reuse is otherwise invisible: this names the video the next
 * follow-up will be answered from, and offers the only route off it.
 */
export function ActiveSourceBar({
  isReadonly,
  messages,
}: {
  isReadonly: boolean;
  messages: ChatMessage[];
}) {
  const label = activeSourceLabel(messages);

  if (!label) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-1.5 text-[11px] text-muted-foreground sm:px-5">
      <VideoIcon className="size-3 shrink-0" />
      <span className="min-w-0 truncate">
        Answering from{" "}
        <span className="font-medium text-foreground/80">{label}</span>
      </span>
      {!isReadonly && (
        <button
          className="rounded-full border border-border/60 px-2 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("medix:ask", {
                detail: { text: COLLECTION_SEARCH_REQUEST },
              })
            )
          }
          type="button"
        >
          Search a different video
        </button>
      )}
    </div>
  );
}
