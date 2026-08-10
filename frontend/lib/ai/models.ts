import { SOL_CHAT_MODEL } from "./sol";

export const DEFAULT_CHAT_MODEL = "openai/gpt-oss-20b";
export const QWEN_CHAT_MODEL =
  process.env.OLLAMA_CHAT_MODEL ?? "qwen3.5:9b-q4_K_M";

/**
 * Temporary Sol-backed evaluation model. Selectable so it can be compared
 * against local Qwen, but not a default: DEFAULT_CHAT_MODEL and the follow-up
 * pipeline are unchanged. See docs/research/ for the comparison protocol.
 */
export { SOL_CHAT_MODEL };

export const titleModel = {
  id: "openai/gpt-oss-20b",
  name: "GPT-OSS 20B",
  provider: "groq",
  description: "Fast Groq model for chat titles",
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
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    provider: "groq",
    description: "Used for user-facing response generation",
    reasoningEffort: "low",
  },
  {
    id: QWEN_CHAT_MODEL,
    name: "Qwen 3.5 9B",
    provider: "ollama",
    deployment: "Local model",
    description:
      "Can generate the user-facing response using the same grounded evidence pipeline",
    reasoningEffort: "none",
  },
  {
    id: SOL_CHAT_MODEL,
    name: "Qwen 3.6 27B",
    provider: "sol",
    deployment: "Sol supercomputer",
    description:
      "Under evaluation on the Sol GPU cluster; requires an active Sol session",
    reasoningEffort: "none",
  },
];

export function getCapabilities(): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    chatModels.map((model) => [
      model.id,
      { tools: true, vision: false, reasoning: true },
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
