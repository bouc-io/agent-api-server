/**
 * Chat system prompt assembly for the /v1/chats surface.
 *
 * Lives here rather than in the worker on purpose: buildDirectSystemPrompt() sits in
 * src/workers/runOrchestrator.ts, which drags BullMQ and Redis into anything that
 * imports it, including the prompt HTTP endpoint and the snapshot test. The chat
 * builder has no such dependency and must stay that way.
 *
 * The assembled string is byte-identical to what chatbot-api-server built inline:
 *   instructionPrefix + basePrompt + knowledgeSuffix + noParrotRule
 * with the base prompt now owned by prompts/chat.system.md.
 */

import { renderPrompt, staticPrompt } from "../../prompts";
import type { ConfigInstruction } from "../instructionClient";
import type { MemorySearchResult } from "../memory/memoryClient";
import {
  buildInstructionPrefix,
  buildKnowledgeSuffix,
} from "../memory/memoryFormatter";

/**
 * Build the chat system prompt.
 *
 * No timestamp, no completion instruction and no tool list: chat has no tools and
 * answers in exactly one LLM call, so the planner's scaffolding does not apply. Adding
 * any of them would change behaviour and belongs in an eval-measured change instead.
 */
export function buildChatSystemPrompt(args: {
  configInstructions: ConfigInstruction[];
  memories: MemorySearchResult[];
}): string {
  const { configInstructions, memories } = args;
  const knowledgeSuffix = buildKnowledgeSuffix(memories);

  return renderPrompt("chat.system", {
    instructionPrefix: buildInstructionPrefix(configInstructions, memories),
    knowledgeSuffix,
    // The fragment itself carries no leading newline; the caller adds it, and it is
    // only appended when there is context worth telling the model not to parrot.
    noParrotRule: knowledgeSuffix
      ? `\n${staticPrompt("frag.no-parrot-chat")}`
      : "",
  });
}
