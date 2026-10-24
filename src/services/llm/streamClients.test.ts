import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";
import { BoucioClient } from "./boucioClient";
import { OpenAIClient } from "./openaiClient";
import { AnthropicClient } from "./anthropicClient";
import type { LLMProviderConfig } from "./llmClientFactory";
import type { LLMStreamCallbacks } from "../../types/llm";

vi.mock("../../lib/tokenManager", () => ({
  tokenManager: { getAccessToken: vi.fn().mockResolvedValue("test-token") },
}));

/**
 * These tests exist because every bug in a streaming parser hides at a chunk
 * boundary. Each case deliberately splits the wire bytes in a hostile place:
 * mid-JSON-line for NDJSON, mid-`data:` line for SSE, and between an Anthropic
 * `event:` line and its `data:` line.
 */

/** A readable stream that emits exactly the given chunks, then ends. */
function streamOf(chunks: string[]): Readable {
  return Readable.from(chunks.map((c) => Buffer.from(c)));
}

type PostArgs = [string, unknown, unknown];
interface Postable {
  axiosInstance: { post: (...args: PostArgs) => Promise<{ data: Readable }> };
}

/** Replace a client's axios instance with one that returns the canned stream. */
function stubStream(client: object, chunks: string[]): PostArgs[] {
  const calls: PostArgs[] = [];
  (client as unknown as Postable).axiosInstance = {
    post: (...args: PostArgs) => {
      calls.push(args);
      return Promise.resolve({ data: streamOf(chunks) });
    },
  };
  return calls;
}

interface Collected {
  tokens: string[];
  thinking: string[];
  done: {
    prompt_tokens: number;
    completion_tokens: number;
    thinking?: string;
  }[];
  callbacks: LLMStreamCallbacks;
}

function collect(): Collected {
  const c: Collected = {
    tokens: [],
    thinking: [],
    done: [],
    callbacks: {
      onToken: () => {},
    },
  };
  c.callbacks = {
    onToken: (t) => c.tokens.push(t),
    onThinkingToken: (t) => c.thinking.push(t),
    onDone: (u) => c.done.push(u),
  };
  return c;
}

const cfg = (
  provider: LLMProviderConfig["provider"],
  overrides: Partial<LLMProviderConfig> = {},
): LLMProviderConfig => ({
  provider,
  api_endpoint: "http://llm.test",
  api_key: "k",
  model: "test-model",
  enable_reasoning: false,
  ...overrides,
});

describe("BoucioClient.chatStream (Ollama NDJSON)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reassembles a JSON object split across two chunks", async () => {
    const client = new BoucioClient(cfg("boucio"));
    // The first chunk ends mid-object; the parser must carry the remainder.
    stubStream(client, [
      '{"message":{"content":"Hel',
      'lo"}}\n{"message":{"content":" world"}}\n',
      '{"done":true,"prompt_eval_count":11,"eval_count":7}\n',
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "hi" }], c.callbacks);

    expect(c.tokens.join("")).toBe("Hello world");
    expect(c.done).toEqual([
      { prompt_tokens: 11, completion_tokens: 7, thinking: undefined },
    ]);
  });

  it("reports JSON-format thinking separately and stores it via onDone", async () => {
    const client = new BoucioClient(cfg("boucio"));
    stubStream(client, [
      '{"message":{"thinking":"let me think"}}\n',
      '{"message":{"content":"42"}}\n',
      '{"done":true,"prompt_eval_count":3,"eval_count":1}\n',
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "q" }], c.callbacks);

    expect(c.thinking).toEqual(["let me think"]);
    expect(c.tokens.join("")).toBe("42");
    expect(c.done[0].thinking).toBe("let me think");
  });

  it("streams legacy <think> tag content but never stores it", async () => {
    const client = new BoucioClient(cfg("boucio"));
    stubStream(client, [
      '{"message":{"content":"<think>hmm</think>answer"}}\n',
      '{"done":true,"prompt_eval_count":1,"eval_count":1}\n',
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "q" }], c.callbacks);

    expect(c.thinking).toEqual(["hmm"]);
    expect(c.tokens.join("")).toBe("answer");
    // Legacy tag thinking is deliberately absent from onDone: only the JSON
    // format is rebuilt into <think>…</think> for storage.
    expect(c.done[0].thinking).toBeUndefined();
  });

  it("sends the sampling block and keep_alive, matching the non-streaming path", async () => {
    const client = new BoucioClient(cfg("boucio"));
    const calls = stubStream(client, [
      '{"done":true,"prompt_eval_count":0,"eval_count":0}\n',
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "q" }], c.callbacks, {
      think: false,
    });

    const body = calls[0][1] as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.think).toBe(false);
    expect(body.keep_alive).toBeDefined();
    expect(body.options).toMatchObject({ temperature: 0.7, num_ctx: 4096 });
  });
});

describe("OpenAIClient.chatStream (SSE)", () => {
  it("reassembles a data: line split across chunks and reads the usage tail", async () => {
    const client = new OpenAIClient(cfg("openai"));
    stubStream(client, [
      'data: {"choices":[{"delta":{"content":"Hi"',
      '}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "hi" }], c.callbacks);

    expect(c.tokens.join("")).toBe("Hi there");
    expect(c.done[0]).toMatchObject({ prompt_tokens: 5, completion_tokens: 2 });
  });

  it("routes reasoning_content to the thinking callback", async () => {
    const client = new OpenAIClient(cfg("openai"));
    stubStream(client, [
      'data: {"choices":[{"delta":{"reasoning_content":"because"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "hi" }], c.callbacks);

    expect(c.thinking).toEqual(["because"]);
    expect(c.tokens.join("")).toBe("ok");
    expect(c.done[0].thinking).toBe("because");
  });
});

describe("AnthropicClient.chatStream (SSE)", () => {
  it("keeps the event type when event: and data: land in different chunks", async () => {
    // This is the regression test for the ported bug: eventType used to be
    // declared inside the data handler, so this split dropped the delta.
    const client = new AnthropicClient(cfg("anthropic"));
    stubStream(client, [
      "event: content_block_delta\n",
      'data: {"delta":{"type":"text_delta","text":"split-safe"}}\n\n',
      "event: message_delta\n" +
        'data: {"usage":{"input_tokens":9,"output_tokens":4}}\n\n',
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "hi" }], c.callbacks);

    expect(c.tokens.join("")).toBe("split-safe");
    expect(c.done[0]).toMatchObject({ prompt_tokens: 9, completion_tokens: 4 });
  });

  it("separates thinking blocks from text and suppresses text inside them", async () => {
    const client = new AnthropicClient(cfg("anthropic"));
    stubStream(client, [
      'event: content_block_start\ndata: {"content_block":{"type":"thinking"}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"thinking_delta","thinking":"reasoning"}}\n\n',
      // A text_delta while still inside the thinking block must not be emitted.
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"LEAK"}}\n\n',
      'event: content_block_start\ndata: {"content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"real"}}\n\n',
    ]);
    const c = collect();

    await client.chatStream([{ role: "user", content: "hi" }], c.callbacks);

    expect(c.thinking).toEqual(["reasoning"]);
    expect(c.tokens.join("")).toBe("real");
  });

  it("lifts system messages to the top-level system field", async () => {
    const client = new AnthropicClient(cfg("anthropic"));
    const calls = stubStream(client, [
      'event: message_delta\ndata: {"usage":{"input_tokens":1,"output_tokens":1}}\n\n',
    ]);
    const c = collect();

    await client.chatStream(
      [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      c.callbacks,
    );

    const body = calls[0][1] as Record<string, unknown>;
    expect(body.system).toBe("be brief");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
