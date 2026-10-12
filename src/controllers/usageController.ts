import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getUserContextFromRequest } from "../lib/auth";
import { createComponentLogger } from "../lib/logger";

const log = createComponentLogger("usage-controller");

/**
 * GET /v1/usage
 * Returns aggregate token usage for the authenticated user across all completed runs.
 * Scoped by org_id when present in the JWT.
 */
export const getUserUsage = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }
  const { userId, orgId } = ctx;
  const where = {
    user_id: userId,
    status: "completed",
    ...(orgId && { org_id: orgId }),
  };

  try {
    const aggregate = await prisma.run.aggregate({
      where,
      _sum: {
        prompt_tokens: true,
        completion_tokens: true,
        total_tokens: true,
        llm_calls: true,
      },
      _count: { id: true },
    });

    const byAssignment = await prisma.run.groupBy({
      by: ["assignment_id"],
      where,
      _sum: {
        prompt_tokens: true,
        completion_tokens: true,
        total_tokens: true,
        llm_calls: true,
      },
      _count: { id: true },
      orderBy: { _sum: { total_tokens: "desc" } },
    });

    res.json({
      user_id: userId,
      org_id: orgId,
      totals: {
        prompt_tokens: aggregate._sum.prompt_tokens ?? 0,
        completion_tokens: aggregate._sum.completion_tokens ?? 0,
        total_tokens: aggregate._sum.total_tokens ?? 0,
        llm_calls: aggregate._sum.llm_calls ?? 0,
        completed_runs: aggregate._count.id ?? 0,
      },
      by_assignment: byAssignment.map((row) => ({
        assignment_id: row.assignment_id,
        prompt_tokens: row._sum.prompt_tokens ?? 0,
        completion_tokens: row._sum.completion_tokens ?? 0,
        total_tokens: row._sum.total_tokens ?? 0,
        llm_calls: row._sum.llm_calls ?? 0,
        completed_runs: row._count.id ?? 0,
      })),
    });
  } catch (error) {
    log.error({ err: error }, "Error getting user usage");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to get usage" },
    });
  }
};

/**
 * GET /v1/usage/assignments/:assignmentId
 * Returns per-run token breakdown for a specific assignment.
 */
export const getAssignmentUsage = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }
  const { userId, orgId } = ctx;

  const assignmentId = String(req.params.assignmentId);

  try {
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        user_id: userId,
        ...(orgId && { org_id: orgId }),
      },
    });
    if (!assignment) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Assignment not found" },
      });
    }

    const aggregate = await prisma.run.aggregate({
      where: { assignment_id: assignmentId, status: "completed" },
      _sum: {
        prompt_tokens: true,
        completion_tokens: true,
        total_tokens: true,
        llm_calls: true,
      },
      _count: { id: true },
    });

    const runs = await prisma.run.findMany({
      where: { assignment_id: assignmentId, status: "completed" },
      select: {
        id: true,
        created_at: true,
        ended_at: true,
        prompt_tokens: true,
        completion_tokens: true,
        total_tokens: true,
        llm_calls: true,
      },
      orderBy: { created_at: "desc" },
    });

    res.json({
      assignment_id: assignmentId,
      totals: {
        prompt_tokens: aggregate._sum.prompt_tokens ?? 0,
        completion_tokens: aggregate._sum.completion_tokens ?? 0,
        total_tokens: aggregate._sum.total_tokens ?? 0,
        llm_calls: aggregate._sum.llm_calls ?? 0,
        completed_runs: aggregate._count.id ?? 0,
      },
      runs: runs.map((r) => ({
        run_id: r.id,
        created_at: r.created_at.toISOString(),
        ended_at: r.ended_at?.toISOString() ?? null,
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.completion_tokens,
        total_tokens: r.total_tokens,
        llm_calls: r.llm_calls,
      })),
    });
  } catch (error) {
    log.error({ err: error }, "Error getting assignment usage");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to get assignment usage",
      },
    });
  }
};
