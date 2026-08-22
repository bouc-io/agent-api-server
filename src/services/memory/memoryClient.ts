import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { tokenManager } from '../../lib/tokenManager';
import { createComponentLogger } from '../../lib/logger';

const log = createComponentLogger('memory-client');

/**
 * Memory search result from the Memory Service
 */
export interface MemorySearchResult {
    id: string;
    content: string;
    category: string;
    importance: string;
    confidence: number;
    memory_type?: string;   // "distilled" | "neuralese" — defaults to "distilled" if absent
    session_shared?: boolean;
}

/**
 * Memory search request
 */
interface MemorySearchRequest {
    query: string;
    user_id: string;
    limit?: number;
}

/**
 * Hybrid retrieval request (tiered: critical → high semantic → fill)
 */
interface MemoryRetrieveRequest {
    query: string;
    limit?: number;
}

/**
 * Memory Service Client
 * Handles communication with the external Memory Service for context retrieval
 */
export class MemoryClient {
    private baseUrl: string;
    private enabled: boolean;
    private axiosInstance: AxiosInstance;

    constructor() {
        this.baseUrl = process.env.MEMORY_SERVICE_URL || '';
        this.enabled = process.env.MEMORY_SERVICE_ENABLED === 'true';

        const allowSelfSigned = process.env.ALLOW_SELF_SIGNED_CERTS === 'true';
        this.axiosInstance = axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: !allowSelfSigned,
            }),
            timeout: 10000, // 10 second timeout
        });
    }

    /**
     * Check if memory service is enabled
     */
    isEnabled(): boolean {
        return this.enabled && !!this.baseUrl;
    }

    /**
     * Tiered hybrid retrieval: critical always first, then high-importance semantic,
     * then fill remaining slots with medium/low.
     *
     * @param query - The search query for semantic tiers
     * @param assignmentId - Assignment context (used to scope the request URL)
     * @param userId - Not used for auth (JWT scopes it), kept for logging
     * @param requestToken - Optional OAuth2 token
     * @param limit - Total max memories to return (default: 10)
     */
    async retrieveMemories(
        query: string,
        assignmentId: string,
        userId: string,
        requestToken?: string,
        limit: number = 10
    ): Promise<MemorySearchResult[]> {
        if (!this.isEnabled()) {
            log.debug('Memory service disabled, skipping retrieval');
            return [];
        }

        try {
            const accessToken = requestToken || (await tokenManager.getAccessToken());

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (accessToken) {
                headers['Authorization'] = `Bearer ${accessToken}`;
            }

            const request: MemoryRetrieveRequest = { query, limit };

            const response = await this.axiosInstance.post<{
                memories: MemorySearchResult[];
            }>(`${this.baseUrl}/v1/assignments/${assignmentId}/memories/retrieve`, request, { headers });

            return response.data.memories || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                log.error({ status: error.response?.status, err: error }, 'Memory retrieval failed');
            } else {
                log.error({ err: error }, 'Memory retrieval failed');
            }
            return [];
        }
    }

    /**
     * Search for relevant memories based on a query
     *
     * @param query - The search query (typically the last user message)
     * @param userId - The user ID to scope the search
     * @param requestToken - Optional OAuth2 token from the original request (takes precedence over global token)
     * @param limit - Maximum number of results to return (default: 5)
     * @returns Array of memory search results
     */
    async searchMemories(
        query: string,
        userId: string,
        requestToken?: string,
        limit: number = 5
    ): Promise<MemorySearchResult[]> {
        if (!this.isEnabled()) {
            log.debug('Memory service disabled, skipping search');
            return [];
        }

        try {
            // Use request token if provided, otherwise fall back to global token
            const accessToken = requestToken || (await tokenManager.getAccessToken());

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (accessToken) {
                headers['Authorization'] = `Bearer ${accessToken}`;
            }

            const request: MemorySearchRequest = {
                query,
                user_id: userId,
                limit,
            };

            const response = await this.axiosInstance.post<{
                memories: MemorySearchResult[];
            }>(`${this.baseUrl}/v1/memories/search`, request, { headers });

            return response.data.memories || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                log.error({ status: error.response?.status, err: error }, 'Memory search failed');
            } else {
                log.error({ err: error }, 'Memory search failed');
            }
            // Return empty array on error - don't fail the run
            return [];
        }
    }
}

// Export singleton instance
export const memoryClient = new MemoryClient();
