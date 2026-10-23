export { SOL_CHAT_MODEL } from "./sol";

export const VOYAGER_CHAT_MODEL = process.env.ASU_RC_MODEL ?? "qwen35-27b";
export const DEFAULT_CHAT_MODEL = VOYAGER_CHAT_MODEL;
export const QWEN_CHAT_MODEL =
  process.env.OLLAMA_CHAT_MODEL ?? "qwen3.5:9b-q4_K_M";

/** Titles and query contextualization use the same Voyager text deployment. */
export const titleModel = {
  description: "Voyager model for chat titles and query contextualization",
  id: VOYAGER_CHAT_MODEL,
  name: "Qwen 3.5 27B",
  provider: "voyager",
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  deployment?: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  /** Set by /api/models for remote models whose session may be down. */
  offline?: boolean;
};

export const chatModels: ChatModel[] = [
  {
    deployment: "ASU Research Computing",
    description:
      "Voyager text generation; images use the separate evidence retrieval stage",
    id: VOYAGER_CHAT_MODEL,
    name: "Qwen 3.5 27B",
    provider: "voyager",
  },
];

export function getCapabilities(): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    chatModels.map((model) => [
      model.id,
      { reasoning: true, tools: true, vision: false },
    ])
  );
}

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
