import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { createComponentLogger } from '../../../lib/logger';

const log = createComponentLogger('json-query-tool');

/**
 * Resolve a dot-notation path against an object.
 *
 * Supports:
 *   - Simple keys:         "name"
 *   - Nested paths:        "data.results.count"
 *   - Array indexing:      "results[0].title"
 *   - Wildcard on arrays:  "results[*].url"  → returns array of matching values
 */
export function resolvePath(obj: unknown, path: string): unknown {
    // Tokenise: split on '.' but also handle bracket notation
    // e.g. "results[0].name" → ["results", "0", "name"]
    // e.g. "results[*].url" → ["results", "*", "url"]
    const tokens = path
        .replace(/\[(\d+|\*)\]/g, '.$1') // [0] → .0, [*] → .*
        .split('.')
        .filter(Boolean);

    function walk(current: unknown, remaining: string[]): unknown {
        if (remaining.length === 0) return current;

        const [head, ...tail] = remaining;

        if (current === null || current === undefined) return undefined;

        // Wildcard: collect from all array elements
        if (head === '*') {
            if (!Array.isArray(current)) return undefined;
            return current.map((item) => walk(item, tail));
        }

        // Numeric index
        if (/^\d+$/.test(head)) {
            const idx = parseInt(head, 10);
            if (Array.isArray(current)) return walk(current[idx], tail);
            return undefined;
        }

        // Regular key access
        if (typeof current === 'object' && !Array.isArray(current)) {
            return walk((current as Record<string, unknown>)[head], tail);
        }

        return undefined;
    }

    return walk(obj, tokens);
}

/**
 * JSON Query Tool - Extract values from JSON using dot-path notation
 *
 * Useful for processing large API responses without passing the entire payload
 * back to the LLM. Supports nested access, array indexing, and wildcard selection.
 */
export const jsonQueryTool: ToolHandler = {
    trust: 'trusted',
    name: 'json_query',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        const rawData = args.data;
        const path = args.path as string;
        const defaultValue = args.default_value;

        if (!rawData) {
            return { success: false, output: null, error: 'Missing required parameter: data' };
        }
        if (!path || typeof path !== 'string') {
            return { success: false, output: null, error: 'Missing required parameter: path' };
        }

        // Strip surrounding quotes the LLM sometimes adds (e.g. `"results[0].lat"` → `results[0].lat`)
        const cleanPath = path.replace(/^["']|["']$/g, '');

        // Parse data if it's a string
        let parsed: unknown;
        if (typeof rawData === 'string') {
            try {
                parsed = JSON.parse(rawData);
            } catch {
                return {
                    success: false,
                    output: null,
                    error: 'Invalid JSON string provided in data parameter',
                };
            }
        } else {
            parsed = rawData;
        }

        log.debug({ path, cleanPath }, 'json_query: execute');

        const result = resolvePath(parsed, cleanPath);

        if (result === undefined) {
            if (defaultValue !== undefined) {
                return {
                    success: true,
                    output: {
                        path: cleanPath,
                        result: defaultValue,
                        type: typeof defaultValue,
                        used_default: true,
                    },
                };
            }
            return {
                success: false,
                output: null,
                error: `Path "${cleanPath}" not found in data`,
            };
        }

        const isArray = Array.isArray(result);
        return {
            success: true,
            output: {
                path: cleanPath,
                result,
                type: isArray ? 'array' : typeof result,
                ...(isArray ? { count: (result as unknown[]).length } : {}),
            },
        };
    },
};
