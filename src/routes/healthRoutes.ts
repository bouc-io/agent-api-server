import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { isRedisAvailable } from '../lib/redis';
import { metrics } from '../lib/metrics';
import { memoryClient } from '../services/memory/memoryClient';
import { distillationClient } from '../services/memory/distillationClient';
import axios from 'axios';
import https from 'https';

const router = Router();

/**
 * Health check result
 */
interface HealthCheckResult {
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency_ms?: number;
    error?: string;
}

/**
 * Check database health
 */
async function checkDatabase(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
        await prisma.$queryRaw`SELECT 1`;
        return {
            status: 'healthy',
            latency_ms: Date.now() - start,
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Check Redis health
 */
async function checkRedis(): Promise<HealthCheckResult> {
    if (!isRedisAvailable()) {
        return {
            status: 'degraded',
            error: 'Redis not configured',
        };
    }

    // Redis is available if isRedisAvailable returns true
    return {
        status: 'healthy',
    };
}

/**
 * Check Ollama/LLM health
 */
async function checkOllama(): Promise<HealthCheckResult> {
    const ollamaUrl = process.env.OLLAMA_URL;
    if (!ollamaUrl) {
        return {
            status: 'degraded',
            error: 'OLLAMA_URL not configured',
        };
    }

    const start = Date.now();
    try {
        const allowSelfSigned = process.env.ALLOW_SELF_SIGNED_CERTS === 'true';
        await axios.get(`${ollamaUrl}/api/tags`, {
            timeout: 5000,
            httpsAgent: new https.Agent({
                rejectUnauthorized: !allowSelfSigned,
            }),
        });
        return {
            status: 'healthy',
            latency_ms: Date.now() - start,
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Check Memory Service health
 */
async function checkMemoryService(): Promise<HealthCheckResult> {
    if (!memoryClient.isEnabled()) {
        return {
            status: 'degraded',
            error: 'Memory service not enabled',
        };
    }

    // If enabled, assume healthy (actual check would ping the service)
    return {
        status: 'healthy',
    };
}

/**
 * Check Distillation Service health
 */
async function checkDistillationService(): Promise<HealthCheckResult> {
    if (!distillationClient.isEnabled()) {
        return {
            status: 'degraded',
            error: 'Distillation service not enabled',
        };
    }

    return {
        status: 'healthy',
    };
}

/**
 * Basic health check endpoint
 * GET /health
 */
router.get('/', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
});

/**
 * Detailed health check endpoint
 * GET /health/detailed
 */
router.get('/detailed', async (_req: Request, res: Response) => {
    const [database, redis, ollama, memory, distillation] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkOllama(),
        checkMemoryService(),
        checkDistillationService(),
    ]);

    const checks = {
        database,
        redis,
        ollama,
        memory_service: memory,
        distillation_service: distillation,
    };

    // Overall status: unhealthy if database is down, degraded if other services have issues
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (database.status === 'unhealthy') {
        overallStatus = 'unhealthy';
    } else if (
        Object.values(checks).some((c) => c.status !== 'healthy')
    ) {
        overallStatus = 'degraded';
    }

    const health = {
        status: overallStatus,
        checks,
        metrics: metrics.getSummary(),
        timestamp: new Date().toISOString(),
    };

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
});

/**
 * Ready check for Kubernetes
 * GET /health/ready
 */
router.get('/ready', async (_req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'ready' });
    } catch {
        res.status(503).json({ status: 'not ready' });
    }
});

/**
 * Live check for Kubernetes
 * GET /health/live
 */
router.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'live' });
});

export default router;
