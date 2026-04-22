"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import {
  ArrowUpIcon,
  BrainIcon,
  EyeIcon,
  LockIcon,
  MicIcon,
  WrenchIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { PreviewAttachment } from "@/components/chat/input/preview-attachment";
import {
  type SlashCommand,
  SlashCommandMenu,
  slashCommands,
} from "@/components/chat/input/slash-commands";
import { SuggestedActions } from "@/components/chat/input/suggested-actions";
import { PaperclipIcon, StopIcon } from "@/components/chat/shared/icons";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { Button } from "@/components/ui/button";
import {
  type ChatModel,
  chatModels,
  DEFAULT_CHAT_MODEL,
  type ModelCapabilities,
} from "@/lib/ai/models";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn, generateUUID } from "@/lib/utils";

const RegionSelectorDialog = dynamic(
  () =>
    import("@/components/chat/cards/region-selector-dialog").then(
      (module) => module.RegionSelectorDialog
    ),
  { ssr: false }
);

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: needed for client-side cookie setting
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

type RegionPoint = {
  x: number;
  y: number;
};

type MultimodalQueryResponse = {
  status?: "need_user_input" | "success";
  message?: string;
  instruction?: string;
  error?: string;
  success?: boolean;
  response?: string | null;
  video_id?: string | null;
  video_url?: string | null;
  answer_start?: number | null;
  answer_end?: number | null;
  retrieved_procedures?: Array<{
    question?: string | null;
    similarity_score?: number | null;
    video_id?: string | null;
    video_url?: string | null;
    answer_start?: number | null;
    answer_end?: number | null;
    steps?: Array<{
      time?: number;
      start_time?: number;
      end_time?: number | null;
      description: string;
    }>;
  }>;
  visual_analysis?: {
    region_description?: string | null;
    body_part?: string | null;
    condition?: string | null;
    severity?: string | null;
    first_aid_topic?: string | null;
    search_query?: string | null;
    global_query?: string | null;
    region_query?: string | null;
    mask_data?: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    highlighted_image?: string | null;
  } | null;
};

const MIN_MULTIMODAL_VIDEO_MATCH = 0.35;

const GENERIC_QUERY_TERMS = new Set([
  "help",
  "me",
  "please",
  "can",
  "you",
  "what",
  "do",
  "i",
]);

const SKIN_PROCEDURE_TERMS = [
  "skin",
  "precancerous",
  "cancer",
  "melanoma",
  "eczema",
  "rash",
];

function tokenizeForMatch(text: string | null | undefined): string[] {
  return (
    (text ?? "")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter(Boolean) ?? []
  );
}

function hasMeaningfulUserQuery(text: string): boolean {
  const tokens = tokenizeForMatch(text).filter(
    (token) => !GENERIC_QUERY_TERMS.has(token)
  );
  return tokens.length >= 2;
}

function containsAnyTerm(
  text: string | null | undefined,
  terms: string[]
): boolean {
  const haystack = ` ${text?.toLowerCase() ?? ""} `;
  return terms.some(
    (term) => haystack.includes(` ${term} `) || haystack.includes(term)
  );
}

function isTopProcedureObviouslyMismatched(
  matchedProcedure: string | null | undefined,
  submittedInput: string,
  visualAnalysis: MultimodalQueryResponse["visual_analysis"]
): boolean {
  if (!matchedProcedure) {
    return false;
  }

  const procedureText = matchedProcedure.toLowerCase();
  const contextualText = [
    submittedInput,
    visualAnalysis?.search_query,
    visualAnalysis?.global_query,
    visualAnalysis?.region_query,
    visualAnalysis?.body_part,
    visualAnalysis?.condition,
    visualAnalysis?.first_aid_topic,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    containsAnyTerm(procedureText, SKIN_PROCEDURE_TERMS) &&
    !containsAnyTerm(contextualText, SKIN_PROCEDURE_TERMS)
  ) {
    return true;
  }

  return false;
}

function revokeAttachmentUrls(attachments: Attachment[]) {
  for (const attachment of attachments) {
    if (attachment.file && attachment.url.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.url);
    }
    if (attachment.file && attachment.originalUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.originalUrl);
    }
  }
}

