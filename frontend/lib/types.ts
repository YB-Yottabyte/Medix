import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";

import type { CitedCue } from "./ai/medical-follow-up";
import type { analyzeImage } from "./ai/tools/analyze-image";
import type { searchProcedure } from "./ai/tools/search-procedure";

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type searchProcedureTool = InferUITool<typeof searchProcedure>;
type analyzeImageTool = InferUITool<typeof analyzeImage>;

export type ChatTools = {
  searchProcedure: searchProcedureTool;
  analyzeImage: analyzeImageTool;
};

export type CustomUIDataTypes = {
  appendMessage: string;
  id: string;
  title: string;
  clear: null;
  finish: null;
  "chat-title": string;
  /** Signals that this turn is being answered from the active EvidenceBundle. */
  "follow-up-status": string;
  /** Transcript moments a follow-up answer was built from, for provenance. */
  "follow-up-evidence": {
    evidenceBundleId: string | null;
    cues: CitedCue[];
  };
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
