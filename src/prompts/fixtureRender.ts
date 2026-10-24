/**
 * Render any prompt against the frozen fixture.
 *
 * Backs GET /v1/prompts/:id/rendered. For the three assembled system prompts this calls the
 * real builders, so what you see is exactly what the model receives, fragments resolved and
 * optional blocks applied. Everything else is plain variable substitution.
 *
 * The fixture is read from PROMPT_FIXTURE in the generated module rather than from disk,
 * because prompts/ is not present in the production image.
 */
import {
  buildInstructionPrefix,
  buildKnowledgeSuffix,
} from "../services/memory/memoryFormatter";
import {
  buildExecutorSystemPrompt,
  extractConversationContext,
} from "../services/executor";
import { buildPlannerPrompt } from "../services/planner";
import { buildDirectSystemPrompt } from "../workers/runOrchestrator";
import { buildChatSystemPrompt } from "../services/chat/chatPrompt";
import type { ConfigInstruction } from "../services/instructionClient";
import type { MemorySearchResult } from "../services/memory/memoryClient";
import type { LLMMessage, LLMToolDefinition, Plan } from "../types/llm";
import { PROMPT_FIXTURE } from "./generated";
import { formatToolLines, getPrompt, renderPrompt, staticPrompt } from ".";

interface Fixture {
  now: string;
  plan: Plan;
  tools: LLMToolDefinition[];
  messages: LLMMessage[];
  memories: MemorySearchResult[];
  configInstructions: ConfigInstruction[];
  replanner: {
    originalUserMessage: string;
    completedText: string;
    latestObservation: string;
    remainingSteps: string;
  };
  summaryText: string;
  toolError: { error: string };
}

const fixture = PROMPT_FIXTURE as unknown as Fixture;
const fixtureNow = new Date(fixture.now);

/** Fixture-derived value for every variable name used anywhere in the promptset. */
function fixtureVariables(): Record<string, string> {
  const knowledgeSuffix = buildKnowledgeSuffix(fixture.memories);
  return {
    instructionPrefix: buildInstructionPrefix(
      fixture.configInstructions,
      fixture.memories,
    ),
    now: fixtureNow.toUTCString(),
    goal: fixture.plan.goal,
    conversationContext: extractConversationContext(fixture.messages),
    knowledgeSuffix,
    noParrotRule: `\n${staticPrompt("frag.no-parrot-executor")}`,
    stepsText: fixture.plan.steps
      .map((s) => `${s.id}. ${s.description}`)
      .join("\n"),
    toolList: formatToolLines(fixture.tools),
    completionInstruction: staticPrompt("frag.completion-web"),
    summaryText: fixture.summaryText,
    error: fixture.toolError.error,
    originalUserMessage: fixture.replanner.originalUserMessage,
    completedText: fixture.replanner.completedText,
    latestObservation: fixture.replanner.latestObservation,
    remainingSteps: fixture.replanner.remainingSteps,
  };
}

/** Prompts whose assembly is non-trivial and therefore rendered by the real builder. */
export const ASSEMBLED_PROMPT_IDS = [
  "executor.system",
  "direct.system",
  "planner.system",
  "chat.system",
] as const;

export function renderWithFixture(id: string, clientType = "web"): string {
  switch (id) {
    case "executor.system":
      return buildExecutorSystemPrompt(
        fixture.plan,
        fixture.tools,
        fixture.messages,
        fixture.memories,
        fixture.configInstructions,
        clientType,
        fixtureNow,
      );
    case "direct.system":
      return buildDirectSystemPrompt({
        configInstructions: fixture.configInstructions,
        memories: fixture.memories,
        tools: fixture.tools,
        clientType,
        now: fixtureNow,
      });
    case "chat.system":
      // The chat surface has no tools and no timestamp, so the builder takes only
      // instructions and memories. fixtureVariables()'s noParrotRule is the executor
      // wording, which is why this case must not fall through to the default branch.
      return buildChatSystemPrompt({
        configInstructions: fixture.configInstructions,
        memories: fixture.memories,
      });
    case "planner.system":
      // hasMemoryContext=true so the memory-context examples and tool list are included,
      // matching what the planner actually receives when memories were retrieved.
      return buildPlannerPrompt(fixture.tools, true);
    default: {
      const entry = getPrompt(id);
      const available = fixtureVariables();
      const variables: Record<string, string> = {};
      for (const name of entry.meta.variables ?? []) {
        // A visible placeholder beats throwing: this endpoint is for reading prompts, and a
        // new variable with no fixture value should still render.
        variables[name] = available[name] ?? `<${name}>`;
      }
      return renderPrompt(id, variables);
    }
  }
}
