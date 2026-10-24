/**
 * Turn assembly for the /v1/chats surface.
 *
 * Everything here takes its dependencies as parameters. That is not ceremony: it is what
 * lets the stream controller be unit-tested with a fake prisma and a fake LLM client,
 * with no Postgres, Redis or Ollama, which the repo's vitest config requires.
 *
 * A chat turn deliberately does NOT go through the run worker:
 *  - the chat UI reads SSE off the same POST it sends, while the worker path is
 *    enqueue-then-subscribe;
 *  - the worker has no token-level events, and emitting one Redis publish per token
 *    would be a different cost profile entirely;
 *  - the worker always runs the planner first, which doubles time-to-first-token on a
 *    surface whose entire budget is one LLM call.
 * It still writes a Run row, synchronously, so token accounting, /v1/usage, the
 * Prometheus counters and promptset provenance all keep working. Chat runs are marked
 * with agent_id = CHAT_AGENT_ID.
 */

import type { PrismaClient } from "../../generated/prisma/client";
import { createComponentLogger } from "../../lib/logger";
import { PROMPTSET_HASH, PROMPTSET_VERSION } from "../../prompts/generated";
import { fetchInstructions } from "../instructionClient";
import { memoryClient } from "../memory/memoryClient";
import type { LLMMessage } from "../../types/llm";
import { buildChatSystemPrompt } from "./chatPrompt";

const log = createComponentLogger("chat-turn");

/** Marks a Run as belonging to the chat surface rather than the agentic one. */
export const CHAT_AGENT_ID = "chat";

/** How many prior messages to replay into the prompt. */
function maxHistoryMessages(): number {
  return parseInt(process.env.MAX_HISTORY_MESSAGES || "20", 10);
}

function memorySearchLimit(): number {
  return parseInt(process.env.MEMORY_SEARCH_LIMIT || "10", 10);
}

type ChatPrisma = Pick<PrismaClient, "message" | "assignment" | "run">;

export interface BuildTurnArgs {
  prisma: ChatPrisma;
  chatId: string;
  userId: string;
  /** The user's new message text, already persisted. */
  content: string;
  /** Id of the message just persisted, excluded from the replayed history. */
  excludeMessageId: string;
  accessToken?: string;
}

export interface BuiltTurn {
  messages: LLMMessage[];
  memoriesCount: number;
}

/**
 * Assemble the LLM message array for one chat turn: system prompt, replayed history,
 * then the new user message.
 *
 * Instructions and memories are fetched in parallel, as chatbot-api-server did. Memory
 * retrieval uses this service's own assignment-scoped client: memory-api-server already
 * does critical-first tiering server-side, so no client-side fan-out is needed.
 */
export async function buildChatTurn(args: BuildTurnArgs): Promise<BuiltTurn> {
  const { prisma, chatId, userId, content, excludeMessageId, accessToken } =
    args;

  const history = await prisma.message.findMany({
    where: { assignment_id: chatId, id: { not: excludeMessageId } },
    orderBy: { created_at: "desc" },
    take: maxHistoryMessages(),
    select: { role: true, content: true },
  });
  history.reverse();

  const [configInstructions, memories] = await Promise.all([
    // fetchInstructions requires a token: with none there is no user to scope to,
    // so skip rather than call the admin API unauthenticated.
    accessToken
      ? fetchInstructions(accessToken).catch((err) => {
          log.warn({ err }, "Instruction fetch failed, continuing without");
          return [];
        })
      : Promise.resolve([]),
    memoryClient
      .retrieveMemories(
        content,
        chatId,
        userId,
        accessToken,
        memorySearchLimit(),
      )
      .catch((err) => {
        log.warn({ err }, "Memory retrieval failed, continuing without");
        return [];
      }),
  ]);

  const system = buildChatSystemPrompt({ configInstructions, memories });

  const messages: LLMMessage[] = [
    { role: "system", content: system },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user", content },
  ];

  return { messages, memoriesCount: memories.length };
}

/** Open the Run row that records this chat turn. */
export async function openChatRun(
  prisma: ChatPrisma,
  args: {
    chatId: string;
    userId: string;
    orgId: string | null;
    triggerMessageId: string;
    modelName: string;
    memoriesCount: number;
  },
): Promise<{ id: string; startedAt: Date }> {
  const startedAt = new Date();
  const run = await prisma.run.create({
    data: {
      assignment_id: args.chatId,
      user_id: args.userId,
      // Set explicitly: /v1/usage filters on org_id, so omitting it makes an org
      // user's usage read as zero.
      org_id: args.orgId,
      agent_id: CHAT_AGENT_ID,
      status: "running",
      trigger_message_id: args.triggerMessageId,
      started_at: startedAt,
      model_name: args.modelName,
      snapshot: { memories_count: args.memoriesCount },
    },
    select: { id: true },
  });
  return { id: run.id, startedAt };
}

/** Close a chat Run as completed, recording tokens and promptset provenance. */
export async function completeChatRun(
  prisma: ChatPrisma,
  runId: string,
  usage: { prompt_tokens: number; completion_tokens: number },
): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: {
      status: "completed",
      ended_at: new Date(),
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.prompt_tokens + usage.completion_tokens,
      llm_calls: 1,
      promptset_version: PROMPTSET_VERSION,
      promptset_hash: PROMPTSET_HASH,
    },
  });
}

/**
 * Close a chat Run that produced no stored answer.
 *
 * Used for both a client disconnect ("cancelled") and a stream failure ("failed").
 * No token fields are written: /v1/usage counts completed runs only, and a turn with
 * no assistant message should contribute nothing.
 */
export async function abandonChatRun(
  prisma: ChatPrisma,
  runId: string,
  status: "cancelled" | "failed",
  error?: string,
): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: { status, ended_at: new Date(), ...(error ? { error } : {}) },
  });
}
