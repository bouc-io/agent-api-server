import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { getUserIdFromRequest, getUserContextFromRequest } from "../lib/auth";
import { enqueueRunExecution } from "../lib/queue";
import { createComponentLogger } from "../lib/logger";

const log = createComponentLogger("run-controller");
import {
  RunResponse,
  CreateRunResponse,
  RunDetailResponse,
  RunsListResponse,
  ApproveRunRequest,
} from "../types/run";

/**
 * Helper to format a run for API response
 */
const formatRunResponse = (run: {
  id: string;
  assignment_id: string;
  status: string;
  agent_id: string;
  cancel_requested: boolean;
  plan: unknown;
  snapshot: unknown;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  error: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  llm_calls: number;
  model_name?: string | null;
}): RunResponse => ({
  id: run.id,
  assignment_id: run.assignment_id,
  status: run.status as RunResponse["status"],
  agent_id: run.agent_id,
  cancel_requested: run.cancel_requested,
  plan: run.plan as RunResponse["plan"],
  snapshot: run.snapshot as Record<string, unknown>,
  created_at: run.created_at.toISOString(),
  started_at: run.started_at?.toISOString() || null,
  ended_at: run.ended_at?.toISOString() || null,
  error: run.error,
  prompt_tokens: run.prompt_tokens,
  completion_tokens: run.completion_tokens,
  total_tokens: run.total_tokens,
  llm_calls: run.llm_calls,
  model_name: run.model_name ?? null,
});

/**
 * Create a new run for an assignment
 * POST /v1/assignments/:assignmentId/runs
 */
export const createRun = async (req: Request, res: Response) => {
  const userContext = getUserContextFromRequest(req);
  if (!userContext) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }
  const { userId, orgId, accessToken } = userContext;

  const assignmentId = String(req.params.assignmentId);
  const {
    agent_id = "default",
    trigger_message_id,
    client_type,
    eval_mode,
  } = req.body;
  const clientType = (client_type as string) || "web";
  // Opt-in flag for headless eval harnesses; only takes effect when the server
  // sets EVAL_AUTO_APPROVE=true (enforced in the executor). Ignored in production.
  const evalMode = eval_mode === true;

  try {
    // Verify assignment exists and belongs to user
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, user_id: userId },
    });
    if (!assignment) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Assignment not found" },
      });
    }

    // Check for existing active run (one active run per assignment)
    const activeRun = await prisma.run.findFirst({
      where: {
        assignment_id: assignmentId,
        status: { in: ["queued", "running"] },
      },
    });
    if (activeRun) {
      return res.status(409).json({
        error: {
          code: "CONFLICT",
          message: "Assignment already has an active run",
        },
        active_run_id: activeRun.id,
      });
    }

    // Validate trigger_message_id if provided
    if (trigger_message_id) {
      const triggerMessage = await prisma.message.findFirst({
        where: {
          id: trigger_message_id,
          assignment_id: assignmentId,
        },
      });
      if (!triggerMessage) {
        return res.status(400).json({
          error: {
            code: "INVALID_TRIGGER_MESSAGE",
            message:
              "Trigger message not found or does not belong to this assignment",
          },
        });
      }
    }

    // Create the run
    const run = await prisma.run.create({
      data: {
        assignment_id: assignmentId,
        user_id: userId,
        org_id: orgId,
        agent_id,
        trigger_message_id: trigger_message_id || null,
        status: "queued",
      },
    });

    // Enqueue for processing
    const jobId = await enqueueRunExecution({
      runId: run.id,
      assignmentId,
      userId,
      orgId: orgId ?? undefined,
      accessToken,
      clientType,
      evalMode,
    });

    if (!jobId) {
      // Queue not available, but run was created - update status to failed
      await prisma.run.update({
        where: { id: run.id },
        data: {
          status: "failed",
          error: "Queue service unavailable",
          ended_at: new Date(),
        },
      });
      return res.status(503).json({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Queue service unavailable",
        },
      });
    }

    const response: CreateRunResponse = {
      run: formatRunResponse(run),
      stream_url: `/v1/assignments/${assignmentId}/runs/${run.id}/stream`,
    };

    res.status(202).json(response);
  } catch (error) {
    log.error({ err: error }, "Error creating run");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to create run" },
    });
  }
};

/**
 * Get a specific run with steps and tool calls
 * GET /v1/assignments/:assignmentId/runs/:runId
 */
