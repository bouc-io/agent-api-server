import { ToolHandler, ToolResult, ToolContext } from "../../../types/tool";
import { prisma } from "../../../lib/prisma";
import { runSubagent } from "../../subagent/subagentRunner";

/**
 * spawn_subagent — delegate a self-contained sub-task to a scoped child run.
 * The child has its own assignment, context, and token budget; this tool blocks
 * until the child finishes and returns its final answer as the tool result.
 * Recursion depth and concurrency are bounded (see subagentRunner).
 */
export const spawnSubagentTool: ToolHandler = {
  name: "spawn_subagent",
  trust: "trusted",
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const goal = typeof args.goal === "string" ? args.goal.trim() : "";
    if (!goal)
      return {
        success: false,
        output: null,
        error: 'A non-empty "goal" is required.',
      };
    const contextText =
      typeof args.context === "string" ? args.context : undefined;

    const run = await prisma.run.findUnique({
      where: { id: context.runId },
      select: { user_id: true, org_id: true },
    });

    const res = await runSubagent({
      parentAssignmentId: context.assignmentId,
      parentRunId: context.runId,
      userId: context.userId || run?.user_id || undefined,
      orgId: run?.org_id || undefined,
      goal,
      contextText,
    });

    if (!res.success) {
      return {
        success: false,
        output: { child_run_id: res.childRunId, status: res.status },
        error: res.error,
      };
    }
    return {
      success: true,
      trust: "trusted",
      output: {
        response: res.response,
        child_run_id: res.childRunId,
        child_assignment_id: res.childAssignmentId,
        status: res.status,
      },
    };
  },
};
