"use client";

import { CaptionsIcon, ChevronDownIcon, PlayCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type EvidenceCitation,
  evidenceMomentTitle,
  mapCitationsToClip,
  type PlaybackCitation,
  parseTimestampCitationHref,
  sanitizeProcedureAnswer,
  timestampAnswerCitations,
} from "@/lib/evidence-timestamps";
import {
  expandsMediaWorkspace,
  mountsMediaWorkspace,
  type ResponsePhase,
  responsePhaseForWriting,
  shouldRenderEvidenceWorkspace,
  showsRealMedia,
} from "@/lib/evidence-visibility";
import { cn } from "@/lib/utils";
import { MessageResponse } from "../ai-elements/message";
import { EvidenceProvenance } from "./evidence-provenance";

type ProcedureOutput = {
  answer?: string | null;
  status?: "answered" | "abstained";
  answerable?: boolean;
  confidence?: number | null;
  confidenceThreshold?: number | null;
  abstentionReason?: string | null;
  emergencyWarning?: string | null;
  safetyDisposition?: "supported" | "emergency" | "restricted";
  citations?: EvidenceCitation[];
  evidenceBundleId?: string | null;
  videoId?: string | null;
  videoUrl?: string | null;
  clipUrl?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  steps?: Array<{ time: number; description: string }>;
  matchedProcedure?: string | null;
  similarity?: number | null;
  retrievedCount?: number;
  retrievalDecision?: "retrieve_new_source" | "continue_current_evidence";
  renderMediaWorkspace?: boolean;
  error?: string;
};

/** Kept small so cards stay readable and never need horizontal scrolling. */
const VISIBLE_MOMENTS = 3;

