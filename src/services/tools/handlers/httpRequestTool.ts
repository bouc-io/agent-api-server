import { ToolHandler, ToolContext, ToolResult } from '../../../types/tool';
import { createComponentLogger } from '../../../lib/logger';
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { getPreConfiguredAPI, isValidAPIId } from './apiRegistry';
import { resolvePath } from './jsonQueryTool';

const log = createComponentLogger('http-request-tool');

// Security constants
const MAX_REQUEST_BODY_SIZE = 1024 * 1024; // 1MB
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const MAX_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_RESPONSE_CHARS = 50_000;

/**
 * HTTP Request Tool - Make HTTP requests to external APIs
 *
 * Supports both pre-configured APIs (like Open-Meteo) and custom URLs
 * with comprehensive security validation and error handling.
 */
export const httpRequestTool: ToolHandler = {
    trust: 'untrusted',
    name: 'http_request',

    async execute(
        args: Record<string, unknown>,
        _context: ToolContext
    ): Promise<ToolResult> {
        const startTime = Date.now();

        // Extract and validate parameters
        const apiId = args.api_id as string | undefined;
        const customUrl = args.url as string | undefined;
        // For pre-configured APIs, default to the API's first allowed method (e.g. GET for Open-Meteo)
        // rather than always defaulting to GET. This prevents the LLM from inadvertently using POST.
        const methodDefault = apiId
            ? (getPreConfiguredAPI(apiId)?.methods[0] ?? 'GET')
            : 'GET';
        const method = ((args.method as string) || methodDefault).toUpperCase();
        const endpoint = args.endpoint as string | undefined;
        // LLMs sometimes serialize params as a JSON string instead of an object.
        // Attempt to parse it so axios receives a proper object for query param serialization
        // and avoids the "target must be an object" error from axios internals.
        let rawParams = args.params;
        if (typeof rawParams === 'string') {
            try {
                rawParams = JSON.parse(rawParams) as Record<string, unknown>;
            } catch {
                // Leave as-is; the catch block below will handle the resulting axios error
            }
        }
        const params = rawParams as Record<string, unknown> | undefined;
        const headers = args.headers as Record<string, string> | undefined;
        const body = args.body as Record<string, unknown> | undefined;
        const timeout = Math.min((args.timeout as number) || DEFAULT_TIMEOUT, MAX_TIMEOUT);
        const maxResponseChars = (args.max_response_chars as number) ?? DEFAULT_MAX_RESPONSE_CHARS;
        const jsonPath = args.json_path as string | undefined;

        log.debug(
            { apiId, customUrl, method, endpoint, hasParams: !!params, hasBody: !!body, jsonPath, maxResponseChars },
            'http_request: execute called'
        );

        // Validate: Must provide either api_id or url
        if (!apiId && !customUrl) {
            return {
                success: false,
                output: null,
                error: 'Must provide either api_id (for pre-configured APIs) or url (for custom requests)',
            };
        }

        // Validate: Cannot provide both api_id and url
        if (apiId && customUrl) {
            return {
                success: false,
                output: null,
                error: 'Cannot provide both api_id and url. Choose one approach.',
            };
        }

        // Validate HTTP method
        if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            return {
                success: false,
                output: null,
                error: `Invalid HTTP method: ${method}. Allowed: GET, POST, PUT, DELETE, PATCH`,
            };
        }

        // Build final URL
        let finalUrl: string;
        let apiUsed: string | undefined;

        if (apiId) {
            // Use pre-configured API
            if (!isValidAPIId(apiId)) {
                return {
                    success: false,
                    output: null,
                    error: `Unknown API ID: ${apiId}. Use /v1/tools to see available APIs.`,
                };
            }

            const api = getPreConfiguredAPI(apiId);
            if (!api) {
                return {
                    success: false,
                    output: null,
                    error: `Failed to load API configuration for: ${apiId}`,
                };
            }

            // Validate method is allowed for this API
            if (!api.methods.includes(method)) {
                return {
                    success: false,
                    output: null,
                    error: `Method ${method} not allowed for ${api.name}. Allowed methods: ${api.methods.join(', ')}`,
                };
            }

            // Build URL from base + endpoint
            if (!endpoint) {
                const endpointHints = (api.exampleEndpoints ?? [])
                    .map((e) => {
                        const requiredParams = Object.keys(e.params ?? {}).join(', ');
                        return `"${e.path}"${requiredParams ? ` (required params: ${requiredParams})` : ''}`;
                    })
                    .join(' | ');
                return {
                    success: false,
                    output: null,
                    error: `endpoint is required when using api_id "${apiId}". Available endpoints: ${endpointHints || '(see API docs)'}`,
                };
            }

            // Remove leading slash if present to avoid double slashes
            const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
            finalUrl = `${api.baseUrl}${cleanEndpoint}`;
            apiUsed = apiId;

            log.debug({ apiId, apiName: api.name, finalUrl }, 'Using pre-configured API');
        } else {
            // Use custom URL
            finalUrl = customUrl!;

            // Validate custom URL
            const validation = validateUrl(finalUrl);
            if (!validation.valid) {
                return {
                    success: false,
                    output: null,
                    error: validation.error,
                };
            }

            log.debug({ customUrl: finalUrl }, 'Using custom URL');
        }

        // Validate request body size
        if (body) {
            const bodySize = JSON.stringify(body).length;
            if (bodySize > MAX_REQUEST_BODY_SIZE) {
                return {
                    success: false,
                    output: null,
                    error: `Request body too large: ${bodySize} bytes (max: ${MAX_REQUEST_BODY_SIZE})`,
                };
            }
        }

        // Build axios config
        const axiosConfig: AxiosRequestConfig = {
            method,
            url: finalUrl,
            params,
            headers: {
                'User-Agent': 'bouc.io-agent-api-server/1.0',
                ...headers,
            },
            data: body,
            timeout,
            maxContentLength: MAX_RESPONSE_SIZE,
            maxBodyLength: MAX_REQUEST_BODY_SIZE,
            validateStatus: () => true, // Don't throw on any status code
        };

        // Execute HTTP request
        try {
            log.info({ method, url: finalUrl, apiUsed }, 'Executing HTTP request');

            const response: AxiosResponse = await axios(axiosConfig);
            const duration = Date.now() - startTime;

            log.info(
                {
                    method,
                    url: finalUrl,
                    status: response.status,
                    duration_ms: duration,
                },
                'HTTP request completed'
            );

            // B: Treat 4xx/5xx status codes as failures
            if (response.status >= 400) {
                const bodyStr =
                    typeof response.data === 'string'
                        ? response.data
                        : JSON.stringify(response.data);
                const excerpt = bodyStr.slice(0, 300);
                log.warn(
                    { url: finalUrl, status: response.status, duration_ms: duration },
                    'HTTP request returned error status'
                );
                return {
                    success: false,
                    output: null,
                    error: `HTTP ${response.status} ${response.statusText}: ${excerpt}`,
                };
            }

            // E: Apply json_path extraction if requested
            let responseData: unknown = response.data;
            let jsonPathApplied = false;
            if (jsonPath) {
                let parsedData: unknown = responseData;
                if (typeof responseData === 'string') {
                    try {
                        parsedData = JSON.parse(responseData);
                    } catch {
                        return {
                            success: false,
                            output: null,
                            error: 'json_path requires a JSON response body, but the response is not valid JSON',
                        };
                    }
                }
                const extracted = resolvePath(parsedData, jsonPath);
                if (extracted === undefined) {
                    return {
                        success: false,
                        output: null,
                        error: `json_path "${jsonPath}" not found in response`,
                    };
                }
                responseData = extracted;
                jsonPathApplied = true;
            }

            // A: Truncate large responses to protect LLM context window
            let truncated = false;
            let originalSizeChars: number | undefined;
            const serialized =
                typeof responseData === 'string'
                    ? responseData
                    : JSON.stringify(responseData);
            if (serialized.length > maxResponseChars) {
                originalSizeChars = serialized.length;
                responseData = serialized.slice(0, maxResponseChars) + '... [truncated]';
                truncated = true;
            }

            const output: Record<string, unknown> = {
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                api_used: apiUsed,
                url: finalUrl,
                duration_ms: duration,
                truncated,
            };
            if (truncated) output.original_size_chars = originalSizeChars;
            if (jsonPathApplied) output.json_path = jsonPath;

            // Warn when the API returned a successful status but an empty body.
            // This typically means required query parameters (e.g. latitude/longitude
            // for /forecast, or name for /search) were not sent.
            if (responseData === '' || responseData === null || responseData === undefined) {
                output.warning =
                    'Response body is empty — the API likely requires additional query params ' +
                    'that were not included. ' +
                    (apiId === 'open_meteo_weather'
                        ? 'For /forecast include: latitude, longitude, current_weather=true.'
                        : apiId === 'open_meteo_geocoding'
                          ? 'For /search include: name (city name), count=1.'
                          : 'Check the params field and the API documentation.');
            }

            return { success: true, output };
        } catch (error) {
            const duration = Date.now() - startTime;

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;

                // D: Handle timeout — both ECONNABORTED (axios) and ETIMEDOUT (TCP)
                if (
                    axiosError.code === 'ECONNABORTED' ||
                    axiosError.code === 'ETIMEDOUT'
                ) {
                    log.warn({ url: finalUrl, timeout, duration_ms: duration }, 'HTTP request timeout');
                    return {
                        success: false,
                        output: null,
                        error: `Request timeout after ${timeout}ms`,
                    };
                }

                // Handle network errors
                if (axiosError.code === 'ENOTFOUND' || axiosError.code === 'ECONNREFUSED') {
                    log.warn({ url: finalUrl, code: axiosError.code }, 'Network error');
                    return {
                        success: false,
                        output: null,
                        error: `Network error: Unable to reach ${finalUrl}`,
                    };
                }

                // Generic axios error
                const errorMsg = axiosError.message || 'Unknown HTTP error';
                log.error({ url: finalUrl, error: errorMsg, duration_ms: duration }, 'HTTP request failed');
                return {
                    success: false,
                    output: null,
                    error: `HTTP request failed: ${errorMsg}`,
                };
            }

            // Unknown error
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error({ url: finalUrl, error: errorMessage, duration_ms: duration }, 'Unexpected error');
            return {
                success: false,
                output: null,
                error: `Unexpected error: ${errorMessage}`,
            };
        }
    },
};

