/**
 * Shared pieces for the /v1/chats controllers.
 *
 * The chat surface and the agentic surface share the Assignment and Message tables, so
 * every chat query carries surface = "chat". Without it, GET /v1/chats would list agent
 * assignments and the chat UI would render tool messages as user bubbles.
 */

import type { UserContext } from "../lib/auth";

export const CHAT_SURFACE = "chat";

/** The default surface, i.e. agentic assignments. Matches the column default. */
export const AGENT_SURFACE = "agent";

/** The only Assignment columns the chat serializer needs. Never select `settings`. */
export const chatSelect = {
  id: true,
  title: true,
  summary: true,
  user_id: true,
  created_at: true,
  updated_at: true,
  metadata: true,
} as const;

/** The Message columns the chat serializer needs, with feedback joined in. */
export const chatMessageSelect = {
  id: true,
  assignment_id: true,
  role: true,
  content: true,
  created_at: true,
  metadata: true,
  prompt_tokens: true,
  completion_tokens: true,
  total_tokens: true,
  feedback: { select: { rating: true, comment: true } },
} as const;

/**
 * Scope a chat list query to the caller. org_id is only applied when the caller has one,
 * matching chatbot-api-server: a user without an org must still see their own chats.
 */
export function chatWhere(ctx: UserContext) {
  return {
    user_id: ctx.userId,
    surface: CHAT_SURFACE,
    ...(ctx.orgId ? { org_id: ctx.orgId } : {}),
  };
}

/** Chat transcripts only ever show the two conversational roles. */
export const CHAT_ROLES = ["user", "assistant"] as const;
