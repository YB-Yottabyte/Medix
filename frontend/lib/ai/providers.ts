import { groq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";
import { chatModels, QWEN_CHAT_MODEL, titleModel } from "./models";
import { solFetch, solOllamaBaseUrl } from "./sol";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export function ollamaOpenAIBaseUrl(
  baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL
) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: ollamaOpenAIBaseUrl(),
  // Ollama's OpenAI-compatible endpoint requires a value but ignores it.
  apiKey: "ollama",
  includeUsage: true,
});

/**
 * Separate client for the Sol tunnel: different base URL and a bounded fetch so
 * a closed tunnel fails fast instead of hanging. The provider name stays
 * "ollama" so providerOptions (e.g. reasoningEffort) pass through unchanged.
 */
const sol = createOpenAICompatible({
  name: "ollama",
  baseURL: solOllamaBaseUrl(),
  apiKey: "ollama",
  fetch: solFetch,
});

export function languageModelProvider(modelId: string) {
  return (
    chatModels.find((candidate) => candidate.id === modelId)?.provider ?? "groq"
  );
}

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": titleModel,
        },
      });
    })()
  : null;

/**
 * The AI SDK `providerOptions` key for a model.
 *
 * This is the *client* name, which is deliberately not the registry `provider`
 * used for UI grouping: the Sol client is registered as "ollama" because it
 * speaks the Ollama OpenAI-compatible API, even though its registry provider is
 * "sol". Keying options by the registry name silently drops them — which made
 * reasoningEffort "none" never reach Sol, so the thinking model spent its whole
 * budget reasoning and returned empty content.
 */
export function providerOptionsKey(modelId: string) {
  return languageModelProvider(modelId) === "groq" ? "groq" : "ollama";
}

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  const provider = languageModelProvider(modelId);
  if (provider === "sol") {
    return sol(modelId);
  }
  return provider === "ollama" ? ollama(modelId) : groq(modelId);
}

/**
 * Same-topic follow-up assessment, generation, and verification always run on
 * the local Qwen model, independent of the model selected in the interface.
 *
 * Qwen is the only local medical generation model. MedGemma 1.5 4B IT was
 * evaluated as an alternative and not promoted: see
 * docs/research/medgemma_comparison.md.
 */
export function getFollowUpModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("chat-model");
  }
  return ollama(QWEN_CHAT_MODEL);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }
  return groq(titleModel.id);
}
