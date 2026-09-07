/**
 * CustomClient — OpenAI-compatible client for self-hosted / custom endpoints.
 *
 * Covers: vLLM, LM Studio, llama.cpp server, and any OpenAI-compatible endpoint
 * registered with provider = 'custom'. Own named class for clarity and extensibility.
 */

import { OpenAIClient } from "./openaiClient";

export class CustomClient extends OpenAIClient {
  // Inherits all OpenAIClient behaviour.
  // Override methods here if custom endpoints diverge from the OpenAI API format.
}