export function ProcedureCard({
  output,
  isAnswerStreaming = false,
  writtenAnswer = "",
}: {
  output: ProcedureOutput;
  isAnswerStreaming?: boolean;
  writtenAnswer?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceCitations = useMemo(
    () => output.citations ?? [],
    [output.citations]
  );
  const clipStart = output.startTime ?? 0;
  const clipEnd = output.endTime ?? clipStart;
  const citations = useMemo(
    () => mapCitationsToClip(sourceCitations, clipStart, clipEnd),
    [clipEnd, clipStart, sourceCitations]
  );
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [activeCueId, setActiveCueId] = useState<string | null>(
    citations[0]?.cue_id ?? null
  );
  const usesClipClock = Boolean(output.clipUrl);
  const abstained =
    output.status === "abstained" || output.answerable === false;
  const hasEvidenceMedia = shouldRenderEvidenceWorkspace({
    status: output.status,
    answerable: output.answerable,
    retrievalDecision: output.retrievalDecision,
    renderMediaWorkspace: output.renderMediaWorkspace,
    hasMedia: Boolean(output.clipUrl || output.videoId),
    hasCitations: citations.length > 0,
  });
  const displayAnswer = sanitizeProcedureAnswer(
    writtenAnswer.trim() || (abstained ? (output.answer ?? "") : ""),
    output.emergencyWarning
  );
  const timestampedAnswer = useMemo(
    () => timestampAnswerCitations(displayAnswer, citations),
    [citations, displayAnswer]
  );
  const hasInlineTimestampCitation =
    timestampedAnswer.includes("(#medix-clip=");
  const { markMediaLoaded, phase } = useResponsePhase({
    hasEvidence: hasEvidenceMedia,
    hasWrittenAnswer: Boolean(timestampedAnswer),
    isAnswerStreaming,
  });
  const mediaMounted = hasEvidenceMedia && mountsMediaWorkspace(phase);
  const mediaExpanded = expandsMediaWorkspace(phase);
  const realMediaVisible = showsRealMedia(phase);

  useEffect(() => {
    setActiveCueId(citations[0]?.cue_id ?? null);
  }, [citations]);

  useEffect(() => {
    const evidenceBundleId = output.evidenceBundleId;
    if (!evidenceBundleId) {
      return;
    }
    const handleEvidenceSeek = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          evidenceBundleId: string;
          startSeconds: number;
        }>
      ).detail;
      if (detail?.evidenceBundleId !== evidenceBundleId) {
        return;
      }
      const video = videoRef.current;
      if (!video) {
        return;
      }
      video.currentTime = Math.max(0, detail.startSeconds);
      // A follow-up citation is usually many turns below this workspace, so
      // bring it into view instead of playing off-screen.
      video.scrollIntoView({ behavior: "smooth", block: "center" });
      video.play().catch(() => {
        // Browsers may require a second user interaction before playback.
      });
    };
    window.addEventListener("medix:seek-evidence", handleEvidenceSeek);
    return () =>
      window.removeEventListener("medix:seek-evidence", handleEvidenceSeek);
  }, [output.evidenceBundleId]);

  if (output?.error) {
    return (
      <div className="w-full rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
        <div className="mb-1 font-semibold text-sm">
          Medix service unavailable
        </div>
        <div className="text-xs leading-5 opacity-80">{output.error}</div>
      </div>
    );
  }

  const { videoId, endTime, matchedProcedure } = output;

  const embedSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?start=${Math.floor(clipStart)}${
        endTime ? `&end=${Math.floor(endTime)}` : ""
      }&rel=0&modestbranding=1`
    : null;

  const selectCitation = (citation: PlaybackCitation) => {
    setActiveCueId(citation.cue_id);
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = citation.clipStartSeconds;
    video.play().catch(() => {
      // Browsers may require a second user interaction before playback.
    });
  };

  const seekToTime = (seconds: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = Math.max(0, seconds);
    video.play().catch(() => {
      // Browsers may require a second user interaction before playback.
    });
  };

  const updateActiveCitation = () => {
    const video = videoRef.current;
    if (!video || citations.length === 0) {
      return;
    }
    const current =
      citations.find(
        (citation) =>
          video.currentTime >= citation.clipStartSeconds &&
          video.currentTime <= citation.clipEndSeconds
      ) ??
      [...citations]
        .reverse()
        .find((citation) => video.currentTime >= citation.clipStartSeconds);
    if (current) {
      setActiveCueId(current.cue_id);
    }
  };

  return (
    <div className="w-full max-w-full space-y-3 overflow-x-hidden">
      <section className="px-1 py-1 sm:px-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                phase === "thinking" || phase === "streaming"
                  ? "animate-pulse bg-amber-500"
                  : "bg-emerald-500"
              )}
            />
            <span className="font-medium">
              {responseStatusLabel(phase, abstained)}
            </span>
          </div>
        </div>

        {output.emergencyWarning && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
            <div className="mb-1 font-semibold text-[12px]">
              Emergency warning
            </div>
            <div className="text-[12px] leading-5 sm:text-[13px]">
              {output.emergencyWarning}
            </div>
          </div>
        )}

        {timestampedAnswer ? (
          <div
            className={cn(
              "relative text-[13px] leading-6 text-foreground/90 sm:text-sm",
              isAnswerStreaming &&
                "after:ml-1 after:inline-block after:h-3.5 after:w-[2px] after:translate-y-[2px] after:animate-pulse after:rounded-full after:bg-foreground/20 after:content-['']"
            )}
          >
            <MessageResponse
              components={{
                a: ({ children, href }) => {
                  const timestamp = parseTimestampCitationHref(href);
                  if (!timestamp) {
                    return <a href={href}>{children}</a>;
                  }
                  return (
                    <button
                      className="inline-flex rounded-md bg-[#edf5f8] px-1.5 py-0.5 font-mono font-semibold text-[#174a62] text-[0.82em] no-underline transition-colors hover:bg-[#dcecf2] dark:bg-sky-950/45 dark:text-sky-200"
                      onClick={() => seekToTime(timestamp.startSeconds)}
                      title="Play this cited moment"
                      type="button"
                    >
                      {children}
                    </button>
                  );
                },
              }}
            >
              {timestampedAnswer}
            </MessageResponse>
          </div>
        ) : isAnswerStreaming ? (
          <output
            aria-label="Generating written answer"
            className="space-y-2 py-1"
          >
            <div className="h-3 w-4/5 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-3/5 animate-pulse rounded-full bg-muted" />
          </output>
        ) : null}
        {timestampedAnswer &&
          citations.length > 0 &&
          !hasInlineTimestampCitation &&
          !isAnswerStreaming && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-border/60 border-t pt-3">
              {citations.slice(0, 6).map((citation) => (
                <button
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#edf5f8] px-2 py-1 text-[#174a62] text-[10px] transition-colors hover:bg-[#dcecf2] dark:bg-sky-950/45 dark:text-sky-200"
                  key={citation.cue_id}
                  onClick={() => seekToTime(citation.clipStartSeconds)}
                  type="button"
                >
                  <span>{evidenceMomentTitle(citation.text)}</span>
                  <span className="font-mono font-semibold">
                    {formatTime(citation.clipStartSeconds)}–
                    {formatTime(citation.clipEndSeconds)}
                  </span>
                </button>
              ))}
            </div>
          )}
        {timestampedAnswer && !isAnswerStreaming && citations.length > 0 && (
          <EvidenceProvenance
            cues={citations.map((citation) => ({
              text: citation.text.trim().replace(/\s+/g, " "),
              startSeconds: citation.clipStartSeconds,
              endSeconds: citation.clipEndSeconds,
            }))}
            onSeek={seekToTime}
          />
        )}
        {output.abstentionReason && (
          <div className="mt-2.5 max-w-4xl text-[11px] leading-5 text-muted-foreground">
            {output.abstentionReason}
          </div>
        )}
      </section>

      {(phase === "finalizing" ||
        phase === "revealing-media" ||
        phase === "loading-media") && (
        <output className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-[#356b83]" />
          Preparing supporting video…
        </output>
      )}

      {mediaMounted && (
        <article
          className={cn(
            "grid w-full overflow-hidden transition-[grid-template-rows,opacity] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            mediaExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            {hasEvidenceMedia ? (
              <div aria-busy={!realMediaVisible} className="grid">
                <EvidenceWorkspaceSkeleton
                  className={cn(
                    "[grid-area:1/1] transition-opacity duration-500",
                    realMediaVisible
                      ? "pointer-events-none opacity-0"
                      : "opacity-100"
                  )}
                />
                <div
                  aria-hidden={!realMediaVisible}
                  className={cn(
                    "space-y-3 [grid-area:1/1] transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                    realMediaVisible
                      ? "visible translate-y-0 opacity-100"
                      : "invisible pointer-events-none translate-y-2 opacity-0"
                  )}
                  inert={!realMediaVisible}
                >
                  <div
                    className={cn(
                      "grid overflow-hidden rounded-[14px] border border-border/70 bg-background",
                      transcriptOpen
                        ? "lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]"
                        : "grid-cols-1"
                    )}
                  >
                    <div className="min-w-0 lg:border-r lg:border-border/60">
                      <div className="relative overflow-hidden bg-[#111]">
                        {output.clipUrl ? (
                          <video
                            className="aspect-video w-full object-contain"
                            controls
                            onLoadedData={markMediaLoaded}
                            onTimeUpdate={updateActiveCitation}
                            playsInline
                            preload="metadata"
                            ref={videoRef}
                            src={output.clipUrl}
                          >
                            <track kind="captions" />
                          </video>
                        ) : embedSrc ? (
                          <div className="relative aspect-video w-full">
                            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: iframe load completion drives the media cross-fade. */}
                            <iframe
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="absolute inset-0 h-full w-full"
                              onLoad={markMediaLoaded}
                              src={embedSrc}
                              title={
                                matchedProcedure ?? "Medix procedure video"
                              }
                            />
                          </div>
                        ) : null}

                        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-2 py-1 font-medium text-[10px] text-white shadow-sm backdrop-blur-sm">
                          <PlayCircleIcon className="size-3" />
                          Localized evidence clip
                        </div>
                      </div>

                      {citations.length > 0 && (
                        <div className="border-t border-border/60 bg-card px-3 py-3">
                          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <div className="font-medium text-[11px] text-foreground">
                              Evidence moments
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {citations.length > VISIBLE_MOMENTS
                                ? `Showing ${VISIBLE_MOMENTS} of ${citations.length} · full list in the transcript`
                                : "Select a moment to seek"}
                            </div>
                          </div>
                          {/* A wrapping grid, not a horizontally scrolling
                              strip: the old strip hid its scrollbar, squeezed
                              cards below their content width, and clipped both
                              the title and the timestamp. */}
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {citations
                              .slice(0, VISIBLE_MOMENTS)
                              .map((citation) => (
                                <button
                                  className={cn(
                                    "min-w-0 rounded-lg border px-2.5 py-2 text-left transition-colors",
                                    activeCueId === citation.cue_id
                                      ? "border-[#356b83]/45 bg-[#edf5f8] text-[#174a62] shadow-sm dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                                      : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground"
                                  )}
                                  key={citation.cue_id}
                                  onClick={() => selectCitation(citation)}
                                  type="button"
                                >
                                  <div className="mb-1 flex items-baseline justify-between gap-2">
                                    <span className="min-w-0 font-semibold text-[11px] leading-snug">
                                      {evidenceMomentTitle(citation.text)}
                                    </span>
                                    {/* shrink-0 so the timestamp is never the
                                      element that gets clipped. */}
                                    <span
                                      className="shrink-0 whitespace-nowrap font-mono text-[10px] opacity-75"
                                      title={`Source video ${formatTime(citation.start_seconds)}`}
                                    >
                                      {formatTime(
                                        usesClipClock
                                          ? citation.clipStartSeconds
                                          : citation.start_seconds
                                      )}
                                    </span>
                                  </div>
                                  <div className="line-clamp-2 break-words text-[11px] leading-[1.45]">
                                    {citation.text}
                                  </div>
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {transcriptOpen && (
                      <aside className="flex min-h-[280px] flex-col bg-card lg:max-h-[475px]">
                        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3.5">
                          <div className="flex items-center gap-2 font-semibold text-[11px]">
                            <CaptionsIcon className="size-3.5 text-muted-foreground" />
                            Clip transcript
                          </div>
                          <span className="mr-auto ml-2 hidden text-[9px] text-muted-foreground sm:inline">
                            {usesClipClock ? "Clip time" : "Source-video time"}
                          </span>
                          <button
                            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => setTranscriptOpen(false)}
                            type="button"
                          >
                            Hide
                            <ChevronDownIcon className="size-3 rotate-180" />
                          </button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                          {citations.length > 0 ? (
                            <ol className="space-y-1">
                              {citations.map((citation) => (
                                <li key={citation.cue_id}>
                                  <button
                                    className={cn(
                                      "grid w-full grid-cols-[46px_minmax(0,1fr)] gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                                      activeCueId === citation.cue_id
                                        ? "bg-[#edf5f8] text-[#174a62] dark:bg-sky-950/40 dark:text-sky-200"
                                        : "text-foreground/80 hover:bg-muted/65"
                                    )}
                                    onClick={() => selectCitation(citation)}
                                    type="button"
                                  >
                                    <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                                      {activeCueId === citation.cue_id && (
                                        <PlayCircleIcon className="size-3 fill-current" />
                                      )}
                                      {formatTime(
                                        usesClipClock
                                          ? citation.clipStartSeconds
                                          : citation.start_seconds
                                      )}
                                    </span>
                                    <span className="break-words text-[11.5px] leading-[1.6]">
                                      {citation.text}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-[11px] leading-5 text-muted-foreground">
                              This response abstained before transcript claims
                              could be cited. The localized clip remains
                              available for review.
                            </div>
                          )}
                        </div>
                      </aside>
                    )}
                  </div>

                  {!transcriptOpen && (
                    <button
                      className="ml-auto flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-1.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setTranscriptOpen(true)}
                      type="button"
                    >
                      <CaptionsIcon className="size-3" />
                      Show transcript
                      <ChevronDownIcon className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-28 items-center justify-center bg-muted/20 px-6 text-center text-[12px] text-muted-foreground">
                No verified video evidence was returned for this question.
              </div>
            )}
          </div>
        </article>
      )}
    </div>
  );
}

export function ProcedureCardSkeleton({
  searchingAdditionalEvidence = false,
}: {
  searchingAdditionalEvidence?: boolean;
}) {
  return (
    <output
      aria-label="Retrieving medical evidence"
      className="flex items-center gap-2 px-1 py-1 text-[11px] text-muted-foreground"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
      <div>
        <div className="font-medium">
          {searchingAdditionalEvidence
            ? "Searching additional evidence…"
            : "Thinking…"}
        </div>
        <div className="text-[10px]">
          {searchingAdditionalEvidence
            ? "The current source could not answer this follow-up"
            : "Preparing verified evidence"}
        </div>
      </div>
    </output>
  );
}

function EvidenceWorkspaceSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "overflow-hidden rounded-[14px] border border-border/70 bg-background",
        className
      )}
    >
      <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.95fr)]">
        <div className="min-w-0 lg:border-border/60 lg:border-r">
          <div className="aspect-video animate-pulse bg-muted/80" />
          <div className="border-border/60 border-t bg-card px-3 py-3">
            <div className="mb-2.5 h-3 w-28 animate-pulse rounded-full bg-muted" />
            <div className="flex gap-2 overflow-hidden">
              {[0, 1, 2, 3].map((item) => (
                <div
                  className="h-[62px] min-w-[126px] flex-1 animate-pulse rounded-lg border border-border/60 bg-muted/55"
                  key={item}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="hidden min-h-[280px] space-y-4 p-4 lg:block">
          <div className="h-3 w-32 animate-pulse rounded-full bg-muted" />
          {[0, 1, 2, 3, 4].map((item) => (
            <div className="flex gap-3" key={item}>
              <div className="h-3 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="h-3 flex-1 animate-pulse rounded-full bg-muted/80" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  const value = Math.max(0, Math.floor(sec));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function responseStatusLabel(phase: ResponsePhase, abstained: boolean) {
  if (phase === "thinking") {
    return "Thinking…";
  }
  if (phase === "streaming") {
    return "Generating response…";
  }
  if (phase === "finalizing") {
    return "Finalizing response…";
  }
  return abstained
    ? "Response completed with limited evidence"
    : "Response complete";
}

function useResponsePhase({
  hasEvidence,
  hasWrittenAnswer,
  isAnswerStreaming,
}: {
  hasEvidence: boolean;
  hasWrittenAnswer: boolean;
  isAnswerStreaming: boolean;
}) {
  const [phase, setPhase] = useState<ResponsePhase>(() =>
    responsePhaseForWriting(isAnswerStreaming, hasWrittenAnswer, hasEvidence)
  );
  const [mediaLoaded, setMediaLoaded] = useState(false);

  const markMediaLoaded = useCallback(() => setMediaLoaded(true), []);

  useEffect(() => {
    if (isAnswerStreaming || !hasEvidence) {
      setPhase(
        responsePhaseForWriting(
          isAnswerStreaming,
          hasWrittenAnswer,
          hasEvidence
        )
      );
      if (isAnswerStreaming) {
        setMediaLoaded(false);
      }
      return;
    }

    setPhase((current) => {
      if (current === "thinking" || current === "streaming") {
        return "finalizing";
      }
      return current;
    });
  }, [hasEvidence, hasWrittenAnswer, isAnswerStreaming]);

  useEffect(() => {
    if (phase === "finalizing") {
      const timeoutId = window.setTimeout(
        () => setPhase("revealing-media"),
        180
      );
      return () => window.clearTimeout(timeoutId);
    }
    if (phase === "revealing-media") {
      const timeoutId = window.setTimeout(() => setPhase("loading-media"), 60);
      return () => window.clearTimeout(timeoutId);
    }
    if (phase === "loading-media") {
      const timeoutId = window.setTimeout(
        () => setPhase("ready"),
        mediaLoaded ? 360 : 6000
      );
      return () => window.clearTimeout(timeoutId);
    }
  }, [mediaLoaded, phase]);

  return { markMediaLoaded, phase };
}
