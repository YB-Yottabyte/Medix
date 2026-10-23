import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";
import { chatModels, titleModel, VOYAGER_CHAT_MODEL } from "./models";
import { solFetch, solOllamaBaseUrl } from "./sol";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export function ollamaOpenAIBaseUrl(
  baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL
) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

const ollama = createOpenAICompatible({
  // Ollama's OpenAI-compatible endpoint requires a value but ignores it.
  apiKey: "ollama",
  baseURL: ollamaOpenAIBaseUrl(),
  includeUsage: true,
  name: "ollama",
});

/**
 * Separate client for the Sol tunnel: different base URL and a bounded fetch so
 * a closed tunnel fails fast instead of hanging. The provider name stays
 * "ollama" so providerOptions (e.g. reasoningEffort) pass through unchanged.
 */
const sol = createOpenAICompatible({
  apiKey: "ollama",
  baseURL: solOllamaBaseUrl(),
  fetch: solFetch,
  name: "ollama",
});

const voyager = createOpenAICompatible({
  apiKey: process.env.ASU_RC_API_KEY,
  baseURL: "https://openai.rc.asu.edu/v1",
  fetch: solFetch,
  name: "voyager",
  transformRequestBody: (body) => ({
    ...body,
    chat_template_kwargs: { enable_thinking: false },
  }),
});

export function languageModelProvider(modelId: string) {
  return (
    chatModels.find((candidate) => candidate.id === modelId)?.provider ??
    "voyager"
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
  const provider = languageModelProvider(modelId);
  return provider === "voyager" ? "voyager" : "ollama";
}

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  const provider = languageModelProvider(modelId);
  if (provider === "voyager") {
    if (!process.env.ASU_RC_API_KEY?.trim()) {
      throw new Error("ASU_RC_API_KEY is required for Voyager text generation");
    }
    return voyager(modelId);
  }
  if (provider === "sol") {
    return sol(modelId);
  }
  if (provider === "ollama") {
    return ollama(modelId);
  }
  throw new Error(`Unsupported language model provider: ${provider}`);
}

/** Follow-up assessment, generation, and verification use the Voyager text model. */
export function getFollowUpModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("chat-model");
  }
  return getLanguageModel(VOYAGER_CHAT_MODEL);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }
  return getLanguageModel(titleModel.id);
}
