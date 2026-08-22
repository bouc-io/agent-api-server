import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { tokenManager } from '../../lib/tokenManager';
import { createComponentLogger } from '../../lib/logger';

const log = createComponentLogger('distillation-client');

/**
 * Distillation source (matches memory-distiller API)
 */
export interface DistillSource {
    type: 'chat' | 'agent';
    id: string;
}

/**
 * Distillation context (matches memory-distiller API)
 */
export interface DistillContext {
    text?: string;
    messages?: Array<{
        role: string;
        content: string;
    }>;
    tool_calls?: Array<any>;
}

/**
 * Distillation request payload (matches memory-distiller API)
 */
export interface DistillRequest {
    source: DistillSource;
    context?: DistillContext;
    metadata?: {
        run_id?: string;
        user_id?: string;
        [key: string]: any;
    };
    options?: {
        max_memories?: number;
    };
}

/**
 * Distillation Service Client
 * Triggers async memory extraction after successful run completion
 */
export class DistillationClient {
    private baseUrl: string;
    private enabled: boolean;
    private axiosInstance: AxiosInstance;

    constructor() {
        this.baseUrl = process.env.DISTILLATION_SERVICE_URL || '';
        this.enabled = process.env.DISTILLATION_ENABLED === 'true';

        const allowSelfSigned = process.env.ALLOW_SELF_SIGNED_CERTS === 'true';
        this.axiosInstance = axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: !allowSelfSigned,
            }),
            timeout: parseInt(process.env.DISTILLATION_TIMEOUT_MS || '120000', 10),
        });
    }

    /**
     * Check if distillation service is enabled
     */
    isEnabled(): boolean {
        return this.enabled && !!this.baseUrl;
    }

    /**
     * Trigger memory distillation for a completed run
     * This is fire-and-forget - we don't wait for the result
     *
     * @param request - The distillation request with run data
     * @param requestToken - Optional OAuth2 token from the original request (takes precedence over global token)
     */
    async triggerDistillation(request: DistillRequest, requestToken?: string): Promise<void> {
        if (!this.isEnabled()) {
            log.debug('Distillation service disabled, skipping');
            return;
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

            // Fire-and-forget - we expect 202 Accepted
            const response = await this.axiosInstance.post(
                `${this.baseUrl}/v1/distill`,
                request,
                { headers }
            );

            if (response.status === 202 || response.status === 200) {
                log.info({ source_id: request.source.id }, 'Distillation triggered');
            } else {
                log.warn({ status: response.status }, 'Unexpected distillation response status');
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                log.error({ status: error.response?.status, err: error }, 'Distillation trigger failed');
            } else {
                log.error({ err: error }, 'Distillation trigger failed');
            }
            // Don't throw - distillation failure shouldn't fail the run
        }
    }
}

// Export singleton instance
export const distillationClient = new DistillationClient();
