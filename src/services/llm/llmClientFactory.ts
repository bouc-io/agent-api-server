/**
 * LLM Client Factory (agent-api-server)
 *
 * Routes provider config → concrete LLMClient implementation:
 *   anthropic          → AnthropicClient  (/v1/messages, non-streaming)
 *   openai/google/azure→ OpenAIClient     (/chat/completions, non-streaming)
 *   custom             → CustomClient     (OpenAI-compatible, own named class)
 *   boucio/ollama      → BoucioClient     (native /api/chat, cluster OAuth)
 *   default            → BoucioClient     (env-var fallback to internal bouc.io Ollama)
 */

import { LLMClient } from "../../types/llm";
import { BoucioClient } from "./boucioClient";
import { OpenAIClient } from "./openaiClient";
import { CustomClient } from "./customClient";
import { AnthropicClient } from "./anthropicClient";

export interface LLMProviderConfig {
  provider:
    | "openai"
    | "anthropic"
    | "google"
    | "azure"
    | "ollama"
    | "boucio"
    | "custom";
  api_endpoint: string;
  api_key: string | null;
  model: string;
  enable_reasoning: boolean;
}

export function createLLMClient(config: LLMProviderConfig): LLMClient {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicClient(config);
    case "openai":
    case "google":
    case "azure":
      return new OpenAIClient(config);
    case "custom":
      return new CustomClient(config);
    case "boucio":
    case "ollama":
    default:
      return new BoucioClient(config);
  }
}
