/**
 * Tool Type Definitions
 * Types for tool execution framework
 */

/**
 * Context passed to tool handlers during execution
 */
export interface ToolContext {
    runId: string;
    assignmentId: string;
    userId?: string;
    timeout?: number;
    /** The end user's OAuth2/Keycloak bearer token for the originating request.
     *  CONTRACT: forward this ONLY to internal, user-scoped bouc.io services
     *  (e.g. memory-api) so they can enforce per-user authorization. It MUST NOT
     *  be sent to any external endpoint — external handlers (http_request,
     *  fetch_page, web_search, MCP proxies) carry their own credentials and must
     *  ignore this field, or the user's JWT would leak off-platform. */
    accessToken?: string;
}

/**
 * Result returned from tool execution
 */
export interface ToolResult {
    success: boolean;
    output: unknown;
    error?: string;
    /** Trust level of this result's content. 'untrusted' = externally influenced
     *  (web pages, search results, MCP servers); spotlighted in prompts and treated
     *  as data, never instructions. Defaults to 'untrusted' when unset. */
    trust?: 'trusted' | 'untrusted';
    /** Optional provenance label (e.g. originating tool or URL). */
    source?: string;
}

/**
 * Tool handler interface - each tool must implement this
 */
export interface ToolHandler {
    name: string;
    execute: (
        args: Record<string, unknown>,
        context: ToolContext
    ) => Promise<ToolResult>;
    /** Optional policy carried on the handler itself. Used for tools with no
     *  `Tool` DB row (e.g. MCP proxy handlers): the registry falls back to this
     *  so the executor's approval gate can still reach them. */
    policy?: ToolPolicy;
    /** Default trust level for results from this handler when the result does not
     *  set one (e.g. MCP handlers default to 'untrusted'). */
    trust?: 'trusted' | 'untrusted';
}

/**
 * Policy configuration for tool execution
 */
export interface ToolPolicy {
    requires_approval?: boolean;
    /** When true, the tool mutates external state. The executor requires approval
     *  for it whenever untrusted content is present in the run context. */
    state_changing?: boolean;
    /** Soft cap on calls per run (advisory). */
    max_calls_per_run?: number;
    rate_limit?: {
        calls: number;
        window_seconds: number;
    };
    timeout_ms?: number;
}

/**
 * Tool definition stored in database
 */
export interface ToolDefinition {
    id: string;
    name: string;
    description: string | null;
    schema: Record<string, unknown> | null;
    policy: ToolPolicy | null;
    enabled: boolean;
}
