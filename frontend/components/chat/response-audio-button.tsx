"use client";

import { useEffect, useRef, useState } from "react";
import { PlayIcon, StopIcon } from "@/components/chat/shared/icons";
import { toast } from "@/components/chat/shared/toast";

export function ResponseAudioButton({ text }: { text: string }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRequestedRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);
  const usingBrowserSpeechRef = useRef(false);

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      if (
        typeof window !== "undefined" &&
        "speechSynthesis" in window &&
        usingBrowserSpeechRef.current
      ) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, []);

  const waitForVoices = async () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return [];
    }

    const synth = window.speechSynthesis;
    const existingVoices = synth.getVoices();

    if (existingVoices.length > 0) {
      return existingVoices;
    }

    return await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        synth.onvoiceschanged = null;
        resolve(synth.getVoices());
      }, 1200);

      synth.onvoiceschanged = () => {
        window.clearTimeout(timeoutId);
        synth.onvoiceschanged = null;
        resolve(synth.getVoices());
      };
    });
  };

  const splitIntoChunks = (input: string) => {
    const normalized = input.replace(/\s+/g, " ").trim();
    const sentences =
      normalized.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()) ??
      [];
    const chunks: string[] = [];
    let current = "";

    const pushChunk = (chunk: string) => {
      if (chunk.trim()) {
        chunks.push(chunk.trim());
      }
    };

    for (const sentence of sentences.length > 0 ? sentences : [normalized]) {
      if (sentence.length > 200) {
        const words = sentence.split(" ");
        let wordChunk = "";

        for (const word of words) {
          const candidate = wordChunk ? `${wordChunk} ${word}` : word;
          if (candidate.length <= 200) {
            wordChunk = candidate;
          } else {
            pushChunk(wordChunk);
            wordChunk = word;
          }
        }

        pushChunk(wordChunk);
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= 200) {
        current = candidate;
      } else {
        pushChunk(current);
        current = sentence;
      }
    }

    pushChunk(current);
    return chunks;
  };

  const stopPlayback = () => {
    stopRequestedRef.current = true;
    setIsLoading(false);
    setIsSpeaking(false);
    usingBrowserSpeechRef.current = false;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const playChunk = async (chunk: string) => {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunk }),
      }
    );

    if (!response.ok) {
      let message = "Could not generate audio response.";

      try {
        const error = (await response.json()) as {
          error?: string;
          cause?: string;
        };
        message = error.error ?? error.cause ?? message;
      } catch {
        /* fall back to generic error */
      }

      throw new Error(message);
    }

    const audioBlob = await response.blob();
    const objectUrl = URL.createObjectURL(audioBlob);
    objectUrlsRef.current.push(objectUrl);

    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(objectUrl);
      audioRef.current = audio;

      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Audio playback failed."));
      audio.play().catch(() => reject(new Error("Audio playback failed.")));
    });
  };

  const speakWithBrowser = async (chunks: string[]) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      throw new Error("Text-to-speech is not supported in this browser.");
    }

    const synth = window.speechSynthesis;
    synth.cancel();
    usingBrowserSpeechRef.current = true;
    const voices = await waitForVoices();
    const preferredVoice =
      voices.find((voice) => /en(-|_)?us/i.test(voice.lang)) ??
      voices.find((voice) => /en/i.test(voice.lang)) ??
      voices[0];

    for (const chunk of chunks) {
      if (stopRequestedRef.current) {
        break;
      }

      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        if (preferredVoice) {
          utterance.voice = preferredVoice;
          utterance.lang = preferredVoice.lang;
        }

        let started = false;
        const timeoutId = window.setTimeout(() => {
          if (!started) {
            synth.cancel();
            reject(new Error("Browser speech could not start playback."));
          }
        }, 1500);

        utterance.onstart = () => {
          started = true;
          window.clearTimeout(timeoutId);
        };
        utterance.onend = () => {
          window.clearTimeout(timeoutId);
          resolve();
        };
        utterance.onerror = () => {
          window.clearTimeout(timeoutId);
          reject(new Error("Browser speech playback failed."));
        };
        synth.speak(utterance);
        synth.resume();
      });
    }
  };

  const handleToggleSpeech = async () => {
    if (!text.trim()) {
      toast({
        type: "error",
        description: "There is no response text to read aloud.",
      });
      return;
    }

    if (isSpeaking || isLoading) {
      stopPlayback();
      return;
    }

    const chunks = splitIntoChunks(text);
    stopRequestedRef.current = false;
    setIsLoading(true);
    usingBrowserSpeechRef.current = false;

    try {
      setIsSpeaking(true);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          await speakWithBrowser(chunks);
        } catch (browserError) {
          try {
            usingBrowserSpeechRef.current = false;
            for (const chunk of chunks) {
              if (stopRequestedRef.current) {
                break;
              }
              await playChunk(chunk);
            }
          } catch {
            throw browserError;
          }
        }
      } else {
        for (const chunk of chunks) {
          if (stopRequestedRef.current) {
            break;
          }
          await playChunk(chunk);
        }
      }
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error
            ? error.message
            : "Could not play the audio response.",
      });
    } finally {
      setIsLoading(false);
      setIsSpeaking(false);
      audioRef.current = null;
      usingBrowserSpeechRef.current = false;
    }
  };

  return (
    <button
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
      onClick={handleToggleSpeech}
      type="button"
    >
      {isSpeaking || isLoading ? (
        <StopIcon size={12} />
      ) : (
        <PlayIcon size={12} />
      )}
      <span>{isSpeaking || isLoading ? "Stop audio" : "Listen"}</span>
    </button>
  );
}
