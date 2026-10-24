/**
 * Wire-format serializers for the /v1/chats surface.
 *
 * The chat UI (monochrome-chatbot-ui) is NOT changing as part of the chatbot-api-server
 * retirement, so these functions are the compatibility contract: an Assignment must look
 * exactly like chatbot-api-server's Chat, and a Message like its Message.
 *
 * Deliberately pure, with no express and no prisma imports, so the key sets can be
 * asserted in a unit test with no infrastructure. Each function emits an explicit
 * allowlist of keys rather than spreading the row: Assignment carries `settings` and an
 * `embedding` vector that must never reach a client.
 *
 * Projections, because the agent's schema is not the chatbot's:
 *   chat_id          <- assignment_id
 *   user_id          <- the parent assignment's user_id (Message has no such column)
 *   model_id         <- metadata.model_name (per-chat model choice was dropped in favour
 *                       of the admin LLM assignment, so this is the model that actually ran)
 *   message_group_id <- metadata.message_group_id, falling back to the message id
 *   updated_at       <- created_at (chat messages are immutable here; the PATCH endpoint
 *                       the chatbot had is unused by the UI and not reimplemented)
 */

type Json = Record<string, unknown>;

export interface ChatRow {
  id: string;
  title: string;
  summary: string | null;
  user_id: string;
  created_at: Date;
  updated_at: Date;
  metadata: unknown;
}

export interface MessageRow {
  id: string;
  assignment_id: string;
  role: string;
  content: string;
  created_at: Date;
  metadata: unknown;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  feedback?: { rating: string; comment: string | null } | null;
}

export interface ChatResponse {
  id: string;
  title: string;
  summary: string | null;
  user_id: string;
  model_id: string;
  created_at: string;
  updated_at: string;
  metadata: Json;
}

export interface MessageResponse {
  id: string;
  message_group_id: string;
  role: string;
  content: string;
  chat_id: string;
  user_id: string;
  model_id: string | null;
  created_at: string;
  updated_at: string;
  metadata: Json;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  feedback: { rating: string; comment: string | null } | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

function asJson(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Serialize an Assignment row as the chat UI's ChatResponse. */
export function toChatResponse(row: ChatRow): ChatResponse {
  const metadata = asJson(row.metadata);
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? null,
    user_id: row.user_id,
    // Echoes back whatever the UI sent at create time so its model picker round-trips;
    // it does not select the model, the admin LLM assignment does.
    model_id:
      asString(metadata.model_id) ?? process.env.OLLAMA_MODEL ?? "unknown",
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    metadata,
  };
}

/**
 * Serialize a Message row as the chat UI's MessageResponse.
 * `assignmentUserId` comes from the parent assignment, already loaded for the
 * ownership check, so this costs no extra query.
 */
export function toMessageResponse(
  row: MessageRow,
  assignmentUserId: string,
): MessageResponse {
  const metadata = asJson(row.metadata);
  return {
    id: row.id,
    message_group_id: asString(metadata.message_group_id) ?? row.id,
    role: row.role,
    content: row.content,
    chat_id: row.assignment_id,
    user_id: assignmentUserId,
    model_id: asString(metadata.model_name),
    created_at: row.created_at.toISOString(),
    updated_at: row.created_at.toISOString(),
    metadata,
    prompt_tokens: row.prompt_tokens ?? 0,
    completion_tokens: row.completion_tokens ?? 0,
    total_tokens: row.total_tokens ?? 0,
    feedback: row.feedback
      ? { rating: row.feedback.rating, comment: row.feedback.comment ?? null }
      : null,
  };
}

/** The chatbot's pagination envelope, which differs from this service's own. */
export function paginate<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
}