export const getRun = async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  const assignmentId = String(req.params.assignmentId);
  const runId = String(req.params.runId);

  try {
    const run = await prisma.run.findFirst({
      where: {
        id: runId,
        assignment_id: assignmentId,
        assignment: { user_id: userId },
      },
      include: {
        steps: { orderBy: { step_index: "asc" } },
        tool_calls: { orderBy: { created_at: "asc" } },
        approval_requests: { orderBy: { created_at: "asc" } },
        feedback: true,
      },
    });

    if (!run) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Run not found" },
      });
    }

    const response: RunDetailResponse = {
      ...formatRunResponse(run),
      steps: run.steps.map((step) => ({
        id: step.id,
        run_id: step.run_id,
        step_index: step.step_index,
        type: step.type as "plan" | "execution" | "tool_call",
        input: step.input as Record<string, unknown> | null,
        output: step.output as Record<string, unknown> | null,
        created_at: step.created_at.toISOString(),
      })),
      tool_calls: run.tool_calls.map((tc) => ({
        id: tc.id,
        run_id: tc.run_id,
        tool_name: tc.tool_name,
        tool_input: tc.tool_input as Record<string, unknown>,
        tool_output: tc.tool_output as Record<string, unknown> | null,
        status: tc.status as "pending" | "running" | "completed" | "failed",
        created_at: tc.created_at.toISOString(),
        ended_at: tc.ended_at?.toISOString() || null,
        duration_ms: tc.duration_ms,
      })),
      approval_requests: run.approval_requests.map((ar) => ({
        id: ar.id,
        run_id: ar.run_id,
        tool_name: ar.tool_name,
        tool_args: ar.tool_args as Record<string, unknown>,
        status: ar.status as "pending" | "approved" | "rejected",
        decided_by: ar.decided_by,
        reason: ar.reason,
        created_at: ar.created_at.toISOString(),
        decided_at: ar.decided_at?.toISOString() || null,
      })),
      feedback: run.feedback
        ? { rating: run.feedback.rating, comment: run.feedback.comment }
        : null,
    };

    res.json(response);
  } catch (error) {
    log.error({ err: error }, "Error getting run");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to get run" },
    });
  }
};

/**
 * List runs for an assignment
 * GET /v1/assignments/:assignmentId/runs
 */
export const listRuns = async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  const assignmentId = String(req.params.assignmentId);
  const { page = 1, limit = 20 } = req.query;

  try {
    // Verify assignment exists and belongs to user
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, user_id: userId },
    });
    if (!assignment) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Assignment not found" },
      });
    }

    const runs = await prisma.run.findMany({
      where: { assignment_id: assignmentId },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
      orderBy: { created_at: "desc" },
    });

    const total = await prisma.run.count({
      where: { assignment_id: assignmentId },
    });

    const response: RunsListResponse = {
      data: runs.map(formatRunResponse),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        total_pages: Math.ceil(total / Number(limit)),
      },
    };

    res.json(response);
  } catch (error) {
    log.error({ err: error }, "Error listing runs");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to list runs" },
    });
  }
};

/**
 * Submit the result of a client-side tool execution.
 * Called by the CLI after it has executed a tool locally (e.g. bash, file ops).
 * Publishes the result to a per-tool-call Redis channel so the executor can resume.
 *
 * POST /v1/assignments/:assignmentId/runs/:runId/tool-results
 * Body: { tool_call_id: string, output?: unknown, error?: string }
 */
export const submitToolResult = async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  const assignmentId = String(req.params.assignmentId);
  const runId = String(req.params.runId);
  const { tool_call_id, output, error: toolError } = req.body;

  if (!tool_call_id) {
    return res.status(400).json({
      error: { code: "BAD_REQUEST", message: "tool_call_id is required" },
    });
  }

  try {
    // Verify the run exists and belongs to this user
    const run = await prisma.run.findFirst({
      where: {
        id: runId,
        assignment_id: assignmentId,
        assignment: { user_id: userId },
      },
      select: { status: true },
    });

    if (!run) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Run not found" },
      });
    }

    if (run.status !== "running") {
      return res.status(409).json({
        error: {
          code: "CONFLICT",
          message: `Run is '${run.status}' and cannot accept tool results`,
        },
      });
    }

    if (!redis) {
      return res.status(503).json({
        error: { code: "SERVICE_UNAVAILABLE", message: "Redis not available" },
      });
    }

    // Publish result to the channel the executor is waiting on
    const channel = `run:${runId}:tool-client-result:${tool_call_id}`;
    const payload = JSON.stringify({
      output: output ?? null,
      error: toolError ?? undefined,
    });
    await redis.publish(channel, payload);

    res.status(204).send();
  } catch (error) {
    log.error({ err: error }, "Error submitting client tool result");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to submit tool result",
      },
    });
  }
};

/**
 * Cancel a run
 * POST /v1/assignments/:assignmentId/runs/:runId/cancel
 */
export const cancelRun = async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  const assignmentId = String(req.params.assignmentId);
  const runId = String(req.params.runId);

  try {
    // Update only if run belongs to user and is in a cancellable state
    // pending_approval is also cancellable — the executor poll will detect the flag and abort
    const result = await prisma.run.updateMany({
      where: {
        id: runId,
        assignment_id: assignmentId,
        assignment: { user_id: userId },
        status: { in: ["queued", "running", "pending_approval"] },
      },
      data: { cancel_requested: true },
    });

    if (result.count === 0) {
      // Check if run exists but is not cancellable
      const run = await prisma.run.findFirst({
        where: {
          id: runId,
          assignment_id: assignmentId,
          assignment: { user_id: userId },
        },
      });

      if (!run) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Run not found" },
        });
      }

      return res.status(409).json({
        error: {
          code: "CONFLICT",
          message: `Run is already ${run.status} and cannot be cancelled`,
        },
      });
    }

    res.status(202).json({ message: "Cancel requested" });
  } catch (error) {
    log.error({ err: error }, "Error cancelling run");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to cancel run" },
    });
  }
};

