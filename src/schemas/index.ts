import { z } from 'zod';

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
    content: z.string().min(1, 'content is required'),
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
  .object({ rating: z.string().min(1, 'rating is required'), comment: z.string().optional() })
  .passthrough();

export const submitToolResultSchema = z
  .object({
    tool_call_id: z.string().min(1, 'tool_call_id is required'),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })
  .passthrough();
