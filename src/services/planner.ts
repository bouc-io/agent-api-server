import {
  LLMClient,
  LLMMessage,
  LLMToolDefinition,
  Plan,
  TokenAccumulator,
  createTokenAccumulator,
  accumulateTokens,
} from "../types/llm";
import { BoucioClient } from "./llm/boucioClient";
import { createComponentLogger, logCanonical } from "../lib/logger";
import { formatToolLines, renderPrompt, staticPrompt } from "../prompts";
import { recordLLMRequestPayload } from "../lib/llmPayload";
import { MemorySearchResult } from "./memory/memoryClient";
import {
  buildInstructionPrefix,
  buildKnowledgeSuffix,
} from "./memory/memoryFormatter";
import { ConfigInstruction } from "./instructionClient";

const log = createComponentLogger("planner");

/**
 * Result from the planner phase, including the raw LLM response for reasoning display
 */
export interface PlannerResult {
  plan: Plan;
  rawResponse: string;
  tokenUsage: TokenAccumulator;
}

/**
 * Result from the re-planner check
 */
export interface ReplannerResult {
  revised: boolean;
  plan?: Plan;
  reason: string;
  tokenUsage: TokenAccumulator;
}

/**
 * Build the full planner system prompt, optionally including available tool info and a
 * memory-context hint.
 *
 * Prompt text lives in prompts/planner.system.md, prompts/planner.memory-context.md and
 * prompts/planner.tool-list.md; this function only decides which optional blocks apply.
 * When hasMemoryContext is true the memory-context examples are appended, which teach the
 * planner that questions already answerable from the injected USER PROFILE / KNOWN FACTS
 * should produce an empty steps array rather than a memory_search step.
 */
export function buildPlannerPrompt(
  tools?: LLMToolDefinition[],
  hasMemoryContext?: boolean,
): string {
  let prompt = staticPrompt("planner.system");

  if (hasMemoryContext) {
    prompt += `\n\n${staticPrompt("planner.memory-context")}`;
  }

  if (!tools || tools.length === 0) {
    return prompt;
  }

  return `${prompt}\n\n${renderPrompt("planner.tool-list", {
    toolList: formatToolLines(tools),
  })}`;
}

/**
 * Extract JSON from LLM response text
 * Handles markdown code blocks and raw JSON
 */
function extractJSON(text: string): Plan {
  // Try to extract JSON from markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]) as Plan;
    } catch {
      // Fall through to balanced-brace extraction
    }
  }

  // Find the first balanced JSON object by counting braces
  // This avoids the greedy regex problem where extra text after the JSON
  // (e.g. LLM prose with embedded code blocks) causes the match to fail
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Plan;
        } catch {
          break;
        }
      }
    }
  }

  // Return default plan if parsing fails
  return {
    goal: "Unable to parse plan from response",
    steps: [{ id: 1, description: "Generate response", tool_intent: null }],
  };
}

/**
 * Validate and simplify the plan
 * Detects common small-LLM planning errors:
 * - Multiple steps using the same tool that could be combined
 * - Steps that re-compute values already known from conversation
 */
function validateAndSimplifyPlan(plan: Plan): Plan {
  const steps = plan.steps;
  if (!Array.isArray(steps) || steps.length <= 1) return plan;

  // Detect over-decomposition: all steps use the same tool
  const toolIntents = steps.map((s) => s.tool_intent).filter(Boolean);
  const uniqueTools = new Set(toolIntents);

  if (uniqueTools.size === 1 && toolIntents.length === steps.length) {
    const hasDecompositionKeywords = steps.some((s) =>
      /result of step|step \d|previous step|then add|then multiply|then divide|then subtract/i.test(
        s.description,
      ),
    );

    if (hasDecompositionKeywords) {
      log.warn(
        {
          goal: plan.goal,
          stepCount: steps.length,
          tool: toolIntents[0],
          steps: steps.map((s) => s.description),
        },
        "Plan over-decomposition detected — collapsing into single step",
      );

      // Auto-fix: collapse multi-step same-tool plans into a single step
      return {
        goal: plan.goal,
        steps: [
          {
            id: 1,
            description: plan.goal,
            tool_intent: toolIntents[0] as string,
          },
        ],
      };
    }
  }

  // Detect re-computation: goal mentions "previous result" but plan has >1 step
  const goalLower = plan.goal.toLowerCase();
  const referencesResult =
    goalLower.includes("result of") ||
    goalLower.includes("previous") ||
    goalLower.includes("to that") ||
    goalLower.includes("to it");

  if (referencesResult && steps.length > 1) {
    log.warn(
      { goal: plan.goal, stepCount: steps.length },
      "Plan references a previous result but has multiple steps — collapsing to single step",
    );

    // Auto-fix: use the last step (which typically has the final computation)
    // and rewrite its description to use the goal
    const lastStep = steps[steps.length - 1];
    return {
      goal: plan.goal,
      steps: [
        { id: 1, description: plan.goal, tool_intent: lastStep.tool_intent },
      ],
    };
  }

  return plan;
}