/**
 * Submit a human approval or rejection for a pending tool execution.
 * The executor is parked on a Redis channel; publishing here resumes it.
 *
 * POST /v1/assignments/:assignmentId/runs/:runId/approve
 * Body: { approval_request_id: string, approved: boolean, reason?: string }
 */
export const approveRun = async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  const assignmentId = String(req.params.assignmentId);
  const runId = String(req.params.runId);
  const { approval_request_id, approved, reason } =
    req.body as ApproveRunRequest;

  if (!approval_request_id || typeof approved !== "boolean") {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "approval_request_id and approved (boolean) are required",
      },
    });
  }

  try {
    // Verify run belongs to user and is pending approval
    const run = await prisma.run.findFirst({
      where: {
        id: runId,
        assignment_id: assignmentId,
        assignment: { user_id: userId },
      },
      select: { status: true },
    });

    if (!run) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Run not found" },
      });
    }

    if (run.status !== "pending_approval") {
      return res.status(409).json({
        error: {
          code: "CONFLICT",
          message: `Run is '${run.status}' and is not awaiting approval`,
        },
      });
    }

    // Find and verify the approval request
    const approvalRequest = await prisma.approvalRequest.findFirst({
      where: { id: approval_request_id, run_id: runId, status: "pending" },
    });

    if (!approvalRequest) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Approval request not found or already resolved",
        },
      });
    }

    // Update the approval request record
    await prisma.approvalRequest.update({
      where: { id: approval_request_id },
      data: {
        status: approved ? "approved" : "rejected",
        decided_by: userId,
        reason: reason ?? null,
        decided_at: new Date(),
      },
    });

    if (!redis) {
      return res.status(503).json({
        error: { code: "SERVICE_UNAVAILABLE", message: "Redis not available" },
      });
    }

    // Publish decision to the channel the executor is waiting on
    const channel = `run:${runId}:approval-result:${approval_request_id}`;
    await redis.publish(
      channel,
      JSON.stringify({ approved, reason: reason ?? null }),
    );

    log.info(
      {
        runId,
        approvalRequestId: approval_request_id,
        approved,
        decidedBy: userId,
      },
      "Approval decision submitted",
    );

    res.status(204).send();
  } catch (error) {
    log.error({ err: error }, "Error submitting approval decision");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to submit approval decision",
      },
    });
  }
};

/**
 * List approval requests for a run (pending and historical).
 *
 * GET /v1/assignments/:assignmentId/runs/:runId/approvals
 */
export const listApprovals = async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  const assignmentId = String(req.params.assignmentId);
  const runId = String(req.params.runId);

  try {
    const run = await prisma.run.findFirst({
      where: {
        id: runId,
        assignment_id: assignmentId,
        assignment: { user_id: userId },
      },
      select: { id: true },
    });

    if (!run) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Run not found" },
      });
    }

    const approvals = await prisma.approvalRequest.findMany({
      where: { run_id: runId },
      orderBy: { created_at: "asc" },
    });

    res.json({
      data: approvals.map((ar) => ({
        id: ar.id,
        run_id: ar.run_id,
        tool_name: ar.tool_name,
        tool_args: ar.tool_args as Record<string, unknown>,
        status: ar.status,
        decided_by: ar.decided_by,
        reason: ar.reason,
        created_at: ar.created_at.toISOString(),
        decided_at: ar.decided_at?.toISOString() || null,
      })),
    });
  } catch (error) {
    log.error({ err: error }, "Error listing approvals");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to list approvals" },
    });
  }
};

/**
 * Submit thumbs up/down feedback for a completed run.
 *
 * POST /v1/assignments/:assignmentId/runs/:runId/feedback
 */
export const submitFeedback = async (req: Request, res: Response) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid token" },
    });
  }

  const assignmentId = String(req.params.assignmentId);
  const runId = String(req.params.runId);
  const { rating, comment } = req.body as { rating: string; comment?: string };

  if (!rating || !["positive", "negative"].includes(rating)) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "rating must be 'positive' or 'negative'",
      },
    });
  }

  try {
    const run = await prisma.run.findFirst({
      where: {
        id: runId,
        assignment_id: assignmentId,
        assignment: { user_id: userId },
      },
      select: { status: true },
    });

    if (!run) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Run not found" },
      });
    }

    await prisma.runFeedback.upsert({
      where: { run_id: runId },
      create: { run_id: runId, rating, comment: comment ?? null },
      update: { rating, comment: comment ?? null },
    });

    log.info({ runId, rating }, "Feedback submitted");
    res.status(204).send();
  } catch (error) {
    log.error({ err: error }, "Error submitting feedback");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to submit feedback" },
    });
  }
};
