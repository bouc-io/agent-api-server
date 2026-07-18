import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { search, SafeSearchType } from 'duck-duck-scrape';
import axios from 'axios';
import { createComponentLogger } from '../../../lib/logger';
import { extractTextFromHtml, validateFetchUrl } from './htmlExtractor';

const log = createComponentLogger('web-search-tool');

/**
 * Pool of realistic User-Agent strings to rotate
 */
const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
];

function randomUA(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * Primary search: use duck-duck-scrape library (single attempt, no retries)
 */
async function searchViaDDGScrape(
    query: string,
    maxResults: number
): Promise<SearchResult[]> {
    log.debug({ query, maxResults }, 'DDG scrape: starting search');

    const results = await search(
        query,
        { safeSearch: SafeSearchType.MODERATE },
        { headers: { 'User-Agent': randomUA() } }
    );

    const rawResults = results?.results ?? [];
    log.debug(
        { rawResultCount: rawResults.length, maxResults },
        'DDG scrape: raw results received'
    );

    if (rawResults.length === 0) {
        throw new Error('DDG scrape returned no results');
    }

    return rawResults.slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
    }));
}

/**
 * Fallback search: scrape DuckDuckGo HTML endpoint directly
 *
 * Fetches https://html.duckduckgo.com/html/?q=... and parses the
 * simplified HTML response. This endpoint is more stable than the
 * main JS-heavy page that duck-duck-scrape targets.
 *
 * Retries with exponential backoff and User-Agent rotation.
 */
const FALLBACK_MAX_RETRIES = 3;
const FALLBACK_BASE_DELAY_MS = 2000;

