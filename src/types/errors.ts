/**
 * Agent Error Types
 * Structured errors for the agent system with retry classification
 */

/**
 * Base class for all agent errors
 */
export class AgentError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Error from LLM service (Ollama/vLLM)
 * Typically retryable for transient failures
 */
export class LLMError extends AgentError {
  constructor(message: string) {
    super(message, "LLM_ERROR", true);
    this.name = "LLMError";
  }
}

/**
 * Error during tool execution
 * Generally not retryable (tool logic failed)
 */
export class ToolError extends AgentError {
  toolName: string;

  constructor(message: string, toolName: string) {
    super(message, "TOOL_ERROR", false);
    this.name = "ToolError";
    this.toolName = toolName;
  }
}

/**
 * Timeout error for tool or LLM calls
 * Retryable - the operation might succeed on retry
 */
export class TimeoutError extends AgentError {
  timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, "TIMEOUT_ERROR", true);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error from Memory Service
 * Retryable for transient failures
 */
export class MemoryServiceError extends AgentError {
  constructor(message: string) {
    super(message, "MEMORY_ERROR", true);
    this.name = "MemoryServiceError";
  }
}

/**
 * Error from Distillation Service
 * Retryable but non-blocking
 */
export class DistillationError extends AgentError {
  constructor(message: string) {
    super(message, "DISTILLATION_ERROR", true);
    this.name = "DistillationError";
  }
}

/**
 * Run was cancelled by user
 * Not retryable - intentional cancellation
 */
export class CancellationError extends AgentError {
  runId: string;

  constructor(runId: string) {
    super(`Run ${runId} was cancelled`, "CANCELLED", false);
    this.name = "CancellationError";
    this.runId = runId;
  }
}

/**
 * Database/Prisma error
 * May be retryable depending on the error type
 */
export class DatabaseError extends AgentError {
  constructor(message: string, retryable: boolean = true) {
    super(message, "DATABASE_ERROR", retryable);
    this.name = "DatabaseError";
  }
}

/**
 * Validation error for inputs
 * Not retryable - bad input
 */
export class ValidationError extends AgentError {
  field?: string;

  constructor(message: string, field?: string) {
    super(message, "VALIDATION_ERROR", false);
    this.name = "ValidationError";
    this.field = field;
  }
}
