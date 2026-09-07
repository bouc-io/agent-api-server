import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import axios from "axios";
import https from "https";
import { LLMToolDefinition } from "../../types/llm";
import { createComponentLogger } from "../../lib/logger";
import { toolRegistry } from "../tools/registry";
import { McpProxyHandler } from "./mcpProxyHandler";

const log = createComponentLogger("mcp-client-manager");

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";

/** How often to re-sync MCP server config from admin-api-server (ms). */
const SYNC_INTERVAL_MS = parseInt(
  process.env.MCP_SYNC_INTERVAL_MS || "60000",
  10,
);

export type McpTransport = "http" | "sse";
export type McpConnectionStatus =
  | "connected"
  | "connecting"
  | "error"
  | "disabled";

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  auth_token?: string | null;
  enabled: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  enabled: boolean;
  status: McpConnectionStatus;
  toolCount: number;
  discoveredTools: string[];
  error?: string;
}

interface McpServerEntry {
  config: McpServerConfig;
  client?: Client;
  status: McpConnectionStatus;
  /** Prefixed tool names registered in the toolRegistry for this server */
  toolNames: string[];
  error?: string;
}

/**
 * Manages connections to configured MCP servers, discovers their tools, and
 * registers a McpProxyHandler per tool in the shared toolRegistry. Discovered
 * tools require no rows in the `Tool` table — they are injected dynamically.
 */
export class McpClientManager {
  private servers = new Map<string, McpServerEntry>(); // keyed by config id
  private mcpToolDefs = new Map<string, LLMToolDefinition>(); // keyed by prefixed name
  private syncTimer?: NodeJS.Timeout;

  /**
   * Fetch the enabled MCP server list from admin-api-server, connect to each,
   * and start a periodic re-sync. MCP config is owned by admin-api-server (like
   * LLM providers) and fetched here at runtime — agent-api-server holds no rows.
   */
  async initialize(): Promise<void> {
    const configs = await this.loadConfigs();
    await Promise.all(configs.map((c) => this.connectServer(c)));
    log.info(
      { servers: configs.length, tools: this.mcpToolDefs.size },
      "MCP client manager initialized",
    );

    // Periodic re-sync picks up config changes from admin-api-server and
    // retries servers that are currently in an error state.
    if (SYNC_INTERVAL_MS > 0 && !this.syncTimer) {
      this.syncTimer = setInterval(() => {
        this.reload().catch((err) =>
          log.warn({ err }, "MCP periodic re-sync failed"),
        );
      }, SYNC_INTERVAL_MS);
      this.syncTimer.unref?.();
    }
  }

  /** Re-sync with the DB: drop removed/disabled servers, connect new ones. */
  async reload(): Promise<void> {
    const configs = await this.loadConfigs();
    const desiredIds = new Set(configs.map((c) => c.id));

    // Disconnect servers that no longer exist or were disabled
    for (const id of Array.from(this.servers.keys())) {
      if (!desiredIds.has(id)) {
        await this.disconnectServer(id);
      }
    }

    // Connect new servers, reconnect changed ones, and retry errored ones
    await Promise.all(
      configs.map(async (c) => {
        const existing = this.servers.get(c.id);
        const needsReconnect =
          !existing ||
          existing.status === "error" ||
          this.configChanged(existing.config, c);
        if (needsReconnect) {
          await this.disconnectServer(c.id);
          await this.connectServer(c);
        }
      }),
    );

    log.info(
      { servers: this.servers.size, tools: this.mcpToolDefs.size },
      "MCP client manager reloaded",
    );
  }

  /** Close all connections, stop re-sync, and unregister all MCP tools. */
  async shutdown(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    for (const id of Array.from(this.servers.keys())) {
      await this.disconnectServer(id);
    }
    log.info("MCP client manager shut down");
  }

  /** All MCP-sourced tool definitions, for injection into the LLM tool list. */
  getMcpToolDefinitions(): LLMToolDefinition[] {
    return Array.from(this.mcpToolDefs.values());
  }