async function searchViaDDGHtml(
    query: string,
    maxResults: number
): Promise<SearchResult[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < FALLBACK_MAX_RETRIES; attempt++) {
        try {
            const ua = randomUA();
            const response = await axios.get(
                'https://html.duckduckgo.com/html/',
                {
                    params: { q: query },
                    headers: {
                        'User-Agent': ua,
                        Accept: 'text/html,application/xhtml+xml',
                        'Accept-Language': 'en-US,en;q=0.9',
                    },
                    timeout: 10000,
                }
            );

            const html: string = response.data;

            log.debug(
                {
                    htmlLength: html.length,
                    htmlPreview: html.slice(0, 500) + (html.length > 500 ? '... [truncated]' : ''),
                },
                'DDG HTML fallback: raw response received'
            );

            // Check for CAPTCHA / bot detection
            if (
                html.includes('DuckDuckGo bot protection') ||
                html.includes('select all squares')
            ) {
                throw new Error('DDG returned CAPTCHA challenge');
            }

            // Parse results from DDG HTML endpoint.
            // DDG periodically changes their HTML structure; we try multiple selector patterns
            // to remain resilient across versions.
            const results: SearchResult[] = [];

            // Pattern A (newer DDG): link inside <h2 class="result__title">
            const resultPatternA =
                /<h2[^>]+class="result__title"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            // Pattern B (older DDG): <a class="result__a" href="...">
            const resultPatternB =
                /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
            // Snippet: <a class="result__snippet"> or <span class="result__snippet">
            const snippetPattern =
                /<(?:a|span)[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)>/gi;

            const links: { url: string; title: string }[] = [];
            let match;

            // Try pattern A first; if it yields nothing, fall back to pattern B
            while ((match = resultPatternA.exec(html)) !== null) {
                const url = decodeURIComponent(
                    match[1].replace(/.*uddg=/, '').replace(/&.*/, '')
                );
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                if (url.startsWith('http')) {
                    links.push({ url, title });
                }
            }
            if (links.length === 0) {
                while ((match = resultPatternB.exec(html)) !== null) {
                    const url = decodeURIComponent(
                        match[1].replace(/.*uddg=/, '').replace(/&.*/, '')
                    );
                    const title = match[2].replace(/<[^>]*>/g, '').trim();
                    if (url.startsWith('http')) {
                        links.push({ url, title });
                    }
                }
            }

            const snippets: string[] = [];
            while ((match = snippetPattern.exec(html)) !== null) {
                snippets.push(match[1].replace(/<[^>]*>/g, '').trim());
            }

            if (links.length === 0) {
                log.warn(
                    { htmlSample: html.slice(0, 1000) },
                    'DDG HTML fallback: no links parsed — DDG HTML structure may have changed'
                );
            }

            log.debug(
                { linksFound: links.length, snippetsFound: snippets.length },
                'DDG HTML fallback: regex parsing complete'
            );

            for (let i = 0; i < Math.min(links.length, maxResults); i++) {
                results.push({
                    title: links[i].title,
                    url: links[i].url,
                    snippet: snippets[i] || '',
                });
            }

            log.debug({ parsedResults: results }, 'DDG HTML fallback: parsed results');

            if (results.length === 0) {
                throw new Error(
                    'DDG HTML fallback returned no parseable results'
                );
            }

            return results;
        } catch (error) {
            lastError =
                error instanceof Error ? error : new Error(String(error));

            if (attempt < FALLBACK_MAX_RETRIES - 1) {
                const delay =
                    FALLBACK_BASE_DELAY_MS * Math.pow(2, attempt);
                log.warn(
                    {
                        attempt: attempt + 1,
                        maxRetries: FALLBACK_MAX_RETRIES,
                        delay,
                        error: lastError.message,
                    },
                    'DDG HTML fallback failed, retrying'
                );
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }

    throw lastError || new Error('DDG HTML fallback retries exhausted');
}

/**
 * Third-tier fallback: DuckDuckGo Lite endpoint
 *
 * Uses a POST request to https://lite.duckduckgo.com/lite/ which returns a
 * minimal HTML table. The class names on this endpoint are much more stable
 * than the regular HTML endpoint and it is less aggressively bot-blocked.
 */
async function searchViaDDGLite(
    query: string,
    maxResults: number
): Promise<SearchResult[]> {
    log.debug({ query, maxResults }, 'DDG Lite: starting search');

    const response = await axios.post(
        'https://lite.duckduckgo.com/lite/',
        new URLSearchParams({ q: query, s: '0' }).toString(),
        {
            headers: {
                'User-Agent': randomUA(),
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 12000,
        }
    );

    const html: string = response.data;

    log.debug(
        { htmlLength: html.length },
        'DDG Lite: raw response received'
    );

    if (
        html.includes('DuckDuckGo bot protection') ||
        html.includes('select all squares')
    ) {
        throw new Error('DDG Lite returned CAPTCHA challenge');
    }

    const results: SearchResult[] = [];

    // DDG Lite result links are plain <a> tags inside <td class="result-link">
    // Snippets are in <td class="result-snippet">
    const linkRe =
        /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe =
        /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    // Also try the uddg= redirect-style URLs that DDG Lite may still use
    const links: { url: string; title: string }[] = [];
    const snippets: string[] = [];

    let m: RegExpExecArray | null;

    // Extract result links from the result-link table cells.
    // DDG Lite uses "result-link" in some versions and "result-link-td" in others.
    const resultLinkCellRe =
        /<td[^>]*class="result-link(?:-td)?"[^>]*>([\s\S]*?)<\/td>/gi;
    while ((m = resultLinkCellRe.exec(html)) !== null) {
        const cellHtml = m[1];
        const aMatch = linkRe.exec(cellHtml);
        linkRe.lastIndex = 0; // reset stateful regex
        if (aMatch) {
            let url = aMatch[1];
            // Unwrap DDG redirect URLs (//duckduckgo.com/l/?uddg=...)
            if (url.includes('uddg=')) {
                url = decodeURIComponent(url.replace(/.*uddg=/, '').replace(/&.*/, ''));
            }
            const title = cellHtml.replace(/<[^>]*>/g, '').trim();
            if (url.startsWith('http')) {
                links.push({ url, title });
            }
        }
    }

    while ((m = snippetRe.exec(html)) !== null) {
        snippets.push(m[1].replace(/<[^>]*>/g, '').trim());
    }

    if (links.length === 0) {
        log.warn(
            { htmlSample: html.slice(0, 1000) },
            'DDG Lite: no links parsed — DDG Lite HTML structure may have changed'
        );
    }

    log.debug(
        { linksFound: links.length, snippetsFound: snippets.length },
        'DDG Lite: parsing complete'
    );

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
        results.push({
            title: links[i].title,
            url: links[i].url,
            snippet: snippets[i] || '',
        });
    }

    if (results.length === 0) {
        throw new Error('DDG Lite returned no parseable results');
    }

    return results;
}

const TOP_RESULT_EXCERPT_LENGTH = 2000;
const TOP_RESULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch and extract a short text preview from a URL.
 * Errors are swallowed — a failed fetch should not invalidate the search results.
 */
async function fetchTopResultPreview(
    url: string
): Promise<{ url: string; title: string; excerpt: string } | null> {
    const validation = validateFetchUrl(url);
    if (!validation.valid) return null;

    try {
        const response = await axios.get<string>(url, {
            timeout: TOP_RESULT_FETCH_TIMEOUT_MS,
            maxContentLength: 5 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; bouc-agent/1.0; +https://bouc.io)',
                Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
            },
            responseType: 'text',
            validateStatus: (s) => s >= 200 && s < 300,
        });

        const contentType = (response.headers['content-type'] as string) || '';
        if (!contentType.includes('html')) return null;

        const extracted = extractTextFromHtml(String(response.data), {
            maxLength: TOP_RESULT_EXCERPT_LENGTH,
        });

        return { url, title: extracted.title, excerpt: extracted.content };
    } catch {
        return null;
    }
}

