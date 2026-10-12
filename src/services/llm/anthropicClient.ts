/**
 * AnthropicClient — Anthropic /v1/messages non-streaming client for agent-api-server.
 *
 * Key differences from OpenAI:
 *  - System messages extracted to top-level `system` field.
 *  - Tool definitions: `parameters` → `input_schema`.
 *  - Tool calls in response: `content[].type === 'tool_use'` → LLMToolCall.
 *  - Authorization: `x-api-key` header.
 *  - Thinking: `thinking: { type: 'enabled', budget_tokens: N }`.
 *  - Thinking blocks in response are skipped; only text blocks contribute to content.
 *  - Token usage: `input_tokens` / `output_tokens`.
 */

import axios, { AxiosInstance } from "axios";
import https from "https";
import {
  LLMClient,
  LLMMessage,
  LLMChatOptions,
  LLMResponse,
  LLMToolCall,
} from "../../types/llm";
import type { LLMProviderConfig } from "./llmClientFactory";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("anthropic-client");

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";
const DEFAULT_THINKING_BUDGET = 8000;

export class AnthropicClient implements LLMClient {
  private config: LLMProviderConfig;
  private axiosInstance: AxiosInstance;

  constructor(config: LLMProviderConfig) {
    this.config = config;
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
    const baseUrl = this.config.api_endpoint.replace(/\/$/, "");
    const apiKey = this.config.api_key ?? "";

    // Extract system messages to top-level system field
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");
    const systemContent =
      systemMessages.map((m) => m.content).join("\n\n") || undefined;

    // Map messages to Anthropic format (tool_calls → tool_use content blocks)
    const anthropicMessages = chatMessages.map((m) => {
      if (m.role === "tool") {
        // Tool results in Anthropic format
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        };
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        // Assistant tool call messages
        return {
          role: "assistant",
          content: m.tool_calls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    // Map tool definitions: parameters → input_schema
    const anthropicTools = options?.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: anthropicMessages,
      max_tokens: options?.max_tokens ?? 8096,
      stream: false,
    };

    if (systemContent) {
      body.system = [
        {
          type: "text",
          text: systemContent,
          cache_control: { type: "ephemeral" },
        },
      ];
    }
    if (anthropicTools && anthropicTools.length > 0) {
      body.tools = anthropicTools.map((t, i) =>
        i === anthropicTools.length - 1
          ? { ...t, cache_control: { type: "ephemeral" } }
          : t,
      );
      body.tool_choice = { type: "auto" };
    }
    if (options?.think && this.config.enable_reasoning) {
      body.thinking = {
        type: "enabled",
        budget_tokens: DEFAULT_THINKING_BUDGET,
      };
    }

    log.debug(
      { model: this.config.model, messageCount: chatMessages.length },
      "AnthropicClient: sending chat",
    );

    let response;
    try {
      response = await this.axiosInstance.post(`${baseUrl}/v1/messages`, body, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
      });
    } catch (err: any) {
      const responseBody = err?.response?.data;
      const providerMessage =
        responseBody?.error?.message ||
        responseBody?.message ||
        (typeof responseBody === "string" ? responseBody : null) ||
        null;
      log.error(
        {
          model: this.config.model,
          status: err?.response?.status,
          providerError: responseBody,
          providerMessage,
        },
        "AnthropicClient: request failed",
      );
      throw err;
    }

    const data = response.data;

    // Parse content blocks — skip thinking blocks, collect text and tool_use
    let textContent = "";
    const toolCalls: LLMToolCall[] = [];

    for (const block of data.content ?? []) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id || crypto.randomUUID(),
          name: block.name,
          arguments: typeof block.input === "object" ? block.input : {},
        });
      }
      // thinking blocks are intentionally skipped
    }

    const stopReason = data.stop_reason;
    return {
      content: textContent || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: (stopReason === "tool_use"
        ? "tool_calls"
        : "stop") as LLMResponse["finish_reason"],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
      },
    };
  }
}
