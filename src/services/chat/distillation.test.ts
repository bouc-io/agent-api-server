import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { maybeDistillChat, type DistillableChat } from "./distillation";

const triggerDistillation = vi.fn().mockResolvedValue(undefined);
const isEnabled = vi.fn().mockReturnValue(true);

vi.mock("../memory/distillationClient", () => ({
  distillationClient: {
    isEnabled: () => isEnabled(),
    triggerDistillation: (...args: unknown[]) => triggerDistillation(...args),
  },
}));

type FakePrisma = Parameters<typeof maybeDistillChat>[0];

/** Minimal prisma double: a message count, a message page, and an update spy. */
function fakePrisma(count: number) {
  const update = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue([
    { role: "user", content: "newest" },
    { role: "assistant", content: "older" },
  ]);
  const prisma = {
    message: { count: vi.fn().mockResolvedValue(count), findMany },
    assignment: { update },
  } as unknown as FakePrisma;
  return { prisma, update, findMany };
}

const chat = (over: Partial<DistillableChat> = {}): DistillableChat => ({
  id: "a1",
  last_distilled_at: null,
  distilled_message_count: 0,
  ...over,
});

const NOW = new Date("2026-10-17T12:00:00.000Z");

describe("maybeDistillChat thresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEnabled.mockReturnValue(true);
    triggerDistillation.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.DISTILLATION_MIN_MESSAGES;
    delete process.env.DISTILLATION_MIN_INTERVAL_MS;
    delete process.env.DISTILLATION_MAX_MESSAGES;
  });

  it("does nothing when the distiller is disabled", async () => {
    isEnabled.mockReturnValue(false);
    const { prisma, update } = fakePrisma(100);
    expect(await maybeDistillChat(prisma, chat(), "u", "tok", NOW)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(triggerDistillation).not.toHaveBeenCalled();
  });

  it("skips below the message threshold", async () => {
    const { prisma, update } = fakePrisma(9);
    expect(await maybeDistillChat(prisma, chat(), "u", "tok", NOW)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("fires at exactly the message threshold", async () => {
    const { prisma, update } = fakePrisma(10);
    expect(await maybeDistillChat(prisma, chat(), "u", "tok", NOW)).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { last_distilled_at: NOW, distilled_message_count: 10 },
    });
  });

  it("counts only messages added since the last distillation", async () => {
    const { prisma } = fakePrisma(15);
    // 15 total minus 10 already distilled = 5 new, below the threshold.
    expect(
      await maybeDistillChat(
        prisma,
        chat({ distilled_message_count: 10 }),
        "u",
        "tok",
        NOW,
      ),
    ).toBe(false);
  });

  it("skips inside the minimum interval even with enough new messages", async () => {
    const { prisma } = fakePrisma(50);
    const fiveMinutesAgo = new Date(NOW.getTime() - 5 * 60_000);
    expect(
      await maybeDistillChat(
        prisma,
        chat({ last_distilled_at: fiveMinutesAgo }),
        "u",
        "tok",
        NOW,
      ),
    ).toBe(false);
  });

  it("fires once the interval has elapsed", async () => {
    const { prisma } = fakePrisma(50);
    const sixteenMinutesAgo = new Date(NOW.getTime() - 16 * 60_000);
    expect(
      await maybeDistillChat(
        prisma,
        chat({ last_distilled_at: sixteenMinutesAgo }),
        "u",
        "tok",
        NOW,
      ),
    ).toBe(true);
  });

  it("honours env overrides for both thresholds", async () => {
    process.env.DISTILLATION_MIN_MESSAGES = "2";
    process.env.DISTILLATION_MIN_INTERVAL_MS = "0";
    const { prisma } = fakePrisma(2);
    expect(
      await maybeDistillChat(
        prisma,
        chat({ last_distilled_at: NOW }),
        "u",
        "tok",
        NOW,
      ),
    ).toBe(true);
  });

  it("sends oldest-first transcript, capped and labelled as a chat source", async () => {
    process.env.DISTILLATION_MAX_MESSAGES = "2";
    const { prisma, findMany } = fakePrisma(10);
    await maybeDistillChat(prisma, chat(), "piuser-1", "tok", NOW);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2, orderBy: { created_at: "desc" } }),
    );
    const [payload, token] = triggerDistillation.mock.calls[0];
    expect(payload).toEqual({
      source: { type: "chat", id: "a1" },
      // findMany returns newest-first; the payload must be chronological.
      context: {
        messages: [
          { role: "assistant", content: "older" },
          { role: "user", content: "newest" },
        ],
      },
      metadata: { user_id: "piuser-1" },
      options: { max_memories: 10 },
    });
    expect(token).toBe("tok");
  });

  it("writes the counters before triggering, so a concurrent turn cannot double-fire", async () => {
    const order: string[] = [];
    const { prisma } = fakePrisma(10);
    (
      prisma.assignment.update as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => {
      order.push("update");
      return Promise.resolve({});
    });
    triggerDistillation.mockImplementation(() => {
      order.push("trigger");
      return Promise.resolve(undefined);
    });

    await maybeDistillChat(prisma, chat(), "u", "tok", NOW);
    expect(order).toEqual(["update", "trigger"]);
  });

  it("never rejects when the trigger fails", async () => {
    triggerDistillation.mockRejectedValue(new Error("distiller down"));
    const { prisma } = fakePrisma(10);
    await expect(
      maybeDistillChat(prisma, chat(), "u", "tok", NOW),
    ).resolves.toBe(true);
  });
});
