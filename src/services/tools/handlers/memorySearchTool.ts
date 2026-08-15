import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { memoryClient } from '../../memory/memoryClient';
import { createComponentLogger } from '../../../lib/logger';

const log = createComponentLogger('memory-search-tool');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

/**
 * Memory Search Tool - Query the memory service for relevant stored memories.
 *
 * Complements the pre-loaded memory injection at run start: use this tool when
 * the agent needs to look up specific information mid-execution with a more
 * targeted query (e.g. after discovering what it needs to know from a prior step).
 *
 * Requires MEMORY_SERVICE_ENABLED=true and a running memory-api-server.
 */
export const memorySearchTool: ToolHandler = {
    trust: 'trusted',
    name: 'memory_search',

    async execute(
        args: Record<string, unknown>,
        context: ToolContext
    ): Promise<ToolResult> {
        const query = args.query as string;
        const limitRaw = args.limit as number | undefined;
        const limit = Math.min(limitRaw ?? DEFAULT_LIMIT, MAX_LIMIT);

        if (!query || typeof query !== 'string' || !query.trim()) {
            return { success: false, output: null, error: 'Missing required parameter: query' };
        }

        if (!memoryClient.isEnabled()) {
            return {
                success: true,
                output: {
                    available: false,
                    message: 'Memory service is not enabled (MEMORY_SERVICE_ENABLED is not set).',
                    memories: [],
                    count: 0,
                },
            };
        }

        const userId = context.userId;
        if (!userId) {
            return {
                success: false,
                output: null,
                error: 'Memory search requires a user context (userId not available in this run)',
            };
        }

        log.debug({ query, limit, userId }, 'memory_search: execute');

        try {
            // Forward the originating user's JWT so memory-api can authorize the
            // per-user search. Without it the client falls back to the global
            // service token, which memory-api rejects (401).
            const memories = await memoryClient.searchMemories(query, userId, context.accessToken, limit);

            return {
                success: true,
                output: {
                    available: true,
                    query,
                    memories: memories.map((m) => ({
                        id: m.id,
                        content: m.content,
                        confidence: m.confidence,
                    })),
                    count: memories.length,
                },
            };
        } catch (err) {
            const msg = (err as Error).message || 'Unknown error contacting memory service';
            log.error({ err, query }, 'memory_search: failed');
            return { success: false, output: null, error: `Memory search failed: ${msg}` };
        }
    },
};
