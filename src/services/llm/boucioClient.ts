/**
 * BoucioClient — Internal bouc.io Ollama client for agent use (non-streaming).
 *
 * Mirrors the existing OllamaClient but accepts an optional LLMProviderConfig
 * so it can be used for both the env-var fallback and explicit boucio provider records.
 *
 * Auth:
 *  - If config.api_key is set: use it as Bearer (rare for internal Ollama)
 *  - Otherwise: use tokenManager.getAccessToken() (cluster OAuth for internal Ollama)
 *
 * Env-var fallback (config = null): reads OLLAMA_URL + OLLAMA_MODEL,
 * which matches the pre-GAP-6 behaviour of OllamaClient.
 */

import axios, { AxiosInstance, AxiosError } from "axios";
import https from "https";
import { tokenManager } from "../../lib/tokenManager";
import { createComponentLogger } from "../../lib/logger";
import {
  LLMClient,
  LLMMessage,
  LLMChatOptions,
  LLMResponse,
  LLMToolCall,
} from "../../types/llm";
import { LLMError } from "../../types/errors";
import { CircuitBreaker } from "../../lib/circuitBreaker";
import type { LLMProviderConfig } from "./llmClientFactory";

const log = createComponentLogger("boucio-client");

/**
 * Shared circuit breaker for the internal Ollama backend. Opens after repeated
 * failures so a dead Ollama is not hammered by every run + BullMQ retry; trips
 * back to half-open after the cooldown. Tunable via env.
 */
const llmBreaker = new CircuitBreaker("boucio-ollama", {
  failureThreshold: parseInt(process.env.LLM_BREAKER_THRESHOLD || "5", 10),
  cooldownMs: parseInt(process.env.LLM_BREAKER_COOLDOWN_MS || "30000", 10),
});

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:2b";
const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BASE_DELAY_MS = 1000;

// Ollama sampling parameters (env-configurable for small models)
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || "4096");
const OLLAMA_REPEAT_PENALTY = parseFloat(
  process.env.OLLAMA_REPEAT_PENALTY || "1.15",
);
const OLLAMA_TOP_K = parseInt(process.env.OLLAMA_TOP_K || "25");
const OLLAMA_TOP_P = parseFloat(process.env.OLLAMA_TOP_P || "0.85");
// Keep the model resident between calls so the prompt prefix / weights stay warm
// (reduces cold-load latency on repeated runs). Ollama-native equivalent of caching.
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "10m";

interface OllamaApiResponse {
  message?: {
    content?: string;
    tool_calls?: Array<{
      id?: string;
      function?: { name: string; arguments: unknown };
    }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

function stripThinkingTags(content: string | undefined): string | undefined {
  if (!content) return content;
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return stripped || undefined;
}

export class BoucioClient implements LLMClient {
  private baseUrl: string;
  private model: string;
  /** Explicit API key from provider config (null = use tokenManager cluster OAuth) */
  private apiKey: string | null;
  private axiosInstance: AxiosInstance;

  constructor(config?: LLMProviderConfig | null) {
    this.baseUrl = config?.api_endpoint || DEFAULT_OLLAMA_URL;
    this.model = config?.model || DEFAULT_OLLAMA_MODEL;
    this.apiKey = config?.api_key ?? null;

    this.axiosInstance = axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS,
      }),
    });
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    // The breaker fails fast when Ollama has been repeatedly unreachable,
    // avoiding a retry storm against a dead backend.
    return llmBreaker.execute(() => this.chatWithRetries(messages, options));
  }

  private async chatWithRetries(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        return await this.doChat(messages, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!this.isRetryable(error) || attempt === LLM_MAX_RETRIES) break;
        const delayMs = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        log.warn({ attempt, delay: delayMs }, "LLM request failed, retrying");
        await this.delay(delayMs);
      }
    }
    throw new LLMError(lastError?.message || "Unknown LLM error");
  }

  private async doChat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    // Prefer explicit api_key; fall back to cluster OAuth via tokenManager
    const token = this.apiKey ?? (await tokenManager.getAccessToken());
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    log.debug(
      { model: this.model, messageCount: messages.length },
      "BoucioClient: sending chat",
    );

    const response = await this.axiosInstance.post<OllamaApiResponse>(
      `${this.baseUrl}/api/chat`,
      {
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
          ...(m.tool_calls &&
            m.tool_calls.length > 0 && {
              tool_calls: m.tool_calls.map((tc) => ({
                id: tc.id,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }),
        })),
        tools: options?.tools,
        think: options?.think,
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.max_tokens ?? 2048,
          num_ctx: OLLAMA_NUM_CTX,
          repeat_penalty: OLLAMA_REPEAT_PENALTY,
          top_k: OLLAMA_TOP_K,
          top_p: OLLAMA_TOP_P,
        },
        stream: false,
      },
      { headers },
    );

    const data = response.data;
    const toolCalls: LLMToolCall[] | undefined = data.message?.tool_calls?.map(
      (tc) => ({
        id: tc.id || crypto.randomUUID(),
        name: tc.function?.name || "",
        arguments: this.parseArgs(tc.function?.arguments),
      }),
    );

    return {
      content: stripThinkingTags(data.message?.content),
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
      },
    };
  }

  private isRetryable(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const e = error as AxiosError;
      if (!e.response) return true;
      return e.response.status >= 500 && e.response.status < 600;
    }
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseArgs(args?: unknown): Record<string, unknown> {
    if (!args) return {};
    if (typeof args === "object" && args !== null)
      return args as Record<string, unknown>;
    if (typeof args === "string") {
      try {
        return JSON.parse(args);
      } catch {
        return {};
      }
    }
    return {};
  }
}
