import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { createComponentLogger } from '../../../lib/logger';

const log = createComponentLogger('text-extract-tool');

const MAX_TEXT_LENGTH = 100_000;

/**
 * Text Extract Tool - Regex-based text extraction and manipulation
 *
 * Supports find_all, find_first, extract_groups, and replace operations.
 */
export const textExtractTool: ToolHandler = {
    trust: 'trusted',
    name: 'text_extract',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        const text = args.text as string;
        const pattern = args.pattern as string;
        const flags = (args.flags as string) ?? 'g';
        const operation = args.operation as string;
        const replacement = args.replacement as string | undefined;

        // Validate required params
        if (!text || typeof text !== 'string') {
            return { success: false, output: null, error: 'Missing required parameter: text' };
        }
        if (!pattern || typeof pattern !== 'string') {
            return { success: false, output: null, error: 'Missing required parameter: pattern' };
        }
        if (!operation) {
            return { success: false, output: null, error: 'Missing required parameter: operation' };
        }
        if (!['find_all', 'find_first', 'extract_groups', 'replace'].includes(operation)) {
            return {
                success: false,
                output: null,
                error: `Invalid operation: "${operation}". Must be one of: find_all, find_first, extract_groups, replace`,
            };
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return {
                success: false,
                output: null,
                error: `Text too long: ${text.length} chars (max ${MAX_TEXT_LENGTH})`,
            };
        }

        // Validate regex flags
        const validFlags = /^[gimsud]*$/.test(flags);
        if (!validFlags) {
            return { success: false, output: null, error: `Invalid regex flags: "${flags}". Allowed: g, i, m, s, u, d` };
        }

        // Build regex — catch invalid patterns
        let regex: RegExp;
        try {
            // For find_all and replace we need the global flag; for find_first we don't
            const effectiveFlags =
                operation === 'find_first'
                    ? flags.replace('g', '')
                    : flags.includes('g')
                    ? flags
                    : flags + 'g';
            regex = new RegExp(pattern, effectiveFlags);
        } catch (err) {
            return {
                success: false,
                output: null,
                error: `Invalid regex pattern: ${(err as Error).message}`,
            };
        }

        log.debug({ operation, pattern, flags }, 'text_extract: execute');

        switch (operation) {
            case 'find_all': {
                const matches = Array.from(text.matchAll(regex)).map((m) => m[0]);
                return {
                    success: true,
                    output: { matches, count: matches.length },
                };
            }

            case 'find_first': {
                const match = text.match(regex);
                return {
                    success: true,
                    output: {
                        match: match ? match[0] : null,
                        index: match ? (match.index ?? null) : null,
                    },
                };
            }

            case 'extract_groups': {
                const groupMatches = Array.from(text.matchAll(regex)).map((m) => ({
                    full: m[0],
                    groups: (m.groups ?? {}) as Record<string, string | undefined>,
                    indexed: m.slice(1),
                }));
                return {
                    success: true,
                    output: { matches: groupMatches, count: groupMatches.length },
                };
            }

            case 'replace': {
                if (replacement === undefined) {
                    return {
                        success: false,
                        output: null,
                        error: 'Missing required parameter: replacement (required for replace operation)',
                    };
                }
                // Count matches before replacing
                const countRegex = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
                const replacementCount = Array.from(text.matchAll(countRegex)).length;
                // Perform replacement — supports $1, $2, $<name> backreferences natively
                const result = text.replace(regex, replacement);
                return {
                    success: true,
                    output: { result, replacement_count: replacementCount },
                };
            }

            default:
                return { success: false, output: null, error: `Unknown operation: ${operation}` };
        }
    },
};