/**
 * Execute the Planner phase
 * Analyzes conversation context and generates a structured execution plan
 *
 * @param conversationMessages - The conversation history
 * @param memories - Optional relevant memories to include as context
 * @returns A PlannerResult containing the structured plan and raw LLM response
 */
export async function executePlanner(
  conversationMessages: LLMMessage[],
  memories: MemorySearchResult[] = [],
  tools?: LLMToolDefinition[],
  runId?: string,
  configInstructions: ConfigInstruction[] = [],
  llmClient?: LLMClient,
): Promise<PlannerResult> {
  // Fallback for callers that don't inject a client (e.g. tests); runOrchestrator always provides one.
  const client: LLMClient = llmClient ?? new BoucioClient(null);
  const planLog = runId ? log.child({ run_id: runId }) : log;
  const plannerStart = Date.now();
  planLog.info(
    { tool_count: tools?.length ?? 0, memory_count: memories.length },
    "Planner: started",
  );

  // Config instructions (global+org+personal) first, then memory-captured instructions
  const instructionPrefix = buildInstructionPrefix(
    configInstructions,
    memories,
  );
  const knowledgeSuffix = buildKnowledgeSuffix(memories);

  // Construct messages for the planner
  const plannerPrompt = buildPlannerPrompt(tools, memories.length > 0);
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: instructionPrefix + plannerPrompt + knowledgeSuffix,
    },
    ...conversationMessages,
    {
      role: "user",
      content: staticPrompt("planner.nudge"),
    },
  ];

  planLog.debug(
    {
      conversationMessageCount: conversationMessages.length,
      memoriesCount: memories.length,
      toolCount: tools?.length ?? 0,
      systemPromptLength: plannerPrompt.length,
    },
    "Planner: sending request to LLM",
  );
  recordLLMRequestPayload(planLog, "planner", messages, { runId });

  const tokenUsage = createTokenAccumulator();

  // Call LLM with lower temperature for structured output.
  // think: false suppresses Qwen3 chain-of-thought at the Ollama API level,
  // preventing the model from burning all 1024 tokens inside <think> blocks.
  const response = await client.chat(messages, {
    temperature: 0.3,
    max_tokens: 1024,
    think: false,
  });
  accumulateTokens(tokenUsage, response.usage);

  const rawResponse = response.content || "";

  planLog.debug(
    {
      rawResponse:
        rawResponse.slice(0, 1000) +
        (rawResponse.length > 1000 ? "... [truncated]" : ""),
    },
    "Planner: raw LLM response",
  );

  // Parse and validate the plan
  let rawPlan = extractJSON(rawResponse || "{}");

  // Retry with simplified prompt if parsing returned the fallback plan OR if the
  // LLM returned empty content (e.g. Qwen3 think-mode token exhaustion where the
  // model spends all tokens reasoning and produces no actual JSON output).
  if (!rawPlan.goal || rawPlan.goal === "Unable to parse plan from response") {
    planLog.warn("Planner: JSON parse failed, retrying with simplified prompt");

    const retryMessages: LLMMessage[] = [
      {
        role: "system",
        content: staticPrompt("planner.retry"),
      },
      ...conversationMessages.slice(-2), // Only last user/assistant turn
    ];

    const retryResponse = await client.chat(retryMessages, {
      temperature: 0.2,
      max_tokens: 512,
      think: false,
    });
    accumulateTokens(tokenUsage, retryResponse.usage);

    const retryParsed = extractJSON(retryResponse.content || "{}");
    if (retryParsed.goal !== "Unable to parse plan from response") {
      planLog.info({ retryPlan: retryParsed }, "Planner: retry succeeded");
      rawPlan = retryParsed;
    }
  }

  const plan = validateAndSimplifyPlan(rawPlan);

  // Validate plan structure
  if (!plan.goal || !Array.isArray(plan.steps)) {
    logCanonical(planLog, "Planner: completed", {
      duration_ms: Date.now() - plannerStart,
      status: "failure",
      metrics: {
        llm_calls: tokenUsage.llm_calls,
        prompt_tokens: tokenUsage.prompt_tokens,
        completion_tokens: tokenUsage.completion_tokens,
      },
    });
    return {
      plan: {
        goal: plan.goal || "Respond to user message",
        steps: plan.steps || [
          { id: 1, description: "Generate response", tool_intent: null },
        ],
      },
      rawResponse,
      tokenUsage,
    };
  }

  planLog.debug({ plan }, "Planner: parsed plan");
  logCanonical(planLog, "Planner: completed", {
    duration_ms: Date.now() - plannerStart,
    status: "success",
    metrics: {
      llm_calls: tokenUsage.llm_calls,
      prompt_tokens: tokenUsage.prompt_tokens,
      completion_tokens: tokenUsage.completion_tokens,
    },
  });

  return { plan, rawResponse, tokenUsage };
}

