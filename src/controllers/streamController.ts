import { Request, Response } from 'express';
import Redis from 'ioredis';
import { prisma } from '../lib/prisma';
import { getUserIdFromRequest } from '../lib/auth';
import { getChannelName } from '../lib/events';
import { createComponentLogger } from '../lib/logger';

const log = createComponentLogger('stream-controller');

/** SSE keep-alive interval (ms). Comment pings keep proxies from closing idle streams. */
const SSE_HEARTBEAT_MS = parseInt(process.env.SSE_HEARTBEAT_MS || '15000', 10);

/**
 * Send an SSE event to the response
 */
const sendSSE = (res: Response, event: string, data: unknown): void => {
    // Guard: don't write to a closed or ended response
    if (res.writableEnded || res.writableFinished) return;

    // Embed type in data payload as fallback for client-side SSE parser recovery
    const payload = typeof data === 'object' && data !== null
        ? { ...(data as Record<string, unknown>), type: event }
        : { value: data, type: event };
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

/**
 * Stream run events via Server-Sent Events (SSE)
 * GET /v1/assignments/:assignmentId/runs/:runId/stream
 */
export const streamRun = async (req: Request, res: Response) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
        return res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' },
        });
    }

    const assignmentId = String(req.params.assignmentId);
    const runId = String(req.params.runId);

    try {
        // Verify run exists and belongs to user
        const run = await prisma.run.findFirst({
            where: {
                id: runId,
                assignment_id: assignmentId,
                assignment: { user_id: userId },
            },
        });

        if (!run) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Run not found' },
            });
        }

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

        // Send initial status
        sendSSE(res, 'run.status', { status: run.status });

        // If already terminal, send appropriate event with details and close
        if (['completed', 'failed', 'cancelled'].includes(run.status)) {
            if (run.status === 'failed' && run.error) {
                sendSSE(res, 'run.failed', { run_id: runId, error: run.error });
            } else if (run.status === 'completed') {
                sendSSE(res, 'run.completed', { run_id: runId });
            } else if (run.status === 'cancelled') {
                sendSSE(res, 'run.cancelled', { run_id: runId });
            }
            res.end();
            return;
        }

        // Create dedicated subscriber for this stream
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            sendSSE(res, 'error', { message: 'Streaming not available' });
            res.end();
            return;
        }

        const subscriber = new Redis(redisUrl, {
            maxRetriesPerRequest: null,
        });
        const channel = getChannelName(runId);
        let isCleanedUp = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;

        // Cleanup helper to prevent multiple disconnects
        const cleanup = () => {
            if (isCleanedUp) return;
            isCleanedUp = true;

            if (heartbeat) clearInterval(heartbeat);
            try {
                subscriber.unsubscribe();
                subscriber.disconnect();
            } catch (err) {
                // Ignore errors during cleanup
            }
        };

        // Periodic keep-alive comment so idle streams aren't closed by proxies.
        heartbeat = setInterval(() => {
            if (res.writableEnded || res.writableFinished) {
                cleanup();
                return;
            }
            res.write(': keepalive\n\n');
        }, SSE_HEARTBEAT_MS);

        subscriber.subscribe(channel, (err) => {
            if (err) {
                log.error({ err }, 'Subscribe error');
                sendSSE(res, 'error', { message: 'Failed to subscribe to events' });
                res.end();
                cleanup();
                return;
            }
        });

        subscriber.on('message', (_ch: string, message: string) => {
            try {
                const event = JSON.parse(message);
                sendSSE(res, event.type, event.data);

                // Close on terminal events
                if (
                    ['run.completed', 'run.failed', 'run.cancelled'].includes(
                        event.type
                    )
                ) {
                    cleanup();
                    if (!res.writableEnded) res.end();
                }
            } catch (e) {
                log.error({ err: e }, 'Parse error');
            }
        });

        subscriber.on('error', (err) => {
            log.error({ err }, 'Redis subscriber error');
            sendSSE(res, 'error', { message: 'Connection error' });
            cleanup();
            if (!res.writableEnded) res.end();
        });

        // Cleanup on client disconnect
        req.on('close', () => {
            cleanup();
        });
    } catch (error) {
        log.error({ err: error }, 'Error streaming run');
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to stream run' },
        });
    }
};