function normalizeMultimodalAssistantText(text: string): string {
  if (!text.trim()) {
    return text;
  }

  return text
    .replace(/^\s*\*?\*?(Analysis|Steps|Video)\*?\*?\s*:?\s*$/gim, "")
    .replace(
      /^\s*A verified (MedVidQA|Medix) video is available in the player\.?\s*$/gim,
      ""
    )
    .replace(
      /\bThe image appears to show\b/gi,
      "From what I can see, this looks like"
    )
    .replace(
      /\bBased on the provided information,?\b/gi,
      "Based on what I can see here,"
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function revealAssistantText(
  text: string,
  pendingAssistantId: string,
  setMessages: UseChatHelpers<ChatMessage>["setMessages"]
) {
  const words = text.split(/(\s+)/).filter((part) => part.length > 0);
  if (words.length === 0) {
    return;
  }

  const chunkSize = 1;
  let visibleText = "";

  for (let index = 0; index < words.length; index += chunkSize) {
    visibleText += words.slice(index, index + chunkSize).join("");

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === pendingAssistantId
          ? {
              ...message,
              parts: [
                {
                  type: "text",
                  text: visibleText,
                } as ChatMessage["parts"][number],
                ...message.parts.filter((part) => part.type !== "text"),
              ],
            }
          : message
      )
    );

    await new Promise((resolve) => window.setTimeout(resolve, 18));
  }
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  selectedModelId,
  onModelChange,
  editingMessage,
  onCancelEdit,
  isLoading,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage:
    | UseChatHelpers<ChatMessage>["sendMessage"]
    | (() => Promise<void>);
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  editingMessage?: ChatMessage | null;
  onCancelEdit?: () => void;
  isLoading?: boolean;
}) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const { width } = useWindowSize();
  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
    }
  }, [localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = event.target.value;
    setInput(val);

    if (val.startsWith("/") && !val.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(val.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    setSlashOpen(false);
    setInput("");
    switch (cmd.action) {
      case "new":
        router.push("/");
        break;
      case "clear":
        setMessages(() => []);
        break;
      case "rename":
        toast("Rename is available from the sidebar chat menu.");
        break;
      case "model": {
        const modelBtn = document.querySelector<HTMLButtonElement>(
          "[data-testid='model-selector']"
        );
        modelBtn?.click();
        break;
      }
      case "theme":
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        break;
      case "delete":
        toast("Delete this chat?", {
          action: {
            label: "Delete",
            onClick: () => {
              fetch(
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatId}`,
                { method: "DELETE" }
              );
              router.push("/");
              toast.success("Chat deleted");
            },
          },
        });
        break;
      case "purge":
        toast("Delete all chats?", {
          action: {
            label: "Delete all",
            onClick: () => {
              fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history`, {
                method: "DELETE",
              });
              router.push("/");
              toast.success("All chats deleted");
            },
          },
        });
        break;
      default:
        break;
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [regionSelectorOpen, setRegionSelectorOpen] = useState(false);
  const [activeRegionAttachmentUrl, setActiveRegionAttachmentUrl] = useState<
    string | null
  >(null);
  const [isSubmittingRegionQuery, setIsSubmittingRegionQuery] = useState(false);

  const submitForm = useCallback(() => {
    window.history.pushState(
      {},
      "",
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
    );

    sendMessage({
      role: "user",
      parts: [
        ...attachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        {
          type: "text",
          text: input,
        },
      ],
    });

    setAttachments([]);
    setLocalStorageInput("");
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
  ]);

  const requestRegionSelection = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("image", file, file.name);

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/segment`,
      {
        method: "POST",
        body: formData,
      }
    );

    const data = (await response.json()) as {
      status?: string;
      error?: string;
      message?: string;
    };

    if (!response.ok) {
      throw new Error(data.error ?? "Could not initialize segmentation.");
    }

    if (data.status !== "need_user_input") {
      throw new Error(data.message ?? "Segmentation did not request a region.");
    }

    return data;
  }, []);

  const buildLocalAttachment = useCallback((file: File): Attachment => {
    const objectUrl = URL.createObjectURL(file);
    return {
      url: objectUrl,
      originalUrl: objectUrl,
      name: file.name,
      contentType: file.type,
      file,
      segmentationStatus: file.type.startsWith("image/")
        ? "needs-selection"
        : "idle",
      selectedRegion: null,
    };
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      if (files.length === 0) {
        return;
      }

      setUploadQueue(files.map((file) => file.name));

      try {
        const localAttachments = files.map(buildLocalAttachment);
        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...localAttachments,
        ]);

        const firstImageAttachment = localAttachments.find((attachment) =>
          attachment.contentType.startsWith("image/")
        );

        if (firstImageAttachment?.file) {
          const segmentationState = await requestRegionSelection(
            firstImageAttachment.file
          );
          toast.info(
            segmentationState.message ??
              "Please click on the region you want Medix to analyze."
          );
          setActiveRegionAttachmentUrl(firstImageAttachment.url);
          setRegionSelectorOpen(true);
        }
      } catch (_error) {
        toast.error("Failed to prepare the image for region selection.");
      } finally {
        setUploadQueue([]);
        event.target.value = "";
      }
    },
    [buildLocalAttachment, requestRegionSelection, setAttachments]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/")
      );

      if (imageItems.length === 0) {
        return;
      }

      event.preventDefault();

      setUploadQueue((prev) => [...prev, "Pasted image"]);

      try {
        const files = imageItems
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
        const localAttachments = files.map(buildLocalAttachment);

        setAttachments((curr) => [...curr, ...localAttachments]);

        const firstImageAttachment = localAttachments[0];
        if (firstImageAttachment?.file) {
          const segmentationState = await requestRegionSelection(
            firstImageAttachment.file
          );
          toast.info(
            segmentationState.message ??
              "Please click on the region you want Medix to analyze."
          );
          setActiveRegionAttachmentUrl(firstImageAttachment.url);
          setRegionSelectorOpen(true);
        }
      } catch (_error) {
        toast.error("Failed to upload pasted image(s)");
      } finally {
        setUploadQueue([]);
      }
    },
    [buildLocalAttachment, requestRegionSelection, setAttachments]
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("paste", handlePaste);
    return () => textarea.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      if (recordingStreamRef.current) {
        for (const track of recordingStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      revokeAttachmentUrls(attachmentsRef.current);
    };
  }, []);

  const transcribeAudio = useCallback(
    async (audioBlob: Blob) => {
      setIsTranscribing(true);

      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "speech.webm");

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/transcribe`,
          {
            method: "POST",
            body: formData,
          }
        );

        const data = (await response.json()) as {
          text?: string;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Could not transcribe audio.");
        }

        const transcript = data.text?.trim();
        if (!transcript) {
          toast.error("No speech was detected. Please try again.");
          return;
        }

        setInput((current) =>
          current.trim() ? `${current.trim()} ${transcript}` : transcript
        );

        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not transcribe your recording."
        );
      } finally {
        setIsTranscribing(false);
      }
    },
    [setInput]
  );

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error("Speech-to-text is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined,
      });

      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsRecording(false);

        if (recordingStreamRef.current) {
          for (const track of recordingStreamRef.current.getTracks()) {
            track.stop();
          }
          recordingStreamRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        audioChunksRef.current = [];

        if (audioBlob.size > 0) {
          await transcribeAudio(audioBlob);
        }
      };

      recorder.onerror = () => {
        setIsRecording(false);
        toast.error("Recording failed. Please try again.");
      };

      recorder.start();
      setIsRecording(true);
      toast.success("Listening...");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Microphone access was denied."
      );
    }
  }, [transcribeAudio]);

  const primaryImageAttachment =
    attachments.find((attachment) => attachment.file) ?? null;
  const activeRegionAttachment =
    attachments.find(
      (attachment) => attachment.url === activeRegionAttachmentUrl
    ) ?? primaryImageAttachment;
  const hasPendingRegionSelection = attachments.some(
    (attachment) =>
      attachment.file &&
      attachment.contentType.startsWith("image/") &&
      !attachment.selectedRegion
  );

  const updateAttachmentRegion = useCallback(
    (attachmentUrl: string, point: RegionPoint, previewUrl?: string | null) => {
      setAttachments((currentAttachments) =>
        currentAttachments.map((attachment) => {
          if (attachment.url !== attachmentUrl) {
            return attachment;
          }

          if (
            previewUrl &&
            attachment.url !== previewUrl &&
            attachment.url.startsWith("blob:")
          ) {
            URL.revokeObjectURL(attachment.url);
          }

          return {
            ...attachment,
            url: previewUrl ?? attachment.url,
            selectedRegion: point,
            segmentationStatus: "ready",
          };
        })
      );
    },
    [setAttachments]
  );

  const prepareSegmentedPreview = useCallback(
    async (attachment: Attachment, point: RegionPoint) => {
      if (!attachment.file) {
        return null;
      }

      const formData = new FormData();
      formData.append("image", attachment.file, attachment.name);
      formData.append("x", String(point.x));
      formData.append("y", String(point.y));

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/segment`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = (await response.json()) as {
        status?: "need_user_input" | "success";
        error?: string;
        highlighted_image?: string;
        message?: string;
      };

      if (!response.ok || data.error) {
        throw new Error(
          data.error ?? "Could not generate the selected region preview."
        );
      }

      if (data.status === "need_user_input") {
        throw new Error(
          data.message ?? "Please select the region of interest on the image."
        );
      }

      return data.highlighted_image
        ? `data:image/png;base64,${data.highlighted_image}`
        : null;
    },
    []
  );

  const submitMultimodalImageQuery = useCallback(
    async (attachment: Attachment, point: RegionPoint) => {
      if (!attachment.file) {
        return;
      }

      const submittedFile = attachment.file;
      const submittedInput = input.trim();
      const submittedAttachment = { ...attachment };

      const formData = new FormData();
      formData.append("image", submittedFile, submittedAttachment.name);
      formData.append("x", String(point.x));
      formData.append("y", String(point.y));
      if (submittedInput) {
        formData.append("query", submittedInput);
      }

      const userMessage: ChatMessage = {
        id: generateUUID(),
        role: "user",
        metadata: {
          createdAt: new Date().toISOString(),
        },
        parts: [
          {
            type: "file",
            url: submittedAttachment.url,
            filename: submittedAttachment.name,
            mediaType: submittedAttachment.contentType,
          } as ChatMessage["parts"][number],
          ...(submittedInput
            ? [
                {
                  type: "text",
                  text: submittedInput,
                } as ChatMessage["parts"][number],
              ]
            : []),
        ],
      };

      const pendingAssistantId = generateUUID();

      setMessages((currentMessages) => [
        ...currentMessages,
        userMessage,
        {
          id: pendingAssistantId,
          role: "assistant",
          metadata: {
            createdAt: new Date().toISOString(),
          },
          parts: [
            {
              type: "text",
              text: "Analyzing the selected region and searching Medix procedures…",
            } as ChatMessage["parts"][number],
            {
              type: "tool-searchProcedure",
              toolCallId: `manual-search-pending-${generateUUID()}`,
              state: "input-streaming",
              input: {
                query: submittedInput || "medical image query",
                visualContext: "selected image region",
              },
            } as ChatMessage["parts"][number],
          ],
        },
      ]);

      // Clear the composer immediately after send so the UI behaves like normal chat.
      setLocalStorageInput("");
      setInput("");
      setAttachments([]);
      setRegionSelectorOpen(false);
      setActiveRegionAttachmentUrl(null);

      setIsSubmittingRegionQuery(true);

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/multimodal-query`,
          {
            method: "POST",
            body: formData,
          }
        );

        const data = (await response.json()) as MultimodalQueryResponse;

        if (!response.ok || data.error) {
          throw new Error(data.error ?? "Multimodal analysis failed.");
        }

        if (data.status === "need_user_input") {
          toast.info(
            data.message ?? "Please click on the region you want to analyze."
          );
          setMessages((currentMessages) =>
            currentMessages.filter(
              (message) => message.id !== pendingAssistantId
            )
          );
          setRegionSelectorOpen(true);
          return;
        }

        const topProcedure = data.retrieved_procedures?.[0] ?? null;
        const topSimilarity =
          typeof topProcedure?.similarity_score === "number"
            ? topProcedure.similarity_score
            : null;
        const userQueryHasSignal = hasMeaningfulUserQuery(submittedInput);
        const obviousMismatch = isTopProcedureObviouslyMismatched(
          topProcedure?.question,
          submittedInput,
          data.visual_analysis
        );
        const hasVerifiedProcedureMatch =
          Boolean(
            topProcedure?.question ||
              topProcedure?.video_id ||
              data.video_id ||
              data.video_url
          ) &&
          !obviousMismatch &&
          (topSimilarity === null ||
            topSimilarity >= MIN_MULTIMODAL_VIDEO_MATCH ||
            (topSimilarity >= 0.28 && userQueryHasSignal));
        const normalizedResponse = normalizeMultimodalAssistantText(
          data.response?.trim() ??
            "I analyzed the selected region, but no response text was returned."
        );
        await revealAssistantText(
          normalizedResponse,
          pendingAssistantId,
          setMessages
        );

        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingAssistantId
              ? {
                  ...message,
                  parts: hasVerifiedProcedureMatch
                    ? [
                        {
                          type: "text",
                          text: normalizedResponse,
                        } as ChatMessage["parts"][number],
                        {
                          type: "tool-searchProcedure",
                          toolCallId: `manual-search-${generateUUID()}`,
                          state: "output-available",
                          input: {
                            query:
                              submittedInput ||
                              data.visual_analysis?.region_description ||
                              "medical image query",
                            visualContext:
                              data.visual_analysis?.region_description ??
                              undefined,
                          },
                          output: {
                            videoId:
                              data.video_id ?? topProcedure?.video_id ?? null,
                            videoUrl:
                              data.video_url ?? topProcedure?.video_url ?? null,
                            startTime:
                              data.answer_start ??
                              topProcedure?.answer_start ??
                              null,
                            endTime:
                              data.answer_end ??
                              topProcedure?.answer_end ??
                              null,
                            steps: topProcedure?.steps ?? [],
                            matchedProcedure: topProcedure?.question ?? null,
                            similarity: topProcedure?.similarity_score ?? null,
                            retrievedCount:
                              data.retrieved_procedures?.length ?? 0,
                            unavailable: false,
                          },
                        } as ChatMessage["parts"][number],
                      ]
                    : [
                        {
                          type: "text",
                          text: normalizedResponse,
                        } as ChatMessage["parts"][number],
                      ],
                }
              : message
          )
        );

        const finalAssistantMessage: ChatMessage = {
          id: pendingAssistantId,
          role: "assistant",
          metadata: {
            createdAt: new Date().toISOString(),
          },
          parts: hasVerifiedProcedureMatch
            ? [
                {
                  type: "text",
                  text: normalizedResponse,
                } as ChatMessage["parts"][number],
                {
                  type: "tool-searchProcedure",
                  toolCallId: `manual-search-persisted-${generateUUID()}`,
                  state: "output-available",
                  input: {
                    query:
                      submittedInput ||
                      data.visual_analysis?.region_description ||
                      "medical image query",
                    visualContext:
                      data.visual_analysis?.region_description ?? undefined,
                  },
                  output: {
                    videoId: data.video_id ?? topProcedure?.video_id ?? null,
                    videoUrl: data.video_url ?? topProcedure?.video_url ?? null,
                    startTime:
                      data.answer_start ?? topProcedure?.answer_start ?? null,
                    endTime:
                      data.answer_end ?? topProcedure?.answer_end ?? null,
                    steps: topProcedure?.steps ?? [],
                    matchedProcedure: topProcedure?.question ?? null,
                    similarity: topProcedure?.similarity_score ?? null,
                    retrievedCount: data.retrieved_procedures?.length ?? 0,
                    unavailable: false,
                  },
                } as ChatMessage["parts"][number],
              ]
            : [
                {
                  type: "text",
                  text: normalizedResponse,
                } as ChatMessage["parts"][number],
              ],
        };

        await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/manual-message`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chatId,
              visibility: selectedVisibilityType,
              userMessage,
              assistantMessage: finalAssistantMessage,
            }),
          }
        );

        if (width && width > 768) {
          textareaRef.current?.focus();
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Multimodal analysis failed.";
        toast.error(message);

        setMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            currentMessage.id === pendingAssistantId
              ? {
                  ...currentMessage,
                  parts: [
                    {
                      type: "text",
                      text: `Image analysis failed: ${message}`,
                    } as ChatMessage["parts"][number],
                  ],
                }
              : currentMessage
          )
        );
      } finally {
        setIsSubmittingRegionQuery(false);
      }
    },
    [
      chatId,
      input,
      selectedVisibilityType,
      setAttachments,
      setInput,
      setLocalStorageInput,
      setMessages,
      width,
    ]
  );

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {editingMessage && onCancelEdit && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Editing message</span>
          <button
            className="rounded px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            onMouseDown={(e) => {
              e.preventDefault();
              onCancelEdit();
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}

      {!editingMessage &&
        !isLoading &&
        messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions
            chatId={chatId}
            selectedVisibilityType={selectedVisibilityType}
            sendMessage={sendMessage}
          />
        )}

      <input
        accept="image/png,image/jpeg"
        className="pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <div className="relative">
        {slashOpen && (
          <SlashCommandMenu
            onClose={() => setSlashOpen(false)}
            onSelect={handleSlashSelect}
            query={slashQuery}
            selectedIndex={slashIndex}
          />
        )}
      </div>

      <PromptInput
        className="[&>div]:rounded-2xl [&>div]:border [&>div]:border-border/30 [&>div]:bg-card/70 [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-300 [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]"
        onSubmit={() => {
          if (input.startsWith("/")) {
            const query = input.slice(1).trim();
            const cmd = slashCommands.find((c) => c.name === query);
            if (cmd) {
              handleSlashSelect(cmd);
            }
            return;
          }
          if (!input.trim() && attachments.length === 0) {
            return;
          }
          if (hasPendingRegionSelection) {
            const unresolvedAttachment =
              attachments.find(
                (attachment) =>
                  attachment.file &&
                  attachment.contentType.startsWith("image/") &&
                  !attachment.selectedRegion
              ) ?? null;
            setActiveRegionAttachmentUrl(unresolvedAttachment?.url ?? null);
            setRegionSelectorOpen(true);
            toast.info("Please click on the region you want to analyze first.");
            return;
          }
          if (status === "ready" || status === "error") {
            if (
              primaryImageAttachment?.file &&
              primaryImageAttachment.selectedRegion
            ) {
              submitMultimodalImageQuery(
                primaryImageAttachment,
                primaryImageAttachment.selectedRegion
              ).catch(() => undefined);
            } else {
              submitForm();
            }
          } else {
            toast.error("Please wait for the model to finish its response!");
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex w-full self-start flex-row gap-2 overflow-x-auto px-3 pt-3 no-scrollbar"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onClick={
                  attachment.file && attachment.contentType.startsWith("image/")
                    ? () => {
                        setActiveRegionAttachmentUrl(attachment.url);
                        setRegionSelectorOpen(true);
                      }
                    : undefined
                }
                onRemove={() => {
                  revokeAttachmentUrls([attachment]);
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (activeRegionAttachmentUrl === attachment.url) {
                    setActiveRegionAttachmentUrl(null);
                    setRegionSelectorOpen(false);
                  }
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: "",
                  name: filename,
                  contentType: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <PromptInputTextarea
          className="min-h-24 text-[13px] leading-relaxed px-4 pt-3.5 pb-1.5 placeholder:text-muted-foreground/35"
          data-testid="multimodal-input"
          onChange={handleInput}
          onKeyDown={(e) => {
            if (slashOpen) {
              const filtered = slashCommands.filter((cmd) =>
                cmd.name.startsWith(slashQuery.toLowerCase())
              );
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (filtered[slashIndex]) {
                  handleSlashSelect(filtered[slashIndex]);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashOpen(false);
                return;
              }
            }
            if (e.key === "Escape" && editingMessage && onCancelEdit) {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          placeholder={
            editingMessage
              ? "Edit your message..."
              : hasPendingRegionSelection
                ? "Pick a region in the uploaded image to continue..."
                : "Ask anything..."
          }
          ref={textareaRef}
          value={input}
        />
        {hasPendingRegionSelection && (
          <div className="px-4 pb-1 text-[12px] text-amber-700">
            Please click the uploaded image and choose the exact region you want
            Medix to analyze before sending.
          </div>
        )}
        <PromptInputFooter className="px-3 pb-3">
          <PromptInputTools>
            <AttachmentsButton
              fileInputRef={fileInputRef}
              selectedModelId={selectedModelId}
              status={status}
            />
            <ModelSelectorCompact
              onModelChange={onModelChange}
              selectedModelId={selectedModelId}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <div className="flex items-center gap-2">
              <Button
                className={cn(
                  "h-7 w-7 rounded-xl border border-border/40 p-1 transition-colors",
                  isRecording
                    ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100"
                    : "text-foreground hover:border-border hover:text-foreground",
                  isTranscribing && "cursor-wait opacity-70"
                )}
                data-testid="speech-to-text-button"
                disabled={isTranscribing}
                onClick={(event) => {
                  event.preventDefault();
                  if (isRecording) {
                    stopRecording();
                  } else {
                    startRecording().catch(() => undefined);
                  }
                }}
                title={
                  isRecording
                    ? "Stop recording"
                    : isTranscribing
                      ? "Transcribing..."
                      : "Speak your message"
                }
                variant="ghost"
              >
                {isRecording ? (
                  <StopIcon size={14} style={{ width: 14, height: 14 }} />
                ) : (
                  <MicIcon className="size-3.5" />
                )}
              </Button>

              <PromptInputSubmit
                className={cn(
                  "h-7 w-7 rounded-xl transition-all duration-200",
                  input.trim() || attachments.length > 0
                    ? "bg-foreground text-background hover:opacity-85 active:scale-95"
                    : "bg-muted text-muted-foreground/25 cursor-not-allowed"
                )}
                data-testid="send-button"
                disabled={
                  (!input.trim() && attachments.length === 0) ||
                  uploadQueue.length > 0 ||
                  hasPendingRegionSelection ||
                  isSubmittingRegionQuery
                }
                status={status}
                variant="secondary"
              >
                <ArrowUpIcon className="size-4" />
              </PromptInputSubmit>
            </div>
          )}
        </PromptInputFooter>
      </PromptInput>

      <RegionSelectorDialog
        attachment={activeRegionAttachment ?? null}
        isSubmitting={isSubmittingRegionQuery}
        onConfirm={async (point) => {
          if (!activeRegionAttachment) {
            return;
          }

          setIsSubmittingRegionQuery(true);

          try {
            const previewUrl = await prepareSegmentedPreview(
              activeRegionAttachment,
              point
            );
            updateAttachmentRegion(
              activeRegionAttachment.url,
              point,
              previewUrl
            );
            setRegionSelectorOpen(false);
            setActiveRegionAttachmentUrl(null);
            toast.success(
              "Region selected. Add a question if you want, then press Send."
            );
            textareaRef.current?.focus();
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not prepare the selected region."
            );
          } finally {
            setIsSubmittingRegionQuery(false);
          }
        }}
        onOpenChange={(open) => {
          setRegionSelectorOpen(open);
          if (!open && !isSubmittingRegionQuery) {
            setActiveRegionAttachmentUrl(null);
          }
        }}
        open={regionSelectorOpen}
      />
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (prevProps.editingMessage !== nextProps.editingMessage) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.messages.length !== nextProps.messages.length) {
      return false;
    }

    return true;
  }
);

function PureAttachmentsButton({
  fileInputRef,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
  selectedModelId: string;
}) {
  return (
    <Button
      className={cn(
        "h-7 w-7 rounded-lg border border-border/40 p-1 transition-colors",
        "text-foreground hover:border-border hover:text-foreground"
      )}
      data-testid="attachments-button"
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <PaperclipIcon size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const dynamicModels: ChatModel[] | undefined = modelsData?.models;
  const activeModels = dynamicModels ?? chatModels;

  const selectedModel =
    activeModels.find((m: ChatModel) => m.id === selectedModelId) ??
    activeModels.find((m: ChatModel) => m.id === DEFAULT_CHAT_MODEL) ??
    activeModels[0];
  const [provider] = selectedModel.id.split("/");

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-7 max-w-[200px] justify-between gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          data-testid="model-selector"
          variant="ghost"
        >
          {provider && <ModelSelectorLogo provider={provider} />}
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent>
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          {(() => {
            const curatedIds = new Set(chatModels.map((m) => m.id));
            const allModels = dynamicModels
              ? [
                  ...chatModels,
                  ...dynamicModels.filter((m) => !curatedIds.has(m.id)),
                ]
              : chatModels;

            const grouped: Record<
              string,
              { model: ChatModel; curated: boolean }[]
            > = {};
            for (const model of allModels) {
              const key = curatedIds.has(model.id)
                ? "_available"
                : model.provider;
              if (!grouped[key]) {
                grouped[key] = [];
              }
              grouped[key].push({ model, curated: curatedIds.has(model.id) });
            }

            const sortedKeys = Object.keys(grouped).sort((a, b) => {
              if (a === "_available") {
                return -1;
              }
              if (b === "_available") {
                return 1;
              }
              return a.localeCompare(b);
            });

            const providerNames: Record<string, string> = {
              alibaba: "Alibaba",
              anthropic: "Anthropic",
              "arcee-ai": "Arcee AI",
              bytedance: "ByteDance",
              cohere: "Cohere",
              deepseek: "DeepSeek",
              google: "Google",
              inception: "Inception",
              kwaipilot: "Kwaipilot",
              meituan: "Meituan",
              meta: "Meta",
              minimax: "MiniMax",
              mistral: "Mistral",
              moonshotai: "Moonshot",
              morph: "Morph",
              nvidia: "Nvidia",
              openai: "OpenAI",
              perplexity: "Perplexity",
              "prime-intellect": "Prime Intellect",
              xiaomi: "Xiaomi",
              xai: "xAI",
              zai: "Zai",
            };

            return sortedKeys.map((key) => (
              <ModelSelectorGroup
                heading={
                  key === "_available"
                    ? "Available"
                    : (providerNames[key] ?? key)
                }
                key={key}
              >
                {grouped[key].map(({ model, curated }) => {
                  const logoProvider = model.id.split("/")[0];
                  return (
                    <ModelSelectorItem
                      className={cn(
                        "flex w-full",
                        model.id === selectedModel.id &&
                          "border-b border-dashed border-foreground/50",
                        !curated && "opacity-40 cursor-default"
                      )}
                      key={model.id}
                      onSelect={() => {
                        if (!curated) {
                          return;
                        }
                        onModelChange?.(model.id);
                        setCookie("chat-model", model.id);
                        setOpen(false);
                        setTimeout(() => {
                          document
                            .querySelector<HTMLTextAreaElement>(
                              "[data-testid='multimodal-input']"
                            )
                            ?.focus();
                        }, 50);
                      }}
                      value={model.id}
                    >
                      <ModelSelectorLogo provider={logoProvider} />
                      <ModelSelectorName>{model.name}</ModelSelectorName>
                      <div className="ml-auto flex items-center gap-2 text-foreground/70">
                        {capabilities?.[model.id]?.tools && (
                          <WrenchIcon className="size-3.5" />
                        )}
                        {capabilities?.[model.id]?.vision && (
                          <EyeIcon className="size-3.5" />
                        )}
                        {capabilities?.[model.id]?.reasoning && (
                          <BrainIcon className="size-3.5" />
                        )}
                        {!curated && (
                          <LockIcon className="size-3 text-muted-foreground/50" />
                        )}
                      </div>
                    </ModelSelectorItem>
                  );
                })}
              </ModelSelectorGroup>
            ));
          })()}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="h-7 w-7 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