/**
 * Execute a lightweight re-planning check after a tool batch.
 * Asks the LLM whether the remaining plan is still valid given the latest observation.
 * Only called when enable_replanning is true in ExecutorContext.
 */
export async function executeReplanner(
  originalPlan: Plan,
  completedSteps: string[],
  latestObservation: string,
  originalUserMessage?: string,
  runId?: string,
  llmClient?: LLMClient,
): Promise<ReplannerResult> {
  const client: LLMClient = llmClient ?? new BoucioClient(null);
  const replanLog = runId ? log.child({ run_id: runId }) : log;
  const tokenUsage = createTokenAccumulator();

  const completedText =
    completedSteps.length > 0
      ? completedSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none yet)";

  const remainingSteps = originalPlan.steps
    .map((s) => `${s.id}. ${s.description}`)
    .join("\n");

  const userContent = renderPrompt("replanner.input", {
    originalUserMessage: originalUserMessage ?? originalPlan.goal,
    goal: originalPlan.goal,
    completedText,
    latestObservation: latestObservation.slice(0, 400),
    remainingSteps,
  });

  try {
    const response = await client.chat(
      [
        { role: "system", content: staticPrompt("replanner.system") },
        { role: "user", content: userContent },
      ],
      { temperature: 0.1, max_tokens: 512 },
    );
    accumulateTokens(tokenUsage, response.usage);

    const raw = response.content || "{}";
    let parsed: {
      revised?: boolean;
      reason?: string;
      goal?: string;
      steps?: unknown[];
    };

    try {
      parsed = extractJSON(raw) as typeof parsed;
    } catch {
      replanLog.warn(
        { raw },
        "Re-planner: failed to parse response — treating as no revision",
      );
      return { revised: false, reason: "Parse error", tokenUsage };
    }

    if (
      parsed.revised &&
      parsed.goal &&
      Array.isArray(parsed.steps) &&
      parsed.steps.length > 0
    ) {
      const revisedPlan: Plan = {
        goal: parsed.goal,
        steps: parsed.steps as Plan["steps"],
      };
      replanLog.info(
        { reason: parsed.reason, newSteps: revisedPlan.steps.length },
        "Re-planner: plan revised",
      );
      return {
        revised: true,
        plan: revisedPlan,
        reason: parsed.reason ?? "Plan updated",
        tokenUsage,
      };
    }

    return {
      revised: false,
      reason: parsed.reason ?? "Plan is valid",
      tokenUsage,
    };
  } catch (err) {
    replanLog.warn({ err }, "Re-planner: LLM call failed");
    return { revised: false, reason: "Re-planner error", tokenUsage };
  }
}
