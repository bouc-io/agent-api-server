import { z } from "zod";

/**
 * Request body schemas for agent-api-server mutating routes.
 * Objects use .passthrough() so unknown keys are preserved (non-breaking for
 * existing clients) while known fields are type-checked. Apply with the
 * validate() middleware in src/middleware/validate.ts.
 */

const metadata = z.record(z.string(), z.unknown());

export const createAssignmentSchema = z
  .object({ title: z.string().optional(), metadata: metadata.optional() })
  .passthrough();

export const updateAssignmentSchema = z
  .object({ title: z.string().optional(), metadata: metadata.optional() })
  .passthrough();

export const createMessageSchema = z
  .object({
    content: z.string().min(1, "content is required"),
    role: z.string().optional(),
    metadata: metadata.optional(),
    options: metadata.optional(),
  })
  .passthrough();

export const createRunSchema = z
  .object({
    agent_id: z.string().optional(),
    trigger_message_id: z.string().optional(),
    client_type: z.string().optional(),
  })
  .passthrough();

export const approveRunSchema = z
  .object({
    approval_request_id: z.string().optional(),
    approved: z.boolean(),
    reason: z.string().optional(),
  })
  .passthrough();

export const submitFeedbackSchema = z
  .object({
    rating: z.string().min(1, "rating is required"),
    comment: z.string().optional(),
  })
  .passthrough();

export const submitToolResultSchema = z
  .object({
    tool_call_id: z.string().min(1, "tool_call_id is required"),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })
  .passthrough();

/* ---------------------------------------------------------------------------
 * /v1/chats surface (formerly chatbot-api-server)
 *
 * Deliberately permissive, matching the schemas that surface shipped with: the
 * controllers do the required-field checks so the error bodies stay byte-compatible
 * with what the chat UI already handles ({ error: "Title and model_id are required" }
 * rather than this service's VALIDATION_ERROR envelope).
 * ------------------------------------------------------------------------- */

export const createChatSchema = z
  .object({
    title: z.string().optional(),
    model_id: z.string().optional(),
    summary: z.string().optional(),
  })
  .passthrough();

export const updateChatSchema = z
  .object({
    title: z.string().optional(),
    // "" is meaningful: the UI's post-turn touch resends an empty summary.
    summary: z.string().optional(),
  })
  .passthrough();

export const streamChatSchema = z
  .object({
    content: z.string().min(1, "content is required"),
    model_id: z.string().optional(),
    think: z.boolean().optional(),
  })
  .passthrough();

export const createChatMessageSchema = z
  .object({
    role: z.string().optional(),
    content: z.string().optional(),
    metadata: metadata.optional(),
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  })
  .passthrough();
