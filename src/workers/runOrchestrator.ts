import { Worker, Job } from "bullmq";
import { Prisma } from "../generated/prisma/client";
import { redis } from "../lib/redis";
import { QUEUE_NAMES, RunExecutionJobData } from "../lib/queue";
import { prisma } from "../lib/prisma";
import { publishRunEvent } from "../lib/events";
import { executePlanner } from "../services/planner";
import {
  executeLoop,
  getToolDefinitions,
  ExecutorContext,
  ExecutorResult,
} from "../services/executor";
import {
  memoryClient,
  MemorySearchResult,
} from "../services/memory/memoryClient";
import { distillationClient } from "../services/memory/distillationClient";
import {
  fetchInstructions,
  ConfigInstruction,
} from "../services/instructionClient";
import {
  fetchAssignmentConfig,
  createLLMClientFromConfig,
} from "../services/llm/assignmentConfigClient";
import { compactHistory } from "../services/llm/compaction";
import {
  PROMPTSET_HASH,
  PROMPTSET_VERSION,
  formatToolLines,
  renderPrompt,
  staticPrompt,
} from "../prompts";
import {
  LLMMessage,
  LLMToolDefinition,
  TokenAccumulator,
  createTokenAccumulator,
  accumulateTokens,
} from "../types/llm";
import {
  buildInstructionPrefix,
  buildKnowledgeSuffix,
} from "../services/memory/memoryFormatter";
import {
  createComponentLogger,
  createRunLogger,
  logCanonical,
} from "../lib/logger";
import { runsTotal, runDuration, llmTokensTotal } from "../lib/promMetrics";
import { metrics } from "../lib/metrics";

const log = createComponentLogger("worker");

/**
 * Build the zero-step direct-response system prompt.
 *
 * Lifted verbatim out of the orchestrator body so it can be compared against
 * renderPrompt("direct.system", ...) in src/prompts/equivalence.test.ts. `now` is injected
 * for the same reason the executor's is: without it no two renders are equal.
 *
 * This prompt deliberately still carries no FORMATTING, ASSUMPTIONS or SECURITY block,
 * matching pre-extraction behaviour exactly. Aligning it with the executor prompt changes
 * output and is a separate, eval-measured change.
 */
export function buildDirectSystemPrompt(args: {
  configInstructions: ConfigInstruction[];
  memories: MemorySearchResult[];
  tools: LLMToolDefinition[];
  clientType?: string;
  now?: Date;
}): string {
  const { configInstructions, memories, tools, clientType } = args;
  const now = args.now ?? new Date();
  const knowledgeSuffix = buildKnowledgeSuffix(memories);

  // Prompt text lives in prompts/direct.system.md and its fragments.
  return renderPrompt("direct.system", {
    instructionPrefix: buildInstructionPrefix(configInstructions, memories),
    now: now.toUTCString(),
    knowledgeSuffix,
    noParrotRule: knowledgeSuffix
      ? `\n${staticPrompt("frag.no-parrot-direct")}`
      : "",
    completionInstruction:
      clientType === "cli"
        ? staticPrompt("frag.completion-direct-cli")
        : staticPrompt("frag.completion-direct-web"),
    // The tool list makes the model aware of what it has (built-in + MCP-discovered) so it
    // answers capability questions instead of claiming it lacks access.
    toolList: tools.length
      ? `\n${renderPrompt("frag.direct-tool-list", {
          toolList: formatToolLines(tools),
        })}`
      : "",
  });
}

/**
 * Check if a run has been cancelled
 */
const isCancelled = async (runId: string): Promise<boolean> => {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { cancel_requested: true },
  });
  return run?.cancel_requested ?? false;
};

/**
 * Mark a run as cancelled
 */
const markCancelled = async (runId: string): Promise<void> => {
  await prisma.run.update({
    where: { id: runId },
    data: { status: "cancelled", ended_at: new Date() },
  });
  runsTotal.inc({ status: "cancelled" });
  metrics.incRunCancelled();
  await publishRunEvent(runId, {
    type: "run.cancelled",
    data: { run_id: runId },
  });
};

/**
 * Mark a run as failed
 */
const markFailed = async (runId: string, error: string): Promise<void> => {
  await prisma.run.update({
    where: { id: runId },
    data: { status: "failed", ended_at: new Date(), error },
  });
  runsTotal.inc({ status: "failed" });
  metrics.incRunFailed();
  await publishRunEvent(runId, {
    type: "run.failed",
    data: { run_id: runId, error },
  });
};

/**
 * Process a run execution job
 */
