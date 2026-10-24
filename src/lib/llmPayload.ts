/**
 * Full-payload observability for outbound LLM requests.
 *
 * Each payload is recorded twice:
 *  - a DEBUG log entry with the complete message array — prompts embed memories
 *    and user data, so this rides the debug level; production runs LOG_LEVEL=info
 *    which silences it without a code change
 *  - an OpenTelemetry span event carrying the same payload, so the exact prompt
 *    travels with the trace (Jaeger via the OTLP collector)
 */
import { trace, Attributes } from "@opentelemetry/api";
import type { Logger } from "pino";
import { LLMMessage } from "../types/llm";

const tracer = trace.getTracer("agent-api-server");

export type LLMRequestPhase =
  | "planner"
  | "executor"
  | "executor_forced_summarization";

export interface LLMRequestMeta {
  runId?: string;
  stepIndex?: number;
  model?: string;
}

export function recordLLMRequestPayload(
  log: Logger,
  phase: LLMRequestPhase,
  messages: LLMMessage[],
  meta: LLMRequestMeta = {},
): void {
  log.debug(
    {
      phase,
      step_index: meta.stepIndex,
      model: meta.model,
      message_count: messages.length,
      llm_messages: messages,
    },
    "LLM request payload",
  );

  const attributes: Attributes = {
    "llm.phase": phase,
    "llm.request.message_count": messages.length,
    "llm.request.messages": JSON.stringify(messages),
  };
  if (meta.runId) attributes["run.id"] = meta.runId;
  if (meta.stepIndex !== undefined)
    attributes["llm.step_index"] = meta.stepIndex;
  if (meta.model) attributes["gen_ai.request.model"] = meta.model;

  // BullMQ workers run outside any auto-instrumented context, so there is
  // usually no active span to annotate — emit an instant span in that case
  // so the payload still reaches the trace backend.
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.addEvent("llm.request.payload", attributes);
  } else {
    tracer.startSpan("llm.request.payload", { attributes }).end();
  }
}
