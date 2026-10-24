import { describe, it, expect } from "vitest";
import {
  toChatResponse,
  toMessageResponse,
  paginate,
  type ChatRow,
  type MessageRow,
} from "./chatSerializer";

/**
 * These literal key arrays ARE the zero-UI-change guarantee. They are copied from
 * monochrome-chatbot-ui/src/lib/chatbotApi.ts (ChatResponse and MessageResponse).
 * If a field is renamed or dropped on this side, these fail loudly instead of the UI
 * silently rendering undefined.
 */
const CHAT_KEYS = [
  "id",
  "title",
  "summary",
  "user_id",
  "model_id",
  "created_at",
  "updated_at",
  "metadata",
].sort();

const MESSAGE_KEYS = [
  "id",
  "message_group_id",
  "role",
  "content",
  "chat_id",
  "user_id",
  "model_id",
  "created_at",
  "updated_at",
  "metadata",
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "feedback",
].sort();

const chatRow = (over: Partial<ChatRow> = {}): ChatRow => ({
  id: "a1",
  title: "Some chat",
  summary: null,
  user_id: "piuser-1",
  created_at: new Date("2026-10-17T10:00:00.000Z"),
  updated_at: new Date("2026-10-17T11:00:00.000Z"),
  metadata: {},
  ...over,
});

const messageRow = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: "m1",
  assignment_id: "a1",
  role: "assistant",
  content: "hello",
  created_at: new Date("2026-10-17T10:00:00.000Z"),
  metadata: {},
  prompt_tokens: null,
  completion_tokens: null,
  total_tokens: null,
  feedback: null,
  ...over,
});

describe("toChatResponse", () => {
  it("emits exactly the keys the chat UI declares", () => {
    expect(Object.keys(toChatResponse(chatRow())).sort()).toEqual(CHAT_KEYS);
  });

  it("never leaks assignment-only fields", () => {
    const row = {
      ...chatRow(),
      // Fields the agent's Assignment carries that must not reach a client.
      settings: { tools: ["bash"] },
      surface: "chat",
      is_archived: false,
      org_id: "acme",
    } as ChatRow;
    const out = toChatResponse(row) as unknown as Record<string, unknown>;
    expect(out.settings).toBeUndefined();
    expect(out.surface).toBeUndefined();
    expect(out.org_id).toBeUndefined();
  });

  it("echoes model_id back from metadata and dates as ISO strings", () => {
    const out = toChatResponse(
      chatRow({ metadata: { model_id: "qwen3.5:2b" } }),
    );
    expect(out.model_id).toBe("qwen3.5:2b");
    expect(out.created_at).toBe("2026-10-17T10:00:00.000Z");
    expect(out.updated_at).toBe("2026-10-17T11:00:00.000Z");
  });

  it("round-trips an empty summary, which the UI's no-op touch sends", () => {
    expect(toChatResponse(chatRow({ summary: "" })).summary).toBe("");
    expect(toChatResponse(chatRow({ summary: null })).summary).toBeNull();
  });

  it("treats a non-object metadata as empty rather than throwing", () => {
    expect(toChatResponse(chatRow({ metadata: null })).metadata).toEqual({});
  });
});

describe("toMessageResponse", () => {
  it("emits exactly the keys the chat UI declares", () => {
    expect(
      Object.keys(toMessageResponse(messageRow(), "piuser-1")).sort(),
    ).toEqual(MESSAGE_KEYS);
  });

  it("projects chat_id, user_id and the metadata-backed fields", () => {
    const out = toMessageResponse(
      messageRow({
        metadata: { model_name: "claude-opus-5", message_group_id: "g9" },
      }),
      "piuser-1",
    );
    expect(out.chat_id).toBe("a1");
    expect(out.user_id).toBe("piuser-1");
    expect(out.model_id).toBe("claude-opus-5");
    expect(out.message_group_id).toBe("g9");
  });

  it("falls back to the message id for message_group_id and null for model_id", () => {
    const out = toMessageResponse(messageRow(), "piuser-1");
    expect(out.message_group_id).toBe("m1");
    expect(out.model_id).toBeNull();
  });

  it("coerces absent token counts to 0, since the UI only renders truthy totals", () => {
    const out = toMessageResponse(messageRow(), "piuser-1");
    expect(out.prompt_tokens).toBe(0);
    expect(out.completion_tokens).toBe(0);
    expect(out.total_tokens).toBe(0);
  });

  it("serializes feedback, including a missing comment", () => {
    expect(
      toMessageResponse(
        messageRow({ feedback: { rating: "positive", comment: null } }),
        "u",
      ).feedback,
    ).toEqual({ rating: "positive", comment: null });
    expect(toMessageResponse(messageRow(), "u").feedback).toBeNull();
  });

  it("sets updated_at equal to created_at", () => {
    const out = toMessageResponse(messageRow(), "u");
    expect(out.updated_at).toBe(out.created_at);
  });

  it("never leaks provenance, which carries run_id", () => {
    const row = { ...messageRow(), provenance: { run_id: "r1" } } as MessageRow;
    const out = toMessageResponse(row, "u") as unknown as Record<
      string,
      unknown
    >;
    expect(out.provenance).toBeUndefined();
  });
});

describe("paginate", () => {
  it("uses the chatbot's envelope, not this service's has_more shape", () => {
    const out = paginate([1, 2], 2, 20, 45);
    expect(out.pagination).toEqual({
      page: 2,
      limit: 20,
      total: 45,
      total_pages: 3,
    });
    expect(Object.keys(out)).toEqual(["data", "pagination"]);
  });

  it("reports one page when there is nothing to page", () => {
    expect(paginate([], 1, 20, 0).pagination.total_pages).toBe(0);
  });
});
