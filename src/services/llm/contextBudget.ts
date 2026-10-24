/**
 * Model-aware context budget management.
 *
 * Replaces the flat MAX_HISTORY_MESSAGES truncation with token-budget-driven
 * windowing: estimate the token cost of the assembled messages and trim the
 * oldest non-system turns until they fit within the model's context window
 * (minus a reserve for the model's own output).
 *
 * Estimation is intentionally a cheap heuristic (~4 chars/token + per-message
 * overhead) — it does not call a tokenizer. It is used only for gating/truncation
 * decisions, where a conservative over-estimate is the safe direction.
 */
import { LLMMessage, LLMToolDefinition } from "../../types/llm";

/** Approximate context windows (in tokens) by model-name substring. */
const CONTEXT_WINDOWS: Array<{ match: RegExp; window: number }> = [
  { match: /claude/i, window: 200_000 },
  { match: /gpt-4o|gpt-4\.1|o[1-9]/i, window: 128_000 },
  { match: /gpt-4/i, window: 128_000 },
  { match: /gpt-3\.5/i, window: 16_385 },
  { match: /gemini/i, window: 1_000_000 },
  { match: /llama3|llama-3/i, window: 8_192 },
  { match: /qwen3|qwen2/i, window: 32_768 },
];

/**
 * Default window when the model is unknown. For the cluster Ollama path the
 * effective window is the server's num_ctx (OLLAMA_NUM_CTX, default 4096), which
 * is smaller than the model's theoretical maximum — so we default conservatively.
 */
export const DEFAULT_CONTEXT_WINDOW = parseInt(
  process.env.OLLAMA_NUM_CTX || "4096",
  10,
);

/** Resolve the context window for a model name (case-insensitive substring match). */
export function getContextWindow(model?: string | null): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  for (const { match, window } of CONTEXT_WINDOWS) {
    if (match.test(model)) return window;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/** Rough token estimate for a string (~4 chars/token, rounded up). */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Per-message framing overhead (role markers, separators) in estimated tokens. */
const MESSAGE_OVERHEAD = 4;

/** Estimate the total token cost of a message array, including tool-call payloads. */
export function estimateMessagesTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += MESSAGE_OVERHEAD + estimateTokens(m.content);
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total +=
          estimateTokens(tc.name) +
          estimateTokens(JSON.stringify(tc.arguments));
      }
    }
  }
  return total;
}

export interface BudgetOptions {
  /** Model name used to resolve the context window. */
  model?: string | null;
  /** Tokens to reserve for the model's completion (default 1024). */
  reserveOutputTokens?: number;
  /** Explicit window override (e.g. the live Ollama num_ctx). */
  contextWindow?: number;
}

export interface BudgetResult {
  /** Messages trimmed to fit the budget (system + most recent turns preserved). */
  messages: LLMMessage[];
  /** True if any messages were dropped. */
  truncated: boolean;
  /** Number of messages dropped. */
  droppedCount: number;
  /** Estimated token cost of the returned messages. */
  estimatedTokens: number;
  /** The input-token budget applied (window − reserve). */
  budget: number;
}

/**
 * Trim a message array to fit the input-token budget.
 *
 * Invariants: any leading system message is always kept; the most recent
 * messages are preferred; the oldest non-system messages are dropped first.
 * If even (system + last message) exceeds the budget, both are still returned
 * (callers should surface a budget-exhausted condition rather than send nothing).
 */
export function fitMessagesToBudget(
  messages: LLMMessage[],
  options: BudgetOptions = {},
): BudgetResult {
  const window = options.contextWindow ?? getContextWindow(options.model);
  const reserve = options.reserveOutputTokens ?? 1024;
  const budget = Math.max(window - reserve, 0);

  const hasSystem = messages.length > 0 && messages[0].role === "system";
  const system = hasSystem ? [messages[0]] : [];
  const rest = hasSystem ? messages.slice(1) : messages.slice();

  // Drop oldest non-system messages until the whole set fits the budget.
  const kept = rest.slice();
  let dropped = 0;
  while (
    kept.length > 1 &&
    estimateMessagesTokens([...system, ...kept]) > budget
  ) {
    kept.shift();
    dropped++;
  }

  const finalMessages = [...system, ...kept];
  return {
    messages: finalMessages,
    truncated: dropped > 0,
    droppedCount: dropped,
    estimatedTokens: estimateMessagesTokens(finalMessages),
    budget,
  };
}

/**
 * Estimate the token cost of the LLM tool/function definitions sent on every
 * request. Tool defs — including dynamically-discovered MCP tools — inflate every
 * prompt, so callers should reserve room for them when budgeting the message window.
 */
export function estimateToolDefsTokens(
  tools: LLMToolDefinition[] | undefined | null,
): number {
  if (!tools || tools.length === 0) return 0;
  let total = 0;
  for (const t of tools) {
    total += 2 + estimateTokens(JSON.stringify(t));
  }
  return total;
}
