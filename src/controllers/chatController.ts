/**
 * Chats CRUD for the /v1/chats surface, formerly chatbot-api-server's chatController.
 *
 * Backed by Assignment rows with surface = "chat". The response bodies, status codes and
 * the flat { error: "..." } envelope are deliberately the chatbot's, not this service's
 * { error: { code, message } } shape: monochrome-chatbot-ui is not changing, so this is a
 * compatibility surface and its contract is whatever the UI already expects.
 */

import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getUserContextFromRequest } from "../lib/auth";
import { createComponentLogger } from "../lib/logger";
import { CHAT_SURFACE, chatSelect, chatWhere } from "./chatShared";
import { paginate, toChatResponse } from "../serializers/chatSerializer";

const log = createComponentLogger("chat-controller");

const ALLOWED_SORTS = ["created_at", "updated_at", "title"] as const;

export const createChat = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  const { title, model_id, summary } = req.body as {
    title?: string;
    model_id?: string;
    summary?: string;
  };

  if (!title || !model_id) {
    return res.status(400).json({ error: "Title and model_id are required" });
  }

  try {
    const chat = await prisma.assignment.create({
      data: {
        title,
        user_id: ctx.userId,
        org_id: ctx.orgId,
        surface: CHAT_SURFACE,
        summary,
        // The model is chosen by the admin LLM assignment, not per chat. The value is
        // kept only so the UI's picker round-trips the label it sent.
        metadata: { model_id },
      },
      select: chatSelect,
    });
    res.status(201).json(toChatResponse(chat));
  } catch (error) {
    log.error({ err: error }, "Error creating chat");
    res.status(500).json({ error: "Failed to create chat" });
  }
};

export const getChats = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  const page = parseInt(req.query.page as string) || 1;
  let limit = parseInt(req.query.limit as string) || 20;
  if (limit > 100) limit = 100;

  const requested = (req.query.sort as string) || "updated_at";
  const sort = (ALLOWED_SORTS as readonly string[]).includes(requested)
    ? requested
    : "updated_at";
  const order = (req.query.order as string) === "asc" ? "asc" : "desc";

  const where = chatWhere(ctx);

  try {
    const [chats, total] = await Promise.all([
      prisma.assignment.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
        select: chatSelect,
      }),
      prisma.assignment.count({ where }),
    ]);

    res.json(paginate(chats.map(toChatResponse), page, limit, total));
  } catch (error) {
    log.error({ err: error }, "Error fetching chats");
    res.status(500).json({ error: "Failed to fetch chats" });
  }
};

export const getChatById = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  const chatId = String(req.params.id);

  try {
    const chat = await prisma.assignment.findUnique({
      where: { id: chatId },
      select: { ...chatSelect, surface: true },
    });

    if (!chat || chat.surface !== CHAT_SURFACE) {
      return res.status(404).json({ error: "Chat not found" });
    }
    if (chat.user_id !== ctx.userId) {
      log.warn(
        { chat_user_id: chat.user_id, request_user_id: ctx.userId },
        "getChatById: Forbidden access",
      );
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json(toChatResponse(chat));
  } catch (error) {
    log.error({ err: error }, "Error fetching chat");
    res.status(500).json({ error: "Failed to fetch chat" });
  }
};

export const updateChat = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  const { title, summary } = req.body as { title?: string; summary?: string };
  const chatId = String(req.params.id);

  try {
    const existing = await prisma.assignment.findUnique({
      where: { id: chatId },
      select: { user_id: true, surface: true },
    });

    if (!existing || existing.surface !== CHAT_SURFACE) {
      return res.status(404).json({ error: "Chat not found" });
    }
    if (existing.user_id !== ctx.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // undefined means "leave alone"; "" is a real value the UI's no-op touch sends
    // back for summary, and it must round-trip rather than being treated as absent.
    const chat = await prisma.assignment.update({
      where: { id: chatId },
      data: { title, summary },
      select: chatSelect,
    });

    res.json(toChatResponse(chat));
  } catch (error) {
    log.error({ err: error }, "Error updating chat");
    res.status(500).json({ error: "Failed to update chat" });
  }
};

export const deleteChat = async (req: Request, res: Response) => {
  const ctx = getUserContextFromRequest(req);
  if (!ctx) {
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  const chatId = String(req.params.id);

  try {
    const chat = await prisma.assignment.findUnique({
      where: { id: chatId },
      select: { user_id: true, surface: true },
    });

    if (!chat || chat.surface !== CHAT_SURFACE) {
      return res.status(404).json({ error: "Chat not found" });
    }
    if (chat.user_id !== ctx.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Messages, runs and feedback cascade from the Assignment row.
    await prisma.assignment.delete({ where: { id: chatId } });
    res.status(204).send();
  } catch (error) {
    log.error({ err: error }, "Error deleting chat");
    res.status(500).json({ error: "Failed to delete chat" });
  }
};
