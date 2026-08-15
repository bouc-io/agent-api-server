import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { createComponentLogger } from '../../../lib/logger';
import axios from 'axios';
import { extractTextFromHtml, validateFetchUrl } from './htmlExtractor';

const log = createComponentLogger('fetch-page-tool');

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_LENGTH = 5_000;
const MAX_ALLOWED_LENGTH = 20_000;

/**
 * Fetch Page Tool - Retrieve a URL and extract its readable text content.
 *
 * Complements web_search: web_search finds pages, fetch_page reads them.
 * Applies the same private-network security rules as http_request.
 */
export const fetchPageTool: ToolHandler = {
    trust: 'untrusted',
    name: 'fetch_page',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        const url = args.url as string;
        const selector = (args.selector as string) || 'body';
        const maxLength = Math.min(
            (args.max_length as number) || DEFAULT_MAX_LENGTH,
            MAX_ALLOWED_LENGTH
        );

        if (!url || typeof url !== 'string') {
            return { success: false, output: null, error: 'Missing required parameter: url' };
        }

        // Security: validate URL before fetching
        const validation = validateFetchUrl(url);
        if (!validation.valid) {
            return { success: false, output: null, error: validation.error };
        }

        log.debug({ url, selector, maxLength }, 'fetch_page: execute');

        try {
            const response = await axios.get<string>(url, {
                timeout: DEFAULT_TIMEOUT_MS,
                maxContentLength: 5 * 1024 * 1024, // 5MB raw HTML cap
                headers: {
                    // Polite browser-like UA so servers don't reject us
                    'User-Agent':
                        'Mozilla/5.0 (compatible; bouc-agent/1.0; +https://bouc.io)',
                    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                responseType: 'text',
                // Don't throw on non-2xx — we'll inspect status ourselves
                validateStatus: () => true,
            });

            if (response.status < 200 || response.status >= 300) {
                return {
                    success: false,
                    output: null,
                    error: `HTTP ${response.status} ${response.statusText} for URL: ${url}`,
                };
            }

            const contentType = (response.headers['content-type'] as string) || '';
            if (!contentType.includes('html')) {
                // For non-HTML (JSON, plain text, etc.) just return the raw body
                const raw = String(response.data).slice(0, maxLength);
                return {
                    success: true,
                    output: {
                        url,
                        title: '',
                        content: raw,
                        word_count: raw.split(/\s+/).filter(Boolean).length,
                        truncated: String(response.data).length > maxLength,
                        content_type: contentType,
                    },
                };
            }

            const extracted = extractTextFromHtml(String(response.data), { selector, maxLength });

            return {
                success: true,
                output: {
                    url,
                    title: extracted.title,
                    content: extracted.content,
                    word_count: extracted.word_count,
                    truncated: extracted.truncated,
                },
            };
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const msg = err.code === 'ECONNABORTED'
                    ? `Request timed out after ${DEFAULT_TIMEOUT_MS}ms`
                    : err.message;
                return { success: false, output: null, error: msg };
            }
            return { success: false, output: null, error: (err as Error).message };
        }
    },
};