const processRunExecution = async (job: Job<RunExecutionJobData>) => {
  const {
    runId,
    assignmentId,
    userId: jobUserId,
    accessToken,
    clientType,
    evalMode,
  } = job.data;

  const runLog = createRunLogger(runId);
  const runStartTime = Date.now();

  // 1. Check if run exists and hasn't been cancelled
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) {
    runLog.warn("Run not found, skipping");
    return;
  }

  if (run.cancel_requested || run.status === "cancelled") {
    await markCancelled(runId);
    return;
  }

  try {
    // 2. Update status to running (model_name resolved after config fetch below)
    await prisma.run.update({
      where: { id: runId },
      data: { status: "running", started_at: new Date() },
    });
    await publishRunEvent(runId, {
      type: "run.status",
      data: { status: "running" },
    });
    runLog.info(
      {
        assignment_id: assignmentId,
        user_id: run.user_id || jobUserId || "anonymous",
      },
      "Run started",
    );

    // 3. Load assignment context (messages + settings)
    // Limit to recent messages to stay within small model's effective attention span
    const MAX_HISTORY_MESSAGES = parseInt(
      process.env.MAX_HISTORY_MESSAGES || "10",
    );

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { settings: true },
    });
    const assignmentSettings =
      (assignment?.settings as Record<string, unknown>) ?? {};
    const enable_replanning = Boolean(
      assignmentSettings.enable_replanning ?? false,
    );
    const replan_interval = Number(assignmentSettings.replan_interval ?? 0);

    const allMessages = await prisma.message.findMany({
      where: { assignment_id: assignmentId },
      orderBy: { created_at: "asc" },
    });

    // Check cancellation before planning
    if (await isCancelled(runId)) {
      await markCancelled(runId);
      return;
    }

    // Use the full history; compaction (below, after the LLM client is resolved)
    // summarizes older turns into a rolling summary instead of truncating them.
    const messages = allMessages;

    // Convert messages to LLM format
    let llmMessages: LLMMessage[] = messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system" | "tool",
      content: m.content,
    }));

    // Get user ID from the run record or job data
    const userId = run.user_id || jobUserId || "";

    // 3.5. Fetch LLM assignment configs + instructions in parallel with memory retrieval
    const [
      plannerConfigResult,
      executorConfigResult,
      configInstructionsResult,
    ] = await Promise.allSettled([
      accessToken
        ? fetchAssignmentConfig("agent_plan", accessToken)
        : Promise.resolve(null),
      accessToken
        ? fetchAssignmentConfig("agent_execution", accessToken)
        : Promise.resolve(null),
      accessToken ? fetchInstructions(accessToken) : Promise.resolve([]),
    ]);

    const plannerLLMClient = createLLMClientFromConfig(
      plannerConfigResult.status === "fulfilled"
        ? plannerConfigResult.value
        : null,
    );
    const executorLLMClient = createLLMClientFromConfig(
      executorConfigResult.status === "fulfilled"
        ? executorConfigResult.value
        : null,
    );
    const configInstructionsPromise: Promise<ConfigInstruction[]> =
      Promise.resolve(
        configInstructionsResult.status === "fulfilled"
          ? configInstructionsResult.value
          : [],
      );

    // Resolve the model name actually used — org-specific if an assignment was found,
    // otherwise fall back to the env-var default. Planner config drives the display name.
    const resolvedAgentModel =
      plannerConfigResult.status === "fulfilled" &&
      plannerConfigResult.value?.model
        ? plannerConfigResult.value.model
        : process.env.OLLAMA_MODEL || "unknown";

    runLog.info(
      {
        planner_provider:
          plannerConfigResult.status === "fulfilled" &&
          plannerConfigResult.value
            ? plannerConfigResult.value.provider
            : "boucio-fallback",
        executor_provider:
          executorConfigResult.status === "fulfilled" &&
          executorConfigResult.value
            ? executorConfigResult.value.provider
            : "boucio-fallback",
        resolved_model: resolvedAgentModel,
      },
      "LLM assignment configs resolved",
    );

    // Long-horizon context: compact older turns into a rolling summary (using the
    // executor LLM) instead of truncating them, so earlier context survives.
    try {
      const compaction = await compactHistory(llmMessages, executorLLMClient, {
        model: resolvedAgentModel,
        keepRecent: MAX_HISTORY_MESSAGES,
      });
      if (compaction.summarizedCount > 0) {
        llmMessages = compaction.messages;
        runLog.info(
          {
            summarized: compaction.summarizedCount,
            compacted: compaction.compacted,
          },
          compaction.compacted
            ? "Conversation history compacted into rolling summary"
            : "Conversation history truncated (summarizer unavailable)",
        );
      }
    } catch (err) {
      runLog.warn({ err }, "History compaction failed — using full history");
    }

    // Memory retrieval - tiered hybrid retrieval
    let memories: MemorySearchResult[] = [];
    if (memoryClient.isEnabled()) {
      const lastUserMsg = llmMessages.filter((m) => m.role === "user").pop();
      if (lastUserMsg) {
        const results = await memoryClient.retrieveMemories(
          lastUserMsg.content,
          assignmentId,
          userId,
          accessToken,
        );
        memories = results;

        // Persist snapshot with memory IDs
        const snapshotData = {
          memories_used: results.map((r) => r.id),
          memories_count: results.length,
        };
        await prisma.run.update({
          where: { id: runId },
          data: { snapshot: snapshotData as Prisma.InputJsonValue },
        });

        await publishRunEvent(runId, {
          type: "run.snapshot",
          data: {
            memories_count: results.length,
            memories: results.map((r) => ({
              id: r.id,
              content: r.content.slice(0, 200),
            })),
          },
        });
      }
    }

    // Load tool definitions (used by both planner and executor)
    // Client-side tools (bash, read_file, etc.) are only included for CLI clients.
    const tools = await getToolDefinitions(clientType);

    // Await config instructions (fetch started in parallel with memory retrieval above)
    const configInstructions = await configInstructionsPromise;
    runLog.info(
      { count: configInstructions.length },
      "Config instructions loaded",
    );

    // 4. Phase 1: Planner - analyze context and create execution plan
    runLog.info({ assignment_id: assignmentId }, "Phase: planner started");
    const plannerStartTime = Date.now();
    const {
      plan,
      rawResponse: plannerReasoning,
      tokenUsage: plannerTokens,
    } = await executePlanner(
      llmMessages,
      memories,
      tools,
      runId,
      configInstructions,
      plannerLLMClient,
    );
    logCanonical(runLog, "Phase: planner completed", {
      duration_ms: Date.now() - plannerStartTime,
      status: "success",
      metrics: {
        llm_calls: plannerTokens.llm_calls,
        prompt_tokens: plannerTokens.prompt_tokens,
        completion_tokens: plannerTokens.completion_tokens,
        plan_steps: plan.steps.length,
      },
    });

    // Publish planner's raw LLM reasoning before the structured plan
    if (plannerReasoning) {
      await publishRunEvent(runId, {
        type: "step.reasoning",
        data: {
          step_index: 0,
          content: plannerReasoning,
          summary:
            "Planning phase: analyzing request and creating execution plan",
        },
      });
    }

    // Serialize plan for Prisma JSON storage
    const planJson = {
      goal: plan.goal,
      steps: plan.steps.map((s) => ({
        id: s.id,
        description: s.description,
        tool_intent: s.tool_intent,
      })),
    };

    // Persist plan
    await prisma.run.update({
      where: { id: runId },
      data: { plan: planJson as Prisma.InputJsonValue },
    });
    await prisma.runStep.create({
      data: {
        run_id: runId,
        step_index: 0,
        type: "plan",
        output: {
          ...planJson,
          raw_reasoning: plannerReasoning || null,
        } as Prisma.InputJsonValue,
      },
    });
    await publishRunEvent(runId, {
      type: "plan.created",
      data: {
        goal: plan.goal,
        steps_count: plan.steps.length,
        steps: planJson.steps,
      },
    });

    // Check cancellation before execution
    if (await isCancelled(runId)) {
      await markCancelled(runId);
      return;
    }

    // 5. Phase 2: Execute — direct response for zero-step plans, full executor otherwise
    let finalResponse: string;
    let executorTokens: TokenAccumulator;

    const phaseStartTime = Date.now();
    if (plan.steps.length === 0) {
      runLog.info(
        { assignment_id: assignmentId },
        "Phase: direct response (zero-step plan)",
      );
      const directSystemPrompt = buildDirectSystemPrompt({
        configInstructions,
        memories,
        tools,
        clientType,
      });
      const directMessages: LLMMessage[] = [
        { role: "system", content: directSystemPrompt },
        ...llmMessages,
      ];
      const directResponse = await executorLLMClient.chat(directMessages, {
        think: false,
      });
      finalResponse = directResponse.content || "";
      executorTokens = createTokenAccumulator();
      accumulateTokens(executorTokens, directResponse.usage);
      logCanonical(runLog, "Phase: direct response completed", {
        duration_ms: Date.now() - phaseStartTime,
        status: "success",
        metrics: {
          llm_calls: executorTokens.llm_calls,
          prompt_tokens: executorTokens.prompt_tokens,
          completion_tokens: executorTokens.completion_tokens,
        },
      });
    } else {
      const executorContext: ExecutorContext = {
        runId,
        assignmentId,
        messages: llmMessages,
        plan,
        tools,
        userId,
        memories,
        configInstructions,
        enable_replanning,
        replan_interval,
        llmClient: executorLLMClient,
        clientType,
        model: resolvedAgentModel,
        accessToken,
        evalMode,
      };
      runLog.info(
        { assignment_id: assignmentId, plan_steps: plan.steps.length },
        "Phase: executor started",
      );
      const executorResult = await executeLoop(executorContext);
      finalResponse = executorResult.finalResponse;
      executorTokens = executorResult.tokenUsage;
      logCanonical(runLog, "Phase: executor completed", {
        duration_ms: Date.now() - phaseStartTime,
        status: "success",
        metrics: {
          llm_calls: executorTokens.llm_calls,
          prompt_tokens: executorTokens.prompt_tokens,
          completion_tokens: executorTokens.completion_tokens,
        },
      });
    }

    // Merge token usage from planner + executor phases
    const runTokens = {
      prompt_tokens: plannerTokens.prompt_tokens + executorTokens.prompt_tokens,
      completion_tokens:
        plannerTokens.completion_tokens + executorTokens.completion_tokens,
      total_tokens: plannerTokens.total_tokens + executorTokens.total_tokens,
      llm_calls: plannerTokens.llm_calls + executorTokens.llm_calls,
    };

    // Create assistant message
    await prisma.message.create({
      data: {
        assignment_id: assignmentId,
        role: "assistant",
        content: finalResponse,
        provenance: { run_id: runId },
      },
    });
    await publishRunEvent(runId, {
      type: "message.created",
      data: { role: "assistant", content: finalResponse },
    });

    // 6. Mark completed and persist token usage + resolved model name
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: "completed",
        ended_at: new Date(),
        model_name: resolvedAgentModel,
        promptset_version: PROMPTSET_VERSION,
        promptset_hash: PROMPTSET_HASH,
        prompt_tokens: runTokens.prompt_tokens,
        completion_tokens: runTokens.completion_tokens,
        total_tokens: runTokens.total_tokens,
        llm_calls: runTokens.llm_calls,
      },
    });

    // Observability: record run outcome, duration, and token usage.
    const runDurationMs = Date.now() - runStartTime;
    runsTotal.inc({ status: "completed" });
    runDuration.observe(runDurationMs / 1000);
    llmTokensTotal.inc({ kind: "prompt" }, runTokens.prompt_tokens);
    llmTokensTotal.inc({ kind: "completion" }, runTokens.completion_tokens);
    metrics.incRunCompleted(runDurationMs);

    // Emit token usage event before run.completed so consumers can track it
    await publishRunEvent(runId, {
      type: "run.usage",
      data: {
        run_id: runId,
        prompt_tokens: runTokens.prompt_tokens,
        completion_tokens: runTokens.completion_tokens,
        total_tokens: runTokens.total_tokens,
        llm_calls: runTokens.llm_calls,
      },
    });

    await publishRunEvent(runId, {
      type: "run.completed",
      data: {
        run_id: runId,
        token_usage: runTokens,
      },
    });

    // 7. Trigger distillation (async, non-blocking)
    if (distillationClient.isEnabled()) {
      distillationClient
        .triggerDistillation(
          {
            source: {
              type: "agent",
              id: assignmentId,
            },
            context: {
              messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
            },
            metadata: {
              run_id: runId,
              user_id: userId,
            },
            options: {
              max_memories: 10,
            },
          },
          accessToken,
        )
        .catch((err) => runLog.error({ err }, "Distillation trigger failed"));

      await publishRunEvent(runId, {
        type: "distill.triggered",
        data: { run_id: runId },
      });
    }

    logCanonical(runLog, "Run completed", {
      duration_ms: Date.now() - runStartTime,
      status: "success",
      metrics: {
        prompt_tokens: runTokens.prompt_tokens,
        completion_tokens: runTokens.completion_tokens,
        total_tokens: runTokens.total_tokens,
        llm_calls: runTokens.llm_calls,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    runLog.error(
      {
        err: error,
        assignment_id: assignmentId,
        duration_ms: Date.now() - runStartTime,
      },
      "Run failed",
    );
    await markFailed(runId, errorMessage);
    throw error; // Re-throw for BullMQ retry logic
  }
};

/**
 * Create and return the Run Orchestrator worker
 */
export const createRunOrchestratorWorker =
  (): Worker<RunExecutionJobData> | null => {
    if (!redis) {
      log.warn("Redis not available, run orchestrator worker not started");
      return null;
    }

    const worker = new Worker<RunExecutionJobData>(
      QUEUE_NAMES.RUN_EXECUTION,
      processRunExecution,
      {
        connection: redis,
        concurrency: 5, // Process up to 5 runs concurrently
      },
    );

    worker.on("completed", (job) => {
      log.info({ jobId: job.id, runId: job.data.runId }, "Job completed");
    });

    worker.on("failed", (job, err) => {
      log.error({ jobId: job?.id, runId: job?.data.runId, err }, "Job failed");
    });

    worker.on("error", (err) => {
      log.error({ err }, "Worker error");
    });

    return worker;
  };
