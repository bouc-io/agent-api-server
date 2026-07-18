import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';

/**
 * Echo Tool - Simple tool for testing that echoes back the input
 */
export const echoTool: ToolHandler = {
    trust: 'trusted',
    name: 'echo',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        const message = args.message as string;

        if (!message) {
            return {
                success: false,
                output: null,
                error: 'Missing required parameter: message',
            };
        }

        return {
            success: true,
            output: {
                echoed_message: message,
                timestamp: new Date().toISOString(),
            },
        };
    },
};
