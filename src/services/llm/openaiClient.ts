/**
 * OpenAIClient — OpenAI-compatible non-streaming client for agent-api-server.
 *
 * Covers: openai, google (Gemini via OpenAI-compat API), azure.
 * Handles tool calls in OpenAI format (function calling with JSON-string arguments).
 */

import axios, { AxiosInstance } from "axios";
import https from "https";
import {
  LLMClient,
  LLMMessage,
  LLMChatOptions,
  LLMResponse,
  LLMToolCall,
  LLMToolDefinition,
  LLMStreamCallbacks,
} from "../../types/llm";
import type { LLMProviderConfig } from "./llmClientFactory";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("openai-client");

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export class OpenAIClient implements LLMClient {
  protected config: LLMProviderConfig;
  protected axiosInstance: AxiosInstance;

  constructor(config: LLMProviderConfig) {
    this.config = config;
    this.axiosInstance = axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS,
      }),
    });
  }

  /**
   * OpenAI-compatible SSE streaming, for the /v1/chats surface.
   * Carried over from chatbot-api-server; uses this class's shared axios instance
   * so the self-signed-cert agent applies, and keeps stream_options.include_usage
   * so the final chunk carries token counts.
   */
  async chatStream(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
    options?: LLMChatOptions,
  ): Promise<void> {
    const baseUrl = this.config.api_endpoint.replace(/\/$/, "");
    const apiKey = this.config.api_key ?? "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    // Azure authenticates with api-key rather than Authorization
    if (this.config.provider === "azure") {
      headers["api-key"] = apiKey;
      delete headers["Authorization"];
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
    };
    // o-series models take reasoning_effort rather than a think flag
    if (options?.think && /^o[13]/.test(this.config.model)) {
      body.reasoning_effort = "high";
    }
    if (options?.max_tokens) body.max_tokens = options.max_tokens;
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    log.debug(
      { model: this.config.model, baseUrl, provider: this.config.provider },
      "OpenAIClient: starting stream",
    );

    const response = await this.axiosInstance.post(
      `${baseUrl}/chat/completions`,
      body,
      { headers, responseType: "stream" },
    );

    let thinkingContent = "";
    let sseBuffer = "";
    let promptTokens = 0;
    let completionTokens = 0;

    const stream = response.data as NodeJS.ReadableStream;

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        sseBuffer += chunk.toString();
        const lines = sseBuffer.split("\n");
        // Carry the trailing fragment; it may be half a data: line.
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          let data: {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            choices?: Array<{
              delta?: { content?: string; reasoning_content?: string };
            }>;
          };
          try {
            data = JSON.parse(trimmed.slice(6));
          } catch {
            continue;
          }

          // Usage arrives in the final chunk via stream_options.include_usage
          if (data.usage) {
            promptTokens = data.usage.prompt_tokens ?? 0;
            completionTokens = data.usage.completion_tokens ?? 0;
          }

          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;

          // reasoning_content: DeepSeek and some OpenAI-compatible providers
          if (delta.reasoning_content) {
            thinkingContent += delta.reasoning_content;
            callbacks.onThinkingToken?.(delta.reasoning_content);
          }
          if (delta.content) callbacks.onToken(delta.content);
        }
      });

      stream.on("end", resolve);
      stream.on("error", reject);
    });

    callbacks.onDone?.({
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      thinking: thinkingContent || undefined,
    });
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    const baseUrl = this.config.api_endpoint.replace(/\/$/, "");
    const apiKey = this.config.api_key ?? "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (this.config.provider === "azure") {
      headers["api-key"] = apiKey;
      delete headers["Authorization"];
    }

    const openAiMessages: OpenAIMessage[] = messages.map((m) => {
      const msg: OpenAIMessage = { role: m.role, content: m.content };
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
        msg.content = null;
      }
      return msg;
    });

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: openAiMessages,
      stream: false,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools; // LLMToolDefinition already matches OpenAI format
      body.tool_choice = "auto";
    }
    if (options?.temperature !== undefined)
      body.temperature = options.temperature;
    if (options?.max_tokens !== undefined) body.max_tokens = options.max_tokens;

    log.debug(
      {
        model: this.config.model,
        provider: this.config.provider,
        messageCount: messages.length,
      },
      "OpenAIClient: sending chat",
    );

    const response = await this.axiosInstance.post(
      `${baseUrl}/chat/completions`,
      body,
      { headers },
    );

    const choice = response.data.choices?.[0];
    const message = choice?.message;
    const usage = response.data.usage;

    const toolCalls: LLMToolCall[] | undefined = message?.tool_calls?.map(
      (tc: any) => ({
        id: tc.id || crypto.randomUUID(),
        name: tc.function?.name || "",
        arguments: this.parseArgs(tc.function?.arguments),
      }),
    );

    const finishReason = choice?.finish_reason;
    return {
      content: message?.content ?? undefined,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: (finishReason === "tool_calls"
        ? "tool_calls"
        : "stop") as LLMResponse["finish_reason"],
      usage: {
        prompt_tokens: usage?.prompt_tokens ?? 0,
        completion_tokens: usage?.completion_tokens ?? 0,
      },
    };
  }

  protected parseArgs(args?: unknown): Record<string, unknown> {
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
