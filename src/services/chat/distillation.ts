/**
 * Threshold-gated distillation for the /v1/chats surface.
 *
 * Carried over from chatbot-api-server, where this logic was duplicated in two
 * controllers (chatStreamController and messageController). It lives in one place here.
 *
 * Why thresholds at all: the agentic path distills on every completed run, which is fine
 * when a run is a deliberate task. A chat turn is one message, so distilling every turn
 * would hammer the distiller and the LLM behind it. The chatbot throttled on both a
 * message count and a wall-clock interval, and that behaviour is preserved exactly.
 */

import type { PrismaClient } from "../../generated/prisma/client";
import { createComponentLogger } from "../../lib/logger";
import { distillationClient } from "../memory/distillationClient";

const log = createComponentLogger("chat-distillation");

export interface DistillableChat {
  id: string;
  last_distilled_at: Date | null;
  distilled_message_count: number;
}

export function distillationThresholds() {
  return {
    minMessages: parseInt(process.env.DISTILLATION_MIN_MESSAGES || "10", 10),
    minIntervalMs: parseInt(
      process.env.DISTILLATION_MIN_INTERVAL_MS || "900000",
      10,
    ),
    maxMessages: parseInt(process.env.DISTILLATION_MAX_MESSAGES || "50", 10),
  };
}

/**
 * Fire distillation for a chat if both thresholds are met.
 *
 * Call it after the response has been sent: it is fire-and-forget by design and must
 * never delay or fail a turn. The counters are written optimistically *before* the
 * trigger, which is what stops two concurrent turns from both firing.
 *
 * Returns true when a trigger was issued, for tests and for logging.
 */
export async function maybeDistillChat(
  prisma: Pick<PrismaClient, "message" | "assignment">,
  chat: DistillableChat,
  userId: string,
  requestToken: string | undefined,
  now: Date = new Date(),
): Promise<boolean> {
  if (!distillationClient.isEnabled()) return false;

  const { minMessages, minIntervalMs, maxMessages } = distillationThresholds();

  const totalCount = await prisma.message.count({
    where: { assignment_id: chat.id },
  });
  const newSinceLast = totalCount - (chat.distilled_message_count ?? 0);
  const lastAt = chat.last_distilled_at ? chat.last_distilled_at.getTime() : 0;
  const intervalOk = now.getTime() - lastAt >= minIntervalMs;

  if (newSinceLast < minMessages || !intervalOk) {
    log.debug(
      { chat_id: chat.id, newSinceLast, intervalOk },
      "Distillation threshold not met, skipping",
    );
    return false;
  }

  const recent = await prisma.message.findMany({
    where: { assignment_id: chat.id },
    orderBy: { created_at: "desc" },
    take: maxMessages,
    select: { role: true, content: true },
  });
  recent.reverse();

  await prisma.assignment.update({
    where: { id: chat.id },
    data: { last_distilled_at: now, distilled_message_count: totalCount },
  });

  log.info(
    { chat_id: chat.id, messages_sent: recent.length, newSinceLast },
    "Triggering distillation",
  );

  // source.type stays "chat" so memory-distiller keeps treating these as chat
  // transcripts, as it did when chatbot-api-server owned this surface.
  void distillationClient
    .triggerDistillation(
      {
        source: { type: "chat", id: chat.id },
        context: { messages: recent },
        metadata: { user_id: userId },
        options: { max_memories: 10 },
      },
      requestToken,
    )
    .catch((err) =>
      log.error({ err, chat_id: chat.id }, "Distillation trigger failed"),
    );

  return true;
}
