/**
 * Messages and per-message feedback for the /v1/chats surface.
 *
 * One deliberate difference from chatbot-api-server: there, getMessageById, updateMessage
 * and deleteMessage checked `message.user_id` and never verified that the message actually
 * belonged to the chat in the URL, so a message could be read or deleted through any chat
 * id. Here every lookup is scoped by the parent chat. The UI always passes matching ids,
 * so this is invisible to it.
 */

import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../generated/prisma/client";
import { getUserContextFromRequest, type UserContext } from "../lib/auth";
import { createComponentLogger } from "../lib/logger";
import { CHAT_ROLES, CHAT_SURFACE, chatMessageSelect } from "./chatShared";
import { paginate, toMessageResponse } from "../serializers/chatSerializer";
import { maybeDistillChat } from "../services/chat/distillation";

const log = createComponentLogger("chat-message-controller");

/** Load the chat and check ownership. Returns null once a response has been sent. */
async function loadOwnedChat(
  chatId: string,
  ctx: UserContext,
  res: Response,
): Promise<{ id: string; user_id: string } | null> {
  const chat = await prisma.assignment.findUnique({
    where: { id: chatId },
    select: { id: true, user_id: true, surface: true },
  });
  if (!chat || chat.surface !== CHAT_SURFACE) {
    res.status(404).json({ error: "Chat not found" });
    return null;
  }
  if (chat.user_id !== ctx.userId) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return { id: chat.id, user_id: chat.user_id };
}

export const getMessagesByChatId = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }
  const chatId = String(req.params.id);
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  try {
    const chat = await loadOwnedChat(chatId, ctx, res);
    if (!chat) return;

    // Roles are filtered to the two conversational ones: an assignment migrated or
    // mislabelled as chat must never render tool output as a user bubble.
    const where = {
      assignment_id: chatId,
      role: { in: [...CHAT_ROLES] },
    };

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { created_at: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        select: chatMessageSelect,
      }),
      prisma.message.count({ where }),
    ]);

    res.json(
      paginate(
        messages.map((m) => toMessageResponse(m, chat.user_id)),
        page,
        limit,
        total,
      ),
    );
  } catch (error) {
    log.error({ err: error }, "Error fetching messages");
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

export const createMessage = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }
  const chatId = String(req.params.id);
  const { role, content, metadata, prompt_tokens, completion_tokens } =
    req.body as {
      role?: string;
      content?: string;
      metadata?: Record<string, unknown>;
      prompt_tokens?: number;
      completion_tokens?: number;
    };

  if (!role || !content) {
    return res.status(400).json({ error: "Role and content are required" });
  }

  try {
    const chat = await loadOwnedChat(chatId, ctx, res);
    if (!chat) return;

    const message = await prisma.message.create({
      data: {
        assignment_id: chatId,
        role,
        content,
        metadata: (metadata ?? {}) as Prisma.InputJsonObject,
        prompt_tokens: prompt_tokens ?? 0,
        completion_tokens: completion_tokens ?? 0,
        total_tokens: (prompt_tokens ?? 0) + (completion_tokens ?? 0),
      },
      select: chatMessageSelect,
    });

    res.status(201).json(toMessageResponse(message, chat.user_id));

    // Same trigger point chatbot-api-server used: an assistant message means a turn
    // completed, so the transcript is worth considering for distillation.
    if (role === "assistant") {
      const fresh = await prisma.assignment.findUnique({
        where: { id: chatId },
        select: {
          id: true,
          last_distilled_at: true,
          distilled_message_count: true,
        },
      });
      if (fresh) {
        await maybeDistillChat(prisma, fresh, ctx.userId, ctx.accessToken);
      }
    }
  } catch (error) {
    log.error({ err: error }, "Error creating message");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to create message" });
    }
  }
};

export const getMessageById = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }
  const chatId = String(req.params.id);
  const messageId = String(req.params.messageId);

  try {
    const chat = await loadOwnedChat(chatId, ctx, res);
    if (!chat) return;

    const message = await prisma.message.findFirst({
      where: { id: messageId, assignment_id: chatId },
      select: chatMessageSelect,
    });
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json(toMessageResponse(message, chat.user_id));
  } catch (error) {
    log.error({ err: error }, "Error fetching message");
    res.status(500).json({ error: "Failed to fetch message" });
  }
};

export const deleteMessage = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }
  const chatId = String(req.params.id);
  const messageId = String(req.params.messageId);

  try {
    const chat = await loadOwnedChat(chatId, ctx, res);
    if (!chat) return;

    const message = await prisma.message.findFirst({
      where: { id: messageId, assignment_id: chatId },
      select: { id: true },
    });
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Feedback cascades with the message.
    await prisma.message.delete({ where: { id: messageId } });
    res.status(204).send();
  } catch (error) {
    log.error({ err: error }, "Error deleting message");
    res.status(500).json({ error: "Failed to delete message" });
  }
};

export const submitFeedback = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }
  const chatId = String(req.params.id);
  const messageId = String(req.params.messageId);
  const { rating, comment } = req.body as { rating?: string; comment?: string };

  if (rating !== "positive" && rating !== "negative") {
    return res
      .status(400)
      .json({ error: "rating must be 'positive' or 'negative'" });
  }

  try {
    const chat = await loadOwnedChat(chatId, ctx, res);
    if (!chat) return;

    const message = await prisma.message.findFirst({
      where: { id: messageId, assignment_id: chatId },
      select: { id: true },
    });
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Upsert on the unique message_id: re-rating replaces, it does not accumulate.
    await prisma.messageFeedback.upsert({
      where: { message_id: messageId },
      create: { message_id: messageId, rating, comment },
      update: { rating, comment },
    });

    res.status(204).send();
  } catch (error) {
    log.error({ err: error }, "Error submitting feedback");
    res.status(500).json({ error: "Failed to submit feedback" });
  }
};
