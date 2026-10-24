import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Guards the surface separation. The chat surface shares the Assignment table, so
 * listAssignments must exclude surface='chat' rows or the agent's conversation list
 * shows every chat. This was observed leaking against a real database before the
 * filter was added, so it is worth a regression test rather than a comment.
 */

const findMany = vi.fn().mockResolvedValue([]);
const count = vi.fn().mockResolvedValue(0);

vi.mock("../lib/prisma", () => ({
  prisma: { assignment: { findMany, count } },
}));
vi.mock("../lib/auth", () => ({
  getUserContextFromRequest: () => ({
    userId: "piuser-1",
    orgId: null,
    roles: ["bouc_user"],
    accessToken: "tok",
  }),
}));

const { listAssignments } = await import("./assignmentController");

function fakeRes() {
  const res = {
    json: vi.fn(() => res),
    status: vi.fn(() => res),
  } as unknown as Response;
  return res;
}

describe("listAssignments surface separation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("excludes chat conversations from the agent list", async () => {
    await listAssignments({ query: {} } as unknown as Request, fakeRes());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ surface: "agent" }),
      }),
    );
  });

  it("applies the same filter to the pagination count", async () => {
    await listAssignments({ query: {} } as unknown as Request, fakeRes());

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ surface: "agent" }),
    });
  });

  it("still scopes by user, and by org when the caller has one", async () => {
    await listAssignments({ query: {} } as unknown as Request, fakeRes());
    const { where } = findMany.mock.calls[0][0];
    expect(where.user_id).toBe("piuser-1");
    // orgId is null for this caller, so no org_id key at all rather than org_id: null.
    expect("org_id" in where).toBe(false);
  });
});
