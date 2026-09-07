import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ToolHandler,
  ToolContext,
  ToolResult,
  ToolPolicy,
} from "../../types/tool";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("mcp-proxy-handler");

/**
 * Generic tool handler that forwards a single tool call to a remote MCP server.
 *
 * One instance is created per (server, tool) pair at discovery time and
 * registered in the toolRegistry under its prefixed name. The executor
 * dispatches to it like any other handler — no executor changes required.
 */
export class McpProxyHandler implements ToolHandler {
  /** Prefixed, registry-visible name, e.g. "github-mcp__create_issue" */
  public readonly name: string;

  /** MCP tools have no `Tool` DB row, so the registry falls back to this handler
   *  policy. Default-deny: every MCP tool requires approval and is treated as
   *  state-changing until an admin allowlist marks specific tools safe. */
  public readonly policy: ToolPolicy = {
    requires_approval: true,
    state_changing: true,
  };

  /** Remote MCP output is untrusted external content. */
  public readonly trust = "untrusted" as const;

  constructor(
    private readonly serverName: string,
    /** Original tool name as exposed by the MCP server, e.g. "create_issue" */
    private readonly mcpToolName: string,
    prefixedName: string,
    private readonly client: Client,
    /** The tool's JSON-schema input definition, echoed into errors so the model can self-correct */
    private readonly inputSchema?: Record<string, unknown>,
  ) {
    this.name = prefixedName;
  }

  /** Build an error message that includes the expected input schema, when available,
   *  so a model that sent malformed arguments can retry with the correct shape. */
  private withSchemaHint(message: string): string {
    if (!this.inputSchema) return message;
    return `${message}\nExpected input schema for '${this.mcpToolName}': ${JSON.stringify(this.inputSchema)}`;
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      const result = await this.client.callTool({
        name: this.mcpToolName,
        arguments: args,
      });

      // MCP returns { content: ContentBlock[], isError?: boolean }.
      // Concatenate text blocks; preserve non-text blocks as-is.
      const blocks = Array.isArray(result.content) ? result.content : [];
      const text = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const nonText = blocks.filter((b) => b.type !== "text");

      if (result.isError) {
        return {
          success: false,
          output: null,
          error: this.withSchemaHint(
            text || `MCP tool '${this.mcpToolName}' returned an error`,
          ),
        };
      }

      return {
        success: true,
        output: nonText.length > 0 ? { text, content: blocks } : { text },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown MCP error";
      log.warn(
        { server: this.serverName, tool: this.mcpToolName, err: message },
        "MCP tool call failed",
      );
      return {
        success: false,
        output: null,
        error: this.withSchemaHint(message),
      };
    }
  }
}