/**
 * Web Search Tool - Searches the web using DuckDuckGo
 *
 * Strategy:
 * 1. Try duck-duck-scrape library (single attempt, fast path)
 * 2. On failure, fall back to DDG HTML endpoint scraping (with retries)
 *
 * Optional: set fetch_top_result=true to also fetch and extract text from
 * the top search result URL (provides richer content than the snippet alone).
 */
export const webSearchTool: ToolHandler = {
    trust: 'untrusted',
    name: 'web_search',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        // Defensive: unwrap if LLM wrapped args in an "object" key (llama3.2 quirk)
        let effectiveArgs = args;
        if (args.object && !args.query) {
            try {
                const parsed =
                    typeof args.object === 'string'
                        ? JSON.parse(args.object)
                        : args.object;
                if (parsed && typeof parsed === 'object') {
                    effectiveArgs = parsed as Record<string, unknown>;
                }
            } catch {
                // Use original args if unwrapping fails
            }
        }

        const query = effectiveArgs.query as string;
        const maxResults = (effectiveArgs.max_results as number) || 5;
        const fetchTopResult = Boolean(effectiveArgs.fetch_top_result);

        log.debug({ query, maxResults, fetchTopResult, rawArgs: args }, 'web_search: execute called');

        if (!query) {
            return {
                success: false,
                output: null,
                error: 'Missing required parameter: query',
            };
        }

        let results: SearchResult[] | null = null;

        // 1. Try duck-duck-scrape (single attempt)
        try {
            results = await searchViaDDGScrape(query, maxResults);
            log.info({ query, resultCount: results.length }, 'DDG scrape search succeeded');
        } catch (primaryError) {
            const primaryMsg =
                primaryError instanceof Error ? primaryError.message : 'Unknown error';
            log.warn({ query, error: primaryMsg }, 'DDG scrape failed, trying HTML fallback');
        }

        // 2. Fallback: DDG HTML endpoint
        if (!results) {
            try {
                results = await searchViaDDGHtml(query, maxResults);
                log.info({ query, resultCount: results.length }, 'DDG HTML fallback succeeded');
            } catch (fallbackError) {
                const fallbackMsg =
                    fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
                log.warn({ query, error: fallbackMsg }, 'DDG HTML fallback failed, trying DDG Lite');
            }
        }

        // 3. Third-tier fallback: DDG Lite endpoint (more stable HTML structure)
        if (!results) {
            try {
                results = await searchViaDDGLite(query, maxResults);
                log.info({ query, resultCount: results.length }, 'DDG Lite fallback succeeded');
            } catch (liteError) {
                const liteMsg =
                    liteError instanceof Error ? liteError.message : 'Unknown error';
                log.error({ query, error: liteMsg }, 'All DDG search strategies failed');
                return {
                    success: false,
                    output: null,
                    error: `Web search failed: ${liteMsg}`,
                };
            }
        }

        // 3. Optionally fetch top result content
        let topResultContent: { url: string; title: string; excerpt: string } | null = null;
        if (fetchTopResult && results.length > 0) {
            topResultContent = await fetchTopResultPreview(results[0].url);
            if (topResultContent) {
                log.debug({ url: results[0].url }, 'web_search: fetched top result content');
            }
        }

        const output: Record<string, unknown> = {
            query,
            results,
            result_count: results.length,
        };
        if (topResultContent) {
            output.top_result_content = topResultContent;
        }

        return { success: true, output };
    },
};
