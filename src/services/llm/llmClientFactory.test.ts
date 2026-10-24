import { describe, it, expect } from "vitest";
import { createLLMClient, LLMProviderConfig } from "./llmClientFactory";
import { isStreamingClient } from "../../types/llm";
import { BoucioClient } from "./boucioClient";
import { OpenAIClient } from "./openaiClient";
import { CustomClient } from "./customClient";
import { AnthropicClient } from "./anthropicClient";

const base: Omit<LLMProviderConfig, "provider"> = {
  api_endpoint: "http://localhost:11434",
  api_key: null,
  model: "test-model",
  enable_reasoning: false,
};

const cfg = (provider: LLMProviderConfig["provider"]): LLMProviderConfig => ({
  ...base,
  provider,
});

describe("createLLMClient routing", () => {
  it("routes anthropic -> AnthropicClient", () => {
    expect(createLLMClient(cfg("anthropic"))).toBeInstanceOf(AnthropicClient);
  });

  it.each(["openai", "google", "azure"] as const)(
    "routes %s -> OpenAIClient",
    (p) => {
      expect(createLLMClient(cfg(p))).toBeInstanceOf(OpenAIClient);
    },
  );

  it("routes custom -> CustomClient", () => {
    const client = createLLMClient(cfg("custom"));
    expect(client).toBeInstanceOf(CustomClient);
    // CustomClient extends OpenAIClient
    expect(client).toBeInstanceOf(OpenAIClient);
  });

  it.each(["boucio", "ollama"] as const)("routes %s -> BoucioClient", (p) => {
    expect(createLLMClient(cfg(p))).toBeInstanceOf(BoucioClient);
  });

  it("falls back to BoucioClient for an unknown provider", () => {
    expect(
      createLLMClient(cfg("something-else" as LLMProviderConfig["provider"])),
    ).toBeInstanceOf(BoucioClient);
  });
});

describe("every provider branch is streaming-capable", () => {
  // The /v1/chats surface narrows with isStreamingClient() and 503s when a client
  // cannot stream. Every provider the factory can return must therefore implement
  // chatStream, including custom, which inherits it from OpenAIClient.
  it.each([
    "anthropic",
    "openai",
    "google",
    "azure",
    "custom",
    "boucio",
    "ollama",
  ] as const)("%s", (p) => {
    expect(isStreamingClient(createLLMClient(cfg(p)))).toBe(true);
  });

  it("the unknown-provider fallback can stream too", () => {
    const client = createLLMClient(
      cfg("something-else" as LLMProviderConfig["provider"]),
    );
    expect(isStreamingClient(client)).toBe(true);
  });
});
