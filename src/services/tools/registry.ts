import { prisma } from "../../lib/prisma";
import {
  ToolHandler,
  ToolContext,
  ToolResult,
  ToolPolicy,
} from "../../types/tool";
import { LLMToolDefinition } from "../../types/llm";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("tool-registry");

/**
 * Timeout error for tool execution
 */
export class ToolTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool '${toolName}' timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}

/**
 * Error for unknown tool
 */
export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Tool '${toolName}' not found in registry`);
    this.name = "ToolNotFoundError";
  }
}

/**
 * Tool Registry - manages tool registration and execution
 */
class ToolRegistry {
  private handlers: Map<string, ToolHandler> = new Map();

  /**
   * Register a tool handler
   */
  register(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler);
    log.debug({ tool: handler.name }, "Tool registered");
  }

  /**
   * Unregister a tool handler (used when an MCP server disconnects/reloads).
   */
  unregister(name: string): void {
    if (this.handlers.delete(name)) {
      log.debug({ tool: name }, "Tool unregistered");
    }
  }

  /**
   * Get a tool handler by name
   */
  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Get all registered tool names
   */
  getRegisteredNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Execute a tool with timeout and policy checks
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const handler = this.handlers.get(name);

    if (!handler) {
      throw new ToolNotFoundError(name);
    }

    // Get timeout from context, env, or default
    const defaultTimeout = parseInt(
      process.env.TOOL_DEFAULT_TIMEOUT_MS || "30000",
      10,
    );
    const timeout = context.timeout || defaultTimeout;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new ToolTimeoutError(name, timeout));
      }, timeout);
    });

    try {
      // Race between tool execution and timeout
      const result = await Promise.race([
        handler.execute(args, context),
        timeoutPromise,
      ]);
      return result;
    } catch (error) {
      if (error instanceof ToolTimeoutError) {
        return {
          success: false,
          output: null,
          error: error.message,
        };
      }
      throw error;
    }
  }

  /**
   * Get tool definitions from database in LLM-compatible format.
   * Includes server-side tools (with registered handlers) always.
   * Client-side tools (requires_client_execution=true) are only included
   * when clientType === 'cli' — they cannot execute in web sessions.
   */
  async getToolDefinitionsFromDB(
    clientType?: string,
  ): Promise<LLMToolDefinition[]> {
    const tools = await prisma.tool.findMany({
      where: { enabled: true },
    });

    const isCli = clientType === "cli";

    const dbDefs = tools
      .filter(
        (tool) =>
          this.handlers.has(tool.name) ||
          (tool.requires_client_execution && isCli),
      )
      .map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: (tool.schema as Record<string, unknown>) || {
            type: "object",
            properties: {},
          },
        },
      }));

    // Dynamically-discovered MCP tools are not backed by `Tool` rows; their
    // handlers are registered at connection time. Lazy import avoids a
    // circular dependency (mcp manager imports this registry).
    const { mcpClientManager } = await import("../mcp");
    const mcpDefs = mcpClientManager.getMcpToolDefinitions();

    return [...dbDefs, ...mcpDefs];
  }

  /**
   * Check whether a tool is flagged for client-side execution.
   * Client-side tools are run by the CLI and their results are
   * POSTed back via POST /runs/:id/tool-results.
   */
  async isClientSideTool(name: string): Promise<boolean> {
    const tool = await prisma.tool.findUnique({
      where: { name },
      select: { requires_client_execution: true },
    });
    return tool?.requires_client_execution ?? false;
  }

  /**
   * Get policy for a tool from database
   */
  async getToolPolicy(name: string): Promise<ToolPolicy | null> {
    const tool = await prisma.tool.findUnique({
      where: { name },
      select: { policy: true },
    });
    if (tool) {
      return (tool.policy as ToolPolicy) || null;
    }
    // No DB row (e.g. dynamically-registered MCP tools): fall back to the policy
    // carried on the handler so the approval gate can still reach it.
    return this.handlers.get(name)?.policy ?? null;
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
