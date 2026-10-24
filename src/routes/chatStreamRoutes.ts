/**
 * /v1/chats/:chatId/stream — one chat turn, answered over SSE on this same POST.
 * mergeParams so ":chatId" reaches the controller.
 */

import { Router } from "express";
import { streamChat } from "../controllers/chatStreamController";
import { requireRoles } from "../lib/auth";
import { AI_APP_ROLES } from "../lib/roles";
import { validate } from "../middleware/validate";
import { streamChatSchema } from "../schemas";

const router = Router({ mergeParams: true });

router.use(requireRoles(...AI_APP_ROLES));

/**
 * @openapi
 * /v1/chats/{chatId}/stream:
 *   post:
 *     summary: Send a message and stream the answer
 *     description: >
 *       Server-sent events on this same response: user_message.created, run.status,
 *       then message.token and message.thinking_token repeatedly, then message.created
 *       and run.completed. Errors before the stream opens are plain JSON; after it opens
 *       they arrive as run.failed.
 *     tags: [Chats]
 *     responses:
 *       200:
 *         description: text/event-stream
 *       503:
 *         description: The configured LLM provider cannot stream
 */
router.post("/", validate(streamChatSchema), streamChat);

export default router;