  /** Live status of every known server, for the admin API. */
  getStatus(): McpServerStatus[] {
    return Array.from(this.servers.values()).map((e) => ({
      id: e.config.id,
      name: e.config.name,
      url: e.config.url,
      transport: e.config.transport,
      enabled: e.config.enabled,
      status: e.status,
      toolCount: e.toolNames.length,
      discoveredTools: [...e.toolNames],
      error: e.error,
    }));
  }

  /**
   * Fetch the enabled MCP server list from admin-api-server's internal config
   * endpoint (service-to-service, no JWT — same pattern as assignmentConfigClient).
   * Returns [] when ADMIN_API_URL is unset or the call fails, so a missing admin
   * service simply means "no MCP tools" rather than a startup failure.
   */
  private async loadConfigs(): Promise<McpServerConfig[]> {
    const adminUrl = process.env.ADMIN_API_URL;
    if (!adminUrl) {
      log.debug("ADMIN_API_URL not set — no MCP servers configured");
      return [];
    }

    const httpsAgent = new https.Agent({
      rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS,
    });

    try {
      const response = await axios.get(`${adminUrl}/v1/config/mcp-servers`, {
        httpsAgent,
        timeout: 5000,
      });
      const servers = (response.data?.servers ?? []) as Array<
        Record<string, unknown>
      >;
      return servers.map((s) => ({
        id: String(s.id),
        name: String(s.name),
        url: String(s.url),
        transport: (s.transport === "sse" ? "sse" : "http") as McpTransport,
        auth_token: (s.auth_token as string | null) ?? null,
        enabled: true,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      log.warn(
        { err: message },
        "Failed to fetch MCP server config from admin-api-server",
      );
      return [];
    }
  }

  private configChanged(a: McpServerConfig, b: McpServerConfig): boolean {
    return (
      a.name !== b.name ||
      a.url !== b.url ||
      a.transport !== b.transport ||
      (a.auth_token ?? null) !== (b.auth_token ?? null)
    );
  }

  private async connectServer(config: McpServerConfig): Promise<void> {
    const entry: McpServerEntry = {
      config,
      status: "connecting",
      toolNames: [],
    };
    this.servers.set(config.id, entry);

    try {
      const url = new URL(config.url);
      const headers = config.auth_token
        ? { Authorization: `Bearer ${config.auth_token}` }
        : undefined;

      const transport =
        config.transport === "sse"
          ? new SSEClientTransport(url, {
              requestInit: headers ? { headers } : undefined,
            })
          : new StreamableHTTPClientTransport(url, {
              requestInit: headers ? { headers } : undefined,
            });

      const client = new Client({ name: "agent-api-server", version: "1.0.0" });
      await client.connect(transport);

      const { tools } = await client.listTools();
      const toolNames: string[] = [];

      for (const tool of tools) {
        const prefixedName = `${config.name}__${tool.name}`;
        const inputSchema = (tool.inputSchema as Record<string, unknown>) || {
          type: "object",
          properties: {},
        };
        this.mcpToolDefs.set(prefixedName, {
          type: "function",
          function: {
            name: prefixedName,
            description: tool.description || "",
            parameters: inputSchema,
          },
        });
        toolRegistry.register(
          new McpProxyHandler(
            config.name,
            tool.name,
            prefixedName,
            client,
            inputSchema,
          ),
        );
        toolNames.push(prefixedName);
      }

      entry.client = client;
      entry.status = "connected";
      entry.toolNames = toolNames;
      entry.error = undefined;

      log.info(
        { server: config.name, url: config.url, tools: toolNames.length },
        "Connected to MCP server",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      entry.status = "error";
      entry.error = message;
      log.warn(
        { server: config.name, url: config.url, err: message },
        "Failed to connect to MCP server",
      );
    }
  }

  private async disconnectServer(id: string): Promise<void> {
    const entry = this.servers.get(id);
    if (!entry) return;

    for (const name of entry.toolNames) {
      toolRegistry.unregister(name);
      this.mcpToolDefs.delete(name);
    }

    if (entry.client) {
      try {
        await entry.client.close();
      } catch (error) {
        log.warn(
          { server: entry.config.name, err: error },
          "Error closing MCP client",
        );
      }
    }

    this.servers.delete(id);
    log.info({ server: entry.config.name }, "Disconnected from MCP server");
  }
}

export const mcpClientManager = new McpClientManager();
