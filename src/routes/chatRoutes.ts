/**
 * /v1/chats — the chat surface, formerly served by chatbot-api-server.
 *
 * Mounted ahead of the broad "/v1" mount in app.ts. Only single-segment "/:id" verbs are
 * declared here, so deeper paths (".../messages", ".../stream") fall through to their own
 * mounts rather than being captured.
 */

import { Router, Request, Response } from "express";
import {
  createChat,
  deleteChat,
  getChatById,
  getChats,
  updateChat,
} from "../controllers/chatController";
import { requireRoles } from "../lib/auth";
import { AI_APP_ROLES } from "../lib/roles";
import { validate } from "../middleware/validate";
import { createChatSchema, updateChatSchema } from "../schemas";

const router = Router();

/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("../../package.json") as { version: string; name: string };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * @openapi
 * /v1/chats/health:
 *   get:
 *     summary: Chat surface health and resolved model
 *     tags: [Chats]
 *     responses:
 *       200:
 *         description: Service name, version and the default model name
 */
// Declared before requireRoles so it is role-unguarded, and before "/:id" or it would
// resolve as getChatById("health"). Still behind oauth2-proxy externally.
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    version: pkg.version,
    name: pkg.name,
    model_name: process.env.OLLAMA_MODEL || "unknown",
  });
});

router.use(requireRoles(...AI_APP_ROLES));

/**
 * @openapi
 * /v1/chats:
 *   post:
 *     summary: Create a chat
 *     tags: [Chats]
 *     responses:
 *       201:
 *         description: The created chat
 *       400:
 *         description: title and model_id are required
 *   get:
 *     summary: List the caller's chats, newest first
 *     tags: [Chats]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [created_at, updated_at, title] }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *     responses:
 *       200:
 *         description: Paginated chats
 */
router.post("/", validate(createChatSchema), createChat);
router.get("/", getChats);

/**
 * @openapi
 * /v1/chats/{id}:
 *   get:
 *     summary: Get one chat
 *     tags: [Chats]
 *   patch:
 *     summary: Rename a chat or set its summary
 *     tags: [Chats]
 *   delete:
 *     summary: Delete a chat and everything under it
 *     tags: [Chats]
 *     responses:
 *       204:
 *         description: Deleted
 */
router.get("/:id", getChatById);
router.patch("/:id", validate(updateChatSchema), updateChat);
router.delete("/:id", deleteChat);

export default router;
