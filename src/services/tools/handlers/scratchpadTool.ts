import { ToolHandler, ToolResult, ToolContext } from "../../../types/tool";
import { prisma } from "../../../lib/prisma";
import { createComponentLogger } from "../../../lib/logger";

const log = createComponentLogger("tool-scratchpad");

const MAX_CONTENT = 100_000;

/**
 * scratchpad_write — persist a named note for the current assignment. The
 * scratchpad survives across runs of the same assignment, giving the agent a
 * durable workspace for intermediate state, plans, and findings.
 */
export const scratchpadWriteTool: ToolHandler = {
  name: "scratchpad_write",
  trust: "trusted",
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const key = typeof args.key === "string" ? args.key.trim() : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key)
      return {
        success: false,
        output: null,
        error: 'A non-empty "key" is required.',
      };
    if (content.length > MAX_CONTENT) {
      return {
        success: false,
        output: null,
        error: `Content exceeds the ${MAX_CONTENT}-character limit.`,
      };
    }
    try {
      await prisma.scratchpad.upsert({
        where: {
          assignment_id_key: { assignment_id: context.assignmentId, key },
        },
        update: { content },
        create: { assignment_id: context.assignmentId, key, content },
      });
      return {
        success: true,
        trust: "trusted",
        output: { key, bytes: content.length, status: "saved" },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      log.warn({ err: message }, "scratchpad_write failed");
      return {
        success: false,
        output: null,
        error: `Failed to write scratchpad: ${message}`,
      };
    }
  },
};

/**
 * scratchpad_read — read a named note (or list all keys when no key is given)
 * for the current assignment.
 */
export const scratchpadReadTool: ToolHandler = {
  name: "scratchpad_read",
  trust: "trusted",
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const key = typeof args.key === "string" ? args.key.trim() : "";
    try {
      if (key) {
        const row = await prisma.scratchpad.findUnique({
          where: {
            assignment_id_key: { assignment_id: context.assignmentId, key },
          },
        });
        if (!row)
          return {
            success: true,
            trust: "trusted",
            output: { key, found: false, content: null },
          };
        return {
          success: true,
          trust: "trusted",
          output: {
            key,
            found: true,
            content: row.content,
            updated_at: row.updated_at,
          },
        };
      }
      const rows = await prisma.scratchpad.findMany({
        where: { assignment_id: context.assignmentId },
        select: { key: true, updated_at: true },
        orderBy: { updated_at: "desc" },
      });
      return { success: true, trust: "trusted", output: { keys: rows } };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      log.warn({ err: message }, "scratchpad_read failed");
      return {
        success: false,
        output: null,
        error: `Failed to read scratchpad: ${message}`,
      };
    }
  },
};
