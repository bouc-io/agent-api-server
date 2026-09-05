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
 * System prompt for the Planner phase
 */
// /no_think instructs Qwen3 models to skip extended chain-of-thought reasoning
// and output the JSON directly — preventing token-budget exhaustion that produces
// empty responses. This directive is ignored by non-Qwen3 models.
const PLANNER_SYSTEM_PROMPT = `/no_think
You are a planning assistant. Output ONLY a JSON object, no other text.

Format: {"goal":"...","steps":[{"id":1,"description":"...","tool_intent":"tool_name or null"}]}

Rules:
- The "goal" field MUST restate the LAST user message in the user's own words (e.g. "Find drive time Toronto to Montreal", "Add 10 to 12"). NEVER write "Create an execution plan", "Analyze the conversation", "Identify user intent", "Respond to the user", or any phrase describing your own planning task — those are your job, not the user's goal. If you find yourself typing "execution plan" or "conversation" in the goal, you are wrong.
- Use fewest steps possible. One tool per step.
- For follow-ups ("add 10 to that"), use the known result directly. Write the concrete expression in the description.
- tool_intent must match an available tool name. If steps is non-empty, every step's tool_intent MUST be a valid tool name (never null). If no tool fits, use steps: [].
- Respond with valid JSON only.
- Step descriptions must describe a CONCRETE action a tool will perform with specific parameters (e.g. "Search web for driving time Toronto to Montreal", "Calculate 12 + 10"). FORBIDDEN step descriptions: "analyze conversation", "review context", "identify user intent", "retrieve conversation history", "determine current state", "establish baseline", "create plan", "search memory for context", "analyze the current conversation flow", or any internal-only reasoning step. If the only step you can think of is one of these, the correct answer is steps: [].
- Include ALL steps required to fully answer the user. If a task needs multiple tools (e.g., weather requires geocode THEN forecast), include every step.
- If the user's request needs no tool (greeting, acknowledgement, clarification, or already answered by conversation context), output steps as an empty array: [].

Examples:

User: "what is 12 * (3+4) / 2"
{"goal":"Calculate 12 * (3+4) / 2","steps":[{"id":1,"description":"Calculate 12 * (3+4) / 2","tool_intent":"calculator"}]}

User: "what time is it in Tokyo?"
{"goal":"Get current time in Tokyo","steps":[{"id":1,"description":"Get current time in Asia/Tokyo timezone","tool_intent":"time_date"}]}

Conversation: User asked "what is 12 * (3+4) / 2", Assistant answered "42", User now says "add 10 to that"
{"goal":"Add 10 to 42","steps":[{"id":1,"description":"Calculate 42 + 10","tool_intent":"calculator"}]}

Conversation: User asked "what is 25 * 4", Assistant answered "100", User now says "divide that by 5"
{"goal":"Divide 100 by 5","steps":[{"id":1,"description":"Calculate 100 / 5","tool_intent":"calculator"}]}

User: "what does the example.com homepage say?"
{"goal":"Fetch and read example.com homepage","steps":[{"id":1,"description":"Fetch and extract text from https://example.com","tool_intent":"fetch_page"}]}

User: "search for AI news and read the top article"
{"goal":"Search for AI news and read the top article","steps":[{"id":1,"description":"Search for recent AI news articles","tool_intent":"web_search"},{"id":2,"description":"Fetch and read the top search result URL","tool_intent":"fetch_page"}]}

User: "extract all email addresses from: contact us at foo@bar.com or baz@qux.com"
{"goal":"Extract email addresses from text","steps":[{"id":1,"description":"Extract all email addresses using regex pattern","tool_intent":"text_extract"}]}

User: "what do you know about my food preferences?"
{"goal":"Recall user food preferences from memory","steps":[{"id":1,"description":"Search memory for user food preferences","tool_intent":"memory_search"}]}

User: "get the weather in Paris and show me the temperature"
{"goal":"Get weather in Paris and extract temperature","steps":[{"id":1,"description":"Geocode Paris to get coordinates","tool_intent":"http_request"},{"id":2,"description":"Fetch weather forecast for Paris coordinates","tool_intent":"http_request"},{"id":3,"description":"Extract temperature value from weather JSON","tool_intent":"json_query"}]}

User: "search for the weather in Paris"
{"goal":"Get current weather in Paris","steps":[{"id":1,"description":"Geocode Paris to get coordinates","tool_intent":"http_request"},{"id":2,"description":"Fetch current weather forecast using Paris coordinates","tool_intent":"http_request"}]}

User: "thanks!"
{"goal":"Acknowledge user","steps":[]}

User: "who are you?"
{"goal":"Introduce assistant","steps":[]}

User: "ok got it"
{"goal":"Acknowledge user understanding","steps":[]}`;

/**
 * Build the full planner system prompt, optionally including available tool info and memory context hint.
 * When hasMemoryContext is true, adds examples showing that questions already answerable from injected
 * USER PROFILE / KNOWN FACTS should produce an empty steps array rather than a memory_search step.
 */
function buildPlannerPrompt(
  tools?: LLMToolDefinition[],
  hasMemoryContext?: boolean,
): string {
  let prompt = PLANNER_SYSTEM_PROMPT;

  if (hasMemoryContext) {
    prompt += `

[USER PROFILE and KNOWN FACTS are already injected into the executor context]
User: "what's my name?"
{"goal":"Answer from injected context","steps":[]}

User: "do you know my food preferences?"
{"goal":"Report food preferences from context","steps":[]}`;
  }

  if (!tools || tools.length === 0) {
    return prompt;
  }

  const toolList = tools
    .map((t) => `- ${t.function.name}: ${t.function.description}`)
    .join("\n");

  return `${prompt}

VALID tool_intent values (use ONLY these exact names or null):
${toolList}`;
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
      content:
        'Output the JSON plan now. The "goal" field must restate the LAST user message above in that user\'s own words (their intent) — do NOT echo this instruction into the goal.',
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
        content:
          'Output JSON only: {"goal":"...","steps":[{"id":1,"description":"...","tool_intent":"tool_name or null"}]}',
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

// /no_think keeps Qwen3 from burning the token budget on chain-of-thought before outputting JSON
const REPLANNER_SYSTEM_PROMPT = `/no_think
You are a plan validator. A task is in progress. Review the original goal, what has been done so far, and the latest result, then decide if the remaining plan is still valid.

Output ONLY a JSON object — no other text.

If the plan is still valid: {"revised":false,"reason":"brief explanation"}
If the plan needs updating: {"revised":true,"reason":"brief explanation","goal":"original goal","steps":[{"id":1,"description":"...","tool_intent":"tool_name or null"}]}

Rules:
- Only include REMAINING steps (not already completed ones).
- If a tool failed and an alternative approach exists, revise the plan.
- If a tool failed and no alternative exists, set revised=false and let the executor report the error.
- Use fewest steps possible. tool_intent must be a valid tool name or null.`;

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

  const userContent =
    `Original user request: "${originalUserMessage ?? originalPlan.goal}"\n` +
    `Goal: ${originalPlan.goal}\n\n` +
    `Completed step results:\n${completedText}\n\n` +
    `Latest observation: ${latestObservation.slice(0, 400)}\n\n` +
    `Remaining plan steps:\n${remainingSteps}\n\n` +
    `Is the remaining plan still valid?`;

  try {
    const response = await client.chat(
      [
        { role: "system", content: REPLANNER_SYSTEM_PROMPT },
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
