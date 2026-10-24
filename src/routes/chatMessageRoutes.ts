/**
 * /v1/chats/:id/messages — chat transcript and per-message feedback.
 * mergeParams so the parent ":id" (the chat) is visible to the controllers.
 */

import { Router } from "express";
import {
  createMessage,
  deleteMessage,
  getMessageById,
  getMessagesByChatId,
  submitFeedback,
} from "../controllers/chatMessageController";
import { requireRoles } from "../lib/auth";
import { AI_APP_ROLES } from "../lib/roles";
import { validate } from "../middleware/validate";
import { createChatMessageSchema, submitFeedbackSchema } from "../schemas";

const router = Router({ mergeParams: true });

router.use(requireRoles(...AI_APP_ROLES));

/**
 * @openapi
 * /v1/chats/{id}/messages:
 *   get:
 *     summary: List a chat's messages oldest first, with feedback joined in
 *     tags: [Chats]
 *     responses:
 *       200:
 *         description: Paginated messages
 *   post:
 *     summary: Append a message to a chat
 *     tags: [Chats]
 *     responses:
 *       201:
 *         description: The created message
 */
router.get("/", getMessagesByChatId);
router.post("/", validate(createChatMessageSchema), createMessage);

/**
 * @openapi
 * /v1/chats/{id}/messages/{messageId}:
 *   get:
 *     summary: Get one message
 *     tags: [Chats]
 *   delete:
 *     summary: Delete one message, used by the UI's resubmit truncation
 *     tags: [Chats]
 *     responses:
 *       204:
 *         description: Deleted
 */
router.get("/:messageId", getMessageById);
router.delete("/:messageId", deleteMessage);

/**
 * @openapi
 * /v1/chats/{id}/messages/{messageId}/feedback:
 *   post:
 *     summary: Rate one assistant message, replacing any previous rating
 *     tags: [Chats]
 *     responses:
 *       204:
 *         description: Recorded
 *       400:
 *         description: rating must be 'positive' or 'negative'
 */
router.post(
  "/:messageId/feedback",
  validate(submitFeedbackSchema),
  submitFeedback,
);

export default router;
