import axios, { AxiosInstance, AxiosError } from "axios";
import https from "https";
import { tokenManager } from "../../lib/tokenManager";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("ollama-client");
import {
  LLMClient,
  LLMMessage,
  LLMChatOptions,
  LLMResponse,
  LLMToolCall,
} from "../../types/llm";
import { LLMError } from "../../types/errors";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:2b";
const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BASE_DELAY_MS = 1000;

// Ollama sampling parameters tuned for small models (1-3B)
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || "4096");
const OLLAMA_REPEAT_PENALTY = parseFloat(
  process.env.OLLAMA_REPEAT_PENALTY || "1.15",
);
const OLLAMA_TOP_K = parseInt(process.env.OLLAMA_TOP_K || "25");
const OLLAMA_TOP_P = parseFloat(process.env.OLLAMA_TOP_P || "0.85");

/**
 * Ollama API response structure
 */
interface OllamaResponse {
  message?: {
    content?: string;
    tool_calls?: Array<{
      id?: string;
      function?: {
        name: string;
        arguments: unknown;
      };
    }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Strip <think>...</think> blocks emitted by reasoning/thinking models (e.g. qwen3.x).
 * Ollama may include these in the content field; stripping them avoids empty-after-strip
 * content being treated as a real response.
 */
function stripThinkingTags(content: string | undefined): string | undefined {
  if (!content) return content;
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return stripped || undefined;
}

/**
 * Ollama LLM Client implementation
 */
export class OllamaClient implements LLMClient {
  private baseUrl: string;
  private model: string;
  private axiosInstance: AxiosInstance;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = baseUrl || OLLAMA_URL;
    this.model = model || OLLAMA_MODEL;

    // Configure axios with HTTPS agent for self-signed certificates
    this.axiosInstance = axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS,
      }),
    });
  }

  /**
   * Send a chat request to Ollama with retry logic
   */
  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        return await this.doChat(messages, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (!this.isRetryable(error) || attempt === LLM_MAX_RETRIES) {
          break;
        }

        // Exponential backoff
        const delayMs = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        log.warn(
          { attempt, maxRetries: LLM_MAX_RETRIES, delay: delayMs },
          "LLM request failed, retrying",
        );
        await this.delay(delayMs);
      }
    }

    throw new LLMError(lastError?.message || "Unknown LLM error");
  }

  /**
   * Internal chat implementation
   */
  private async doChat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    // Get fresh access token (will auto-refresh if needed)
    const accessToken = await tokenManager.getAccessToken();

    // Build headers with authorization if token available
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    log.debug(
      {
        model: this.model,
        messageCount: messages.length,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
          ...(m.tool_calls &&
            m.tool_calls.length > 0 && { tool_calls: m.tool_calls }),
        })),
        toolCount: options?.tools?.length ?? 0,
        toolNames: options?.tools?.map((t) => t.function.name) ?? [],
      },
      "LLM request: sending chat",
    );

    const response = await this.axiosInstance.post<OllamaResponse>(
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
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              })),
            }),
        })),
        tools: options?.tools,
        think: options?.think,
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

    // Parse tool calls if present
    const toolCalls: LLMToolCall[] | undefined = data.message?.tool_calls?.map(
      (tc) => ({
        id: tc.id || crypto.randomUUID(),
        name: tc.function?.name || "",
        arguments: this.parseArguments(tc.function?.arguments),
      }),
    );

    const llmResponse: LLMResponse = {
      content: stripThinkingTags(data.message?.content),
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: toolCalls && toolCalls.length > 0 ? "tool_calls" : "stop",
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
      },
    };

    const contentPreview = llmResponse.content
      ? llmResponse.content.slice(0, 500) +
        (llmResponse.content.length > 500 ? "... [truncated]" : "")
      : null;
    log.debug(
      {
        contentPreview,
        toolCalls: llmResponse.tool_calls?.map((tc) => ({
          name: tc.name,
          arguments: tc.arguments,
        })),
        finishReason: llmResponse.finish_reason,
        usage: llmResponse.usage,
      },
      "LLM response: received",
    );

    return llmResponse;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryable(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      // Retry on network errors or 5xx status codes
      if (!axiosError.response) return true; // Network error
      const status = axiosError.response.status;
      return status >= 500 && status < 600;
    }
    return false;
  }

  /**
   * Delay helper for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse tool call arguments from string to object
   */
  private parseArguments(args?: unknown): Record<string, unknown> {
    if (!args) return {};
    // Ollama returns arguments as a JSON object, not a string
    if (typeof args === "object" && args !== null) {
      return args as Record<string, unknown>;
    }
    // Fallback: try parsing if it arrives as a string (e.g. OpenAI-compatible endpoints)
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

/**
 * Default Ollama client instance
 */
export const llmClient = new OllamaClient();
