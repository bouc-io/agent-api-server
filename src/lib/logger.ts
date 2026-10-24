import pino, { LoggerOptions } from "pino";

/**
 * Log level from environment
 */
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

/**
 * Error serializer that never emits request credentials. pino's default copies every enumerable
 * property of an error, and an AxiosError carries `config.headers.Authorization` (the user's
 * bearer token, LLM provider API keys, MCP auth). For axios errors, keep only what diagnoses the
 * failure.
 */
export const safeErrSerializer = (err: unknown): unknown => {
  if ((err as { isAxiosError?: boolean } | null)?.isAxiosError) {
    const e = err as {
      name?: string;
      message?: string;
      code?: string;
      stack?: string;
      response?: { status?: number };
      config?: { method?: string; url?: string };
    };
    return {
      type: e.name,
      message: e.message,
      code: e.code,
      status: e.response?.status,
      method: e.config?.method,
      url: e.config?.url,
      stack: e.stack,
    };
  }
  return pino.stdSerializers.err(err as Error);
};

/**
 * Base logger configuration following CLAUDE.md logging standards:
 * - timestamp (ISO8601)
 * - level
 * - agent (service name)
 * - message
 * - request_id / run_id
 * - component
 * - elapsed_ms
 *
 * `redact` and the error serializers keep credentials out of the logs (defense in depth: call
 * sites should not log tokens in the first place). Child loggers inherit both.
 */
export const loggerOptions: LoggerOptions = {
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
    }),
  },
  base: {
    agent: "agent-api-server",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "accessToken",
      "refreshToken",
      "*.accessToken",
      "*.refreshToken",
      "*.headers.authorization",
      "*.headers.Authorization",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: safeErrSerializer,
    error: safeErrSerializer,
  },
};

export const logger = pino(loggerOptions);

/**
 * Create a child logger for a specific run
 * Adds run_id to all log entries
 */
export const createRunLogger = (runId: string) => {
  return logger.child({
    run_id: runId,
    component: "run-orchestrator",
  });
};

/**
 * Create a child logger for a specific component
 */
export const createComponentLogger = (component: string) => {
  return logger.child({
    component,
  });
};

/**
 * Create a child logger for HTTP requests
 */
export const createRequestLogger = (requestId: string) => {
  return logger.child({
    request_id: requestId,
    component: "http",
  });
};

/**
 * Log a canonical summary at the end of an operation
 * Per CLAUDE.md requirements
 */
export interface CanonicalLogData {
  duration_ms: number;
  status: "success" | "failure" | "cancelled";
  metrics?: Record<string, number>;
}

export const logCanonical = (
  log: pino.Logger,
  message: string,
  data: CanonicalLogData,
) => {
  log.info(
    {
      duration_ms: data.duration_ms,
      status: data.status,
      ...data.metrics,
    },
    message,
  );
};