/**
 * Validate URL for security concerns
 */
function validateUrl(url: string): { valid: boolean; error?: string } {
    try {
        const parsed = new URL(url);

        // Only allow HTTP and HTTPS
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return {
                valid: false,
                error: `Invalid protocol: ${parsed.protocol}. Only http: and https: are allowed.`,
            };
        }

        // Block localhost
        if (
            parsed.hostname === 'localhost' ||
            parsed.hostname === '127.0.0.1' ||
            parsed.hostname === '0.0.0.0' ||
            parsed.hostname === '::1'
        ) {
            return {
                valid: false,
                error: 'Requests to localhost are not allowed for security reasons.',
            };
        }

        // Block .local domains
        if (parsed.hostname.endsWith('.local')) {
            return {
                valid: false,
                error: 'Requests to .local domains are not allowed for security reasons.',
            };
        }

        // Block private IP ranges (IPv4 and IPv6)
        if (isPrivateIP(parsed.hostname)) {
            return {
                valid: false,
                error: 'Requests to private IP addresses are not allowed for security reasons.',
            };
        }

        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            error: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Check if hostname is a private IP address (IPv4 or IPv6).
 */
function isPrivateIP(hostname: string): boolean {
    // IPv4 private ranges
    const ipv4Patterns = [
        /^10\./,                           // 10.0.0.0/8
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
        /^192\.168\./,                     // 192.168.0.0/16
        /^169\.254\./,                     // 169.254.0.0/16 (link-local)
    ];

    if (ipv4Patterns.some((p) => p.test(hostname))) return true;

    // C: IPv6 private ranges
    // Node URL parser strips brackets: http://[::1]/ → hostname "::1"
    const h = hostname.toLowerCase();
    const ipv6Patterns = [
        /^fc[0-9a-f]{2}:/,  // fc00::/7 unique local (fc prefix)
        /^fd[0-9a-f]{2}:/,  // fc00::/7 unique local (fd prefix)
        /^fe[89ab][0-9a-f]:/, // fe80::/10 link-local
        /^::ffff:/,          // IPv4-mapped IPv6 addresses
    ];

    return ipv6Patterns.some((p) => p.test(h));
}
