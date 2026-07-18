import axios from 'axios';
import https from 'https';
import { createComponentLogger } from './logger';

const log = createComponentLogger('token-manager');

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
}

interface TokenCache {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
}

/**
 * Token Manager for handling OAuth2 token refresh
 * Automatically refreshes access tokens before they expire
 */
class TokenManager {
    private cache: TokenCache | null = null;
    private refreshInProgress = false;
    private tokenEndpoint: string;
    private clientId: string;
    private initialAccessToken?: string;
    private initialRefreshToken?: string;
    private allowSelfSigned: boolean;

    constructor() {
        this.tokenEndpoint =
            process.env.OAUTH_TOKEN_ENDPOINT ||
            'https://sso.pik8s.internal/realms/users/protocol/openid-connect/token';
        this.clientId = process.env.OAUTH_CLIENT_ID || 'oauth2-proxy';
        this.initialAccessToken = process.env.OLLAMA_API_TOKEN;
        this.initialRefreshToken = process.env.OLLAMA_REFRESH_TOKEN;
        this.allowSelfSigned = process.env.ALLOW_SELF_SIGNED_CERTS === 'true';

        // Initialize cache with provided tokens
        if (this.initialAccessToken) {
            this.cache = {
                accessToken: this.initialAccessToken,
                refreshToken: this.initialRefreshToken,
                // Decode JWT to get expiration, or default to 30 min from now
                expiresAt: this.getTokenExpiration(this.initialAccessToken),
            };
        }
    }

    /**
     * Get a valid access token, refreshing if necessary
     */
    async getAccessToken(): Promise<string | undefined> {
        // No tokens configured
        if (!this.cache) {
            return undefined;
        }

        // Token still valid (with 5 minute buffer)
        const now = Date.now();
        if (this.cache.expiresAt > now + 5 * 60 * 1000) {
            return this.cache.accessToken;
        }

        // Token expired or about to expire, refresh it
        if (this.cache.refreshToken) {
            return await this.refreshToken();
        }

        // No refresh token available, return expired token (will likely fail)
        log.warn('Access token expired and no refresh token available');
        return this.cache.accessToken;
    }

    /**
     * Refresh the access token using the refresh token
     */
    private async refreshToken(): Promise<string> {
        // Prevent concurrent refresh attempts
        if (this.refreshInProgress) {
            // Wait for ongoing refresh to complete
            await new Promise((resolve) => setTimeout(resolve, 100));
            return this.getAccessToken() as Promise<string>;
        }

        this.refreshInProgress = true;

        try {
            log.info('Refreshing OAuth2 access token...');

            const response = await axios.post<TokenResponse>(
                this.tokenEndpoint,
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: this.clientId,
                    refresh_token: this.cache!.refreshToken!,
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: !this.allowSelfSigned,
                    }),
                }
            );

            const { access_token, refresh_token, expires_in } = response.data;

            // Update cache
            this.cache = {
                accessToken: access_token,
                refreshToken: refresh_token || this.cache!.refreshToken,
                expiresAt: Date.now() + expires_in * 1000,
            };

            log.info({ expires_in }, 'Token refreshed successfully');

            return access_token;
        } catch (error) {
            log.error({ err: error }, 'Failed to refresh token');
            // Return the old token and hope it still works
            return this.cache!.accessToken;
        } finally {
            this.refreshInProgress = false;
        }
    }

    /**
     * Decode JWT to extract expiration time
     */
    private getTokenExpiration(token: string): number {
        try {
            // JWT format: header.payload.signature
            const payload = token.split('.')[1];
            if (!payload) {
                // Not a JWT, default to 30 min
                return Date.now() + 30 * 60 * 1000;
            }

            const decoded = JSON.parse(
                Buffer.from(payload, 'base64').toString()
            );
            if (decoded.exp) {
                // exp is in seconds, convert to milliseconds
                return decoded.exp * 1000;
            }
        } catch (error) {
            // Failed to decode, default to 30 min
            log.warn({ err: error }, 'Failed to decode JWT expiration');
        }

        return Date.now() + 30 * 60 * 1000;
    }

    /**
     * Manually set tokens (useful for testing or external token sources)
     */
    setTokens(accessToken: string, refreshToken?: string): void {
        this.cache = {
            accessToken,
            refreshToken,
            expiresAt: this.getTokenExpiration(accessToken),
        };
    }
}

/**
 * Global token manager instance
 */
export const tokenManager = new TokenManager();
