import { describe, it, expect } from "vitest";
import {
  getContextWindow,
  estimateTokens,
  estimateMessagesTokens,
  fitMessagesToBudget,
  DEFAULT_CONTEXT_WINDOW,
} from "./contextBudget";
import { LLMMessage } from "../../types/llm";

describe("getContextWindow", () => {
  it("resolves known model families", () => {
    expect(getContextWindow("claude-opus-4")).toBe(200_000);
    expect(getContextWindow("gpt-4o")).toBe(128_000);
    expect(getContextWindow("qwen3.5:2b")).toBe(32_768);
  });
  it("falls back to the default for unknown models", () => {
    expect(getContextWindow("some-mystery-model")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(getContextWindow(null)).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens(undefined)).toBe(0);
  });
});

describe("fitMessagesToBudget", () => {
  const sys: LLMMessage = { role: "system", content: "S".repeat(40) }; // ~10 tokens + overhead
  const mk = (n: number, len = 40): LLMMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(len),
    }));

  it("returns messages unchanged when within budget", () => {
    const msgs = [sys, ...mk(3)];
    const r = fitMessagesToBudget(msgs, {
      contextWindow: 100_000,
      reserveOutputTokens: 1024,
    });
    expect(r.truncated).toBe(false);
    expect(r.droppedCount).toBe(0);
    expect(r.messages).toHaveLength(msgs.length);
  });

  it("drops oldest non-system messages when over budget, keeping system + recent", () => {
    const msgs = [sys, ...mk(20, 400)]; // each ~100 tokens
    const r = fitMessagesToBudget(msgs, {
      contextWindow: 600,
      reserveOutputTokens: 100,
    });
    expect(r.truncated).toBe(true);
    expect(r.droppedCount).toBeGreaterThan(0);
    // system always preserved as first message
    expect(r.messages[0].role).toBe("system");
    // the most recent message is preserved
    expect(r.messages[r.messages.length - 1]).toEqual(msgs[msgs.length - 1]);
    // result fits the budget
    expect(r.estimatedTokens).toBeLessThanOrEqual(r.budget);
  });

  it("never drops below system + the last message even if still over budget", () => {
    const huge: LLMMessage = { role: "user", content: "z".repeat(100_000) };
    const r = fitMessagesToBudget([sys, huge], {
      contextWindow: 100,
      reserveOutputTokens: 10,
    });
    expect(r.messages).toHaveLength(2);
    expect(r.messages[0].role).toBe("system");
  });

  it("counts tool_call payloads in the estimate", () => {
    const withTools: LLMMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "1", name: "calc", arguments: { expression: "2+2" } },
        ],
      },
    ];
    expect(estimateMessagesTokens(withTools)).toBeGreaterThan(4);
  });
});
