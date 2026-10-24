/**
 * Golden renders of every assembled prompt, one file per branch under
 * prompts/__snapshots__/.
 *
 * Purpose is review, not assertion. The committed goldens make a prompt change show up in
 * a merge request as a readable before/after of the text the model actually receives,
 * including the ripple when a shared fragment is edited: touching formatting.md changes
 * executor.system's golden, and you see that in the diff instead of discovering it in an
 * eval regression.
 *
 * These were first generated while the pre-extraction builders were still in the codebase
 * and equivalence.test.ts was green across all 18 branch combinations, so the initial
 * goldens are the original text byte-for-byte. That is what carries the behaviour-neutral
 * guarantee forward past the cutover.
 *
 * Intentional prompt edits: run `npx vitest run -u src/prompts` and commit the diff.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInstructionPrefix,
  buildKnowledgeSuffix,
} from "../services/memory/memoryFormatter";
import { extractConversationContext } from "../services/executor";
import type { ConfigInstruction } from "../services/instructionClient";
import type { MemorySearchResult } from "../services/memory/memoryClient";
import type { LLMMessage, LLMToolDefinition, Plan } from "../types/llm";
import { promptsDir } from "./codegen";
import { PROMPTS, renderPrompt, staticPrompt } from ".";

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

const fixture = JSON.parse(
  fs.readFileSync(path.join(promptsDir, "fixtures", "default.json"), "utf8"),
) as unknown as Fixture;

const now = new Date(fixture.now);
const { plan, tools, messages, memories, configInstructions } = fixture;

const snapshotPath = (name: string): string =>
  path.join(promptsDir, "__snapshots__", `${name}.txt`);

const toolLines = (list: LLMToolDefinition[]): string =>
  list.map((t) => `- ${t.function.name}: ${t.function.description}`).join("\n");

function executorPrompt(
  clientType: string,
  mems: MemorySearchResult[],
): string {
  const knowledgeSuffix = buildKnowledgeSuffix(mems);
  return renderPrompt("executor.system", {
    instructionPrefix: buildInstructionPrefix(configInstructions, mems),
    now: now.toUTCString(),
    goal: plan.goal,
    conversationContext: extractConversationContext(messages),
    knowledgeSuffix,
    noParrotRule: knowledgeSuffix
      ? `\n${staticPrompt("frag.no-parrot-executor")}`
      : "",
    stepsText: plan.steps.map((s) => `${s.id}. ${s.description}`).join("\n"),
    toolList:
      tools.length > 0
        ? `\n\n${renderPrompt("frag.executor-tool-list", {
            toolList: toolLines(tools),
          })}`
        : "",
    completionInstruction:
      clientType === "cli"
        ? staticPrompt("frag.completion-cli")
        : staticPrompt("frag.completion-web"),
  });
}

function directPrompt(clientType: string, mems: MemorySearchResult[]): string {
  const knowledgeSuffix = buildKnowledgeSuffix(mems);
  return renderPrompt("direct.system", {
    instructionPrefix: buildInstructionPrefix(configInstructions, mems),
    now: now.toUTCString(),
    knowledgeSuffix,
    noParrotRule: knowledgeSuffix
      ? `\n${staticPrompt("frag.no-parrot-direct")}`
      : "",
    completionInstruction:
      clientType === "cli"
        ? staticPrompt("frag.completion-direct-cli")
        : staticPrompt("frag.completion-direct-web"),
    toolList: tools.length
      ? `\n${renderPrompt("frag.direct-tool-list", {
          toolList: toolLines(tools),
        })}`
      : "",
  });
}

/**
 * Mirrors buildChatSystemPrompt(). Re-implemented here deliberately: this file asserts
 * the assembled bytes independently of the builder, so a change to one shows up as a
 * golden diff rather than silently agreeing with itself.
 */
function chatPrompt(
  mems: MemorySearchResult[],
  instructions: ConfigInstruction[] = configInstructions,
): string {
  const knowledgeSuffix = buildKnowledgeSuffix(mems);
  return renderPrompt("chat.system", {
    instructionPrefix: buildInstructionPrefix(instructions, mems),
    knowledgeSuffix,
    noParrotRule: knowledgeSuffix
      ? `\n${staticPrompt("frag.no-parrot-chat")}`
      : "",
  });
}

describe("rendered prompt goldens", () => {
  it("planner.system", async () => {
    await expect(staticPrompt("planner.system")).toMatchFileSnapshot(
      snapshotPath("planner.system"),
    );
  });

  it("planner.system with memories and tools", async () => {
    const rendered =
      staticPrompt("planner.system") +
      `\n\n${staticPrompt("planner.memory-context")}` +
      `\n\n${renderPrompt("planner.tool-list", { toolList: toolLines(tools) })}`;
    await expect(rendered).toMatchFileSnapshot(
      snapshotPath("planner.system.with-memories-and-tools"),
    );
  });

  it("replanner.system", async () => {
    await expect(staticPrompt("replanner.system")).toMatchFileSnapshot(
      snapshotPath("replanner.system"),
    );
  });

  it("replanner.input", async () => {
    const r = fixture.replanner;
    await expect(
      renderPrompt("replanner.input", { ...r, goal: plan.goal }),
    ).toMatchFileSnapshot(snapshotPath("replanner.input"));
  });

  for (const clientType of ["cli", "web"]) {
    it(`executor.system (${clientType}, with memories)`, async () => {
      await expect(executorPrompt(clientType, memories)).toMatchFileSnapshot(
        snapshotPath(`executor.system.${clientType}`),
      );
    });

    it(`direct.system (${clientType}, with memories)`, async () => {
      await expect(directPrompt(clientType, memories)).toMatchFileSnapshot(
        snapshotPath(`direct.system.${clientType}`),
      );
    });
  }

  it("executor.system (web, no memories)", async () => {
    await expect(executorPrompt("web", [])).toMatchFileSnapshot(
      snapshotPath("executor.system.web.no-memories"),
    );
  });

  it("direct.system (web, no memories)", async () => {
    await expect(directPrompt("web", [])).toMatchFileSnapshot(
      snapshotPath("direct.system.web.no-memories"),
    );
  });

  // With no instructions and no memories every variable renders empty, so these bytes
  // must equal the pre-templating version 1 golden byte for byte. A diff here means
  // the assembly changed the prompt rather than just moving where it is built.
  it("chat.system (bare, no instructions or memories)", async () => {
    await expect(chatPrompt([], [])).toMatchFileSnapshot(
      snapshotPath("chat.system"),
    );
  });

  it("chat.system (with memories)", async () => {
    await expect(chatPrompt(memories)).toMatchFileSnapshot(
      snapshotPath("chat.system.with-memories"),
    );
  });

  it("compaction.system", async () => {
    await expect(staticPrompt("compaction.system")).toMatchFileSnapshot(
      snapshotPath("compaction.system"),
    );
  });

  // Every unit gets at least a hash recorded, so adding or removing one is visible in the
  // diff even when no assembled prompt above covers it.
  it("promptset inventory", async () => {
    const inventory = Object.values(PROMPTS)
      .map((e) => `${e.meta.id}\tv${e.meta.version}\t${e.hash}`)
      .sort()
      .join("\n");
    await expect(inventory).toMatchFileSnapshot(snapshotPath("_inventory"));
  });
});
