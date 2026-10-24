import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import type { LLMStreamCallbacks } from "../types/llm";

/**
 * Asserts the SSE contract monochrome-chatbot-ui depends on, with no Postgres, Redis or
 * Ollama. The event names and their order are the compatibility surface; see
 * useChatStream.ts in that repo.
 */

const ctx = {
  userId: "piuser-1",
  orgId: "acme",
  roles: ["bouc_user"],
  accessToken: "tok",
};

const chatRow = {
  id: "chat-1",
  user_id: "piuser-1",
  surface: "chat",
  last_distilled_at: null,
  distilled_message_count: 0,
};

const prismaMock = {
  assignment: {
    findUnique: vi.fn().mockResolvedValue(chatRow),
    update: vi.fn().mockResolvedValue({}),
  },
  message: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  run: {
    create: vi.fn().mockResolvedValue({ id: "run-1" }),
    update: vi.fn().mockResolvedValue({}),
  },
};

/** The stream the fake LLM client plays back. Swapped per test. */
let streamImpl: (cb: LLMStreamCallbacks) => Promise<void> = async (cb) => {
  cb.onToken("hi");
  cb.onDone?.({ prompt_tokens: 3, completion_tokens: 1 });
};
let streamingSupported = true;

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/auth", () => ({
  getUserContextFromRequest: () => ctx,
  requireRoles: () => () => {},
}));
vi.mock("../services/llm/assignmentConfigClient", () => ({
  fetchAssignmentConfig: vi.fn().mockResolvedValue(null),
  createLLMClientFromConfig: () =>
    streamingSupported
      ? {
          chat: vi.fn(),
          chatStream: (_m: unknown, cb: LLMStreamCallbacks) => streamImpl(cb),
        }
      : { chat: vi.fn() },
}));
vi.mock("../services/instructionClient", () => ({
  fetchInstructions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../services/memory/memoryClient", () => ({
  memoryClient: { retrieveMemories: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../services/chat/distillation", () => ({
  maybeDistillChat: vi.fn().mockResolvedValue(false),
}));

const { streamChat } = await import("./chatStreamController");

interface FakeRes {
  res: Response;
  written: () => string;
  events: () => string[];
  status: () => number | null;
  body: () => unknown;
}

function fakeRes(): FakeRes {
  const chunks: string[] = [];
  let statusCode: number | null = null;
  let jsonBody: unknown = null;
  let ended = false;
  const res = {
    setHeader: vi.fn(),
    write: (c: string) => {
      chunks.push(c);
      return true;
    },
    end: () => {
      ended = true;
      return res;
    },
    get writableEnded() {
      return ended;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (b: unknown) => {
      jsonBody = b;
      return res;
    },
    send: () => res,
    headersSent: false,
  } as unknown as Response;

  return {
    res,
    written: () => chunks.join(""),
    events: () =>
      chunks
        .filter((c) => c.startsWith("event: "))
        .map((c) => c.slice(7, c.indexOf("\n"))),
    status: () => statusCode,
    body: () => jsonBody,
  };
}

function fakeReq(body: Record<string, unknown> = { content: "hello" }) {
  const closeHandlers: Array<() => void> = [];
  const req = {
    params: { chatId: "chat-1" },
    body,
    headers: {},
    socket: { setTimeout: vi.fn() },
    on: (event: string, cb: () => void) => {
      if (event === "close") closeHandlers.push(cb);
      return req;
    },
  } as unknown as Request;
  return { req, disconnect: () => closeHandlers.forEach((h) => h()) };
}

describe("streamChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamingSupported = true;
    prismaMock.assignment.findUnique.mockResolvedValue(chatRow);
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.message.count.mockResolvedValue(0);
    prismaMock.run.create.mockResolvedValue({ id: "run-1" });
    prismaMock.message.create
      .mockResolvedValueOnce({ id: "user-msg-1" })
      .mockResolvedValueOnce({ id: "assistant-msg-1" });
    streamImpl = async (cb) => {
      cb.onToken("Hel");
      cb.onToken("lo");
      cb.onDone?.({ prompt_tokens: 7, completion_tokens: 2 });
    };
  });

  it("emits the event sequence the chat UI parses, in order", async () => {
    const { req } = fakeReq();
    const r = fakeRes();

    await streamChat(req, r.res);

    expect(r.events()).toEqual([
      "user_message.created",
      "run.status",
      "message.token",
      "message.token",
      "message.created",
      "run.completed",
    ]);
  });

  it("sends message.created with exactly the keys the UI reads", async () => {
    const { req } = fakeReq();
    const r = fakeRes();

    await streamChat(req, r.res);

    const frame = r
      .written()
      .split("\n\n")
      .find((f) => f.startsWith("event: message.created"));
    const payload = JSON.parse(frame!.split("data: ")[1]);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "role",
        "content",
        "message_id",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "model_name",
      ].sort(),
    );
    expect(payload.content).toBe("Hello");
    expect(payload.total_tokens).toBe(9);
    expect(payload.message_id).toBe("assistant-msg-1");
  });

  it("rebuilds the <think> wrapper the UI regexes back out", async () => {
    streamImpl = async (cb) => {
      cb.onThinkingToken?.("pondering");
      cb.onToken("42");
      cb.onDone?.({
        prompt_tokens: 1,
        completion_tokens: 1,
        thinking: "pondering",
      });
    };
    const { req } = fakeReq();
    const r = fakeRes();

    await streamChat(req, r.res);

    expect(r.events()).toContain("message.thinking_token");
    const stored = prismaMock.message.create.mock.calls[1][0].data.content;
    expect(stored).toBe("<think>pondering</think>\n\n42");
    expect(stored).toMatch(/^<think>[\s\S]*?<\/think>\n\n/);
  });

  it("stores the assistant message with tokens and run provenance", async () => {
    const { req } = fakeReq();
    const r = fakeRes();

    await streamChat(req, r.res);

    const data = prismaMock.message.create.mock.calls[1][0].data;
    expect(data).toMatchObject({
      assignment_id: "chat-1",
      role: "assistant",
      prompt_tokens: 7,
      completion_tokens: 2,
      total_tokens: 9,
      provenance: { run_id: "run-1" },
    });
    expect(prismaMock.run.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: "completed", llm_calls: 1 }),
      }),
    );
  });

  it("writes a Run row carrying org_id and the chat agent id", async () => {
    const { req } = fakeReq();
    const r = fakeRes();

    await streamChat(req, r.res);

    expect(prismaMock.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignment_id: "chat-1",
          user_id: "piuser-1",
          org_id: "acme",
          agent_id: "chat",
          status: "running",
          trigger_message_id: "user-msg-1",
        }),
      }),
    );
  });

  it("discards the answer and cancels the run when the client disconnects", async () => {
    const { req, disconnect } = fakeReq();
    const r = fakeRes();
    streamImpl = async (cb) => {
      cb.onToken("start");
      disconnect();
      cb.onToken("never-seen");
      cb.onDone?.({ prompt_tokens: 1, completion_tokens: 1 });
    };

    await streamChat(req, r.res);

    // Only the user message was created; no assistant message.
    expect(prismaMock.message.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.run.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "cancelled" }),
      }),
    );
    expect(r.events()).not.toContain("message.created");
    expect(r.written()).not.toContain("never-seen");
  });

  it("emits run.failed when the stream throws mid-flight", async () => {
    streamImpl = async () => {
      throw new Error("ollama exploded");
    };
    const { req } = fakeReq();
    const r = fakeRes();

    await streamChat(req, r.res);

    expect(r.events()).toContain("run.failed");
    const frame = r
      .written()
      .split("\n\n")
      .find((f) => f.startsWith("event: run.failed"));
    expect(JSON.parse(frame!.split("data: ")[1])).toEqual({
      error: "ollama exploded",
    });
    expect(prismaMock.run.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("rejects a missing content with plain JSON, before any write", async () => {
    const { req } = fakeReq({});
    const r = fakeRes();

    await streamChat(req, r.res);

    expect(r.status()).toBe(400);
    expect(r.body()).toEqual({ error: "content is required" });
    expect(r.written()).toBe("");
  });

  it("404s an unknown chat and 403s another user's chat", async () => {
    prismaMock.assignment.findUnique.mockResolvedValueOnce(null);
    const a = fakeRes();
    await streamChat(fakeReq().req, a.res);
    expect(a.status()).toBe(404);

    prismaMock.assignment.findUnique.mockResolvedValueOnce({
      ...chatRow,
      user_id: "someone-else",
    });
    const b = fakeRes();
    await streamChat(fakeReq().req, b.res);
    expect(b.status()).toBe(403);
  });

  it("404s an agent assignment reached through the chat surface", async () => {
    prismaMock.assignment.findUnique.mockResolvedValueOnce({
      ...chatRow,
      surface: "agent",
    });
    const r = fakeRes();
    await streamChat(fakeReq().req, r.res);
    expect(r.status()).toBe(404);
  });

  it("503s before persisting anything when the provider cannot stream", async () => {
    streamingSupported = false;
    const { req } = fakeReq();
    const r = fakeRes();

    await streamChat(req, r.res);

    expect(r.status()).toBe(503);
    expect(prismaMock.message.create).not.toHaveBeenCalled();
    expect(prismaMock.run.create).not.toHaveBeenCalled();
  });
});
