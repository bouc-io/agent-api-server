import Redis from 'ioredis';
import { prisma } from '../../lib/prisma';
import { enqueueRunExecution } from '../../lib/queue';
import { getChannelName } from '../../lib/events';
import { createComponentLogger } from '../../lib/logger';

const log = createComponentLogger('subagent');

const MAX_DEPTH = parseInt(process.env.SUBAGENT_MAX_DEPTH || '2', 10);
const MAX_CONCURRENT = parseInt(process.env.SUBAGENT_MAX_CONCURRENT || '3', 10);
const TIMEOUT_MS = parseInt(process.env.SUBAGENT_TIMEOUT_MS || '300000', 10);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

let active = 0;

export interface SubagentInput {
    parentAssignmentId: string;
    parentRunId: string;
    userId?: string;
    orgId?: string;
    goal: string;
    contextText?: string;
    clientType?: string;
}

export interface SubagentResult {
    success: boolean;
    response?: string;
    childRunId?: string;
    childAssignmentId?: string;
    status?: string;
    error?: string;
}

function readDepth(settings: unknown): number {
    if (settings && typeof settings === 'object') {
        const d = (settings as Record<string, unknown>).subagent_depth;
        if (typeof d === 'number') return d;
    }
    return 0;
}

/**
 * Spawn a scoped child run that reuses the existing BullMQ run machinery, wait for
 * it to finish, and return its final assistant message as the result.
 *
 * Guards: recursion depth (SUBAGENT_MAX_DEPTH, tracked on the child assignment's
 * settings) and in-process concurrency (SUBAGENT_MAX_CONCURRENT). The child runs
 * with its own assignment/context and its own token budget. Completion is detected
 * via the run's Redis event channel, with a DB status poll as a backstop.
 */
export async function runSubagent(input: SubagentInput): Promise<SubagentResult> {
    const parent = await prisma.assignment.findUnique({
        where: { id: input.parentAssignmentId },
        select: { settings: true },
    });
    const parentDepth = readDepth(parent?.settings);
    if (parentDepth >= MAX_DEPTH) {
        return { success: false, error: `Sub-agent depth limit (${MAX_DEPTH}) reached; cannot spawn further sub-agents.` };
    }
    if (active >= MAX_CONCURRENT) {
        return { success: false, error: `Too many concurrent sub-agents (max ${MAX_CONCURRENT}); run them sequentially.` };
    }

    active++;
    try {
        const child = await prisma.assignment.create({
            data: {
                title: `Sub-agent: ${input.goal.slice(0, 80)}`,
                user_id: input.userId || 'subagent',
                org_id: input.orgId ?? null,
                settings: { subagent_depth: parentDepth + 1, parent_run_id: input.parentRunId },
                metadata: { kind: 'subagent', parent_assignment_id: input.parentAssignmentId },
            },
            select: { id: true },
        });

        const prompt = input.contextText ? `${input.goal}\n\nContext:\n${input.contextText}` : input.goal;
        const msg = await prisma.message.create({
            data: { assignment_id: child.id, role: 'user', content: prompt },
            select: { id: true },
        });

        const childRun = await prisma.run.create({
            data: {
                assignment_id: child.id,
                user_id: input.userId ?? null,
                org_id: input.orgId ?? null,
                trigger_message_id: msg.id,
                status: 'queued',
            },
            select: { id: true },
        });

        return await new Promise<SubagentResult>((resolve) => {
            const redisUrl = process.env.REDIS_URL;
            const base = { childRunId: childRun.id, childAssignmentId: child.id };
            if (!redisUrl) {
                resolve({ success: false, error: 'Redis not available for sub-agent orchestration', ...base });
                return;
            }

            const channel = getChannelName(childRun.id);
            const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
            let settled = false;
            let poll: ReturnType<typeof setInterval> | null = null;

            const cleanup = () => {
                if (settled) return;
                settled = true;
                if (poll) clearInterval(poll);
                clearTimeout(timer);
                subscriber.unsubscribe(channel).catch(() => {});
                subscriber.quit().catch(() => {});
            };

            const finish = async (status: string) => {
                if (settled) return;
                cleanup();
                if (status === 'completed') {
                    const last = await prisma.message.findFirst({
                        where: { assignment_id: child.id, role: 'assistant' },
                        orderBy: { created_at: 'desc' },
                        select: { content: true },
                    });
                    resolve({ success: true, status, response: last?.content ?? '', ...base });
                } else {
                    resolve({ success: false, status, error: `Sub-agent run ${status}`, ...base });
                }
            };

            const timer = setTimeout(() => {
                cleanup();
                resolve({ success: false, status: 'timeout', error: `Sub-agent timed out after ${TIMEOUT_MS}ms`, ...base });
            }, TIMEOUT_MS);

            subscriber.subscribe(channel, (err) => {
                if (err) {
                    cleanup();
                    resolve({ success: false, error: `Failed to subscribe to sub-agent channel: ${err.message}`, ...base });
                }
            });

            subscriber.on('message', (_ch: string, message: string) => {
                try {
                    const evt = JSON.parse(message) as { type: string };
                    if (evt.type === 'run.completed') void finish('completed');
                    else if (evt.type === 'run.failed') void finish('failed');
                    else if (evt.type === 'run.cancelled') void finish('cancelled');
                } catch {
                    /* ignore malformed event */
                }
            });

            // Backstop: poll run status in case a pub/sub event is missed.
            poll = setInterval(async () => {
                try {
                    const r = await prisma.run.findUnique({ where: { id: childRun.id }, select: { status: true } });
                    if (r && TERMINAL.has(r.status)) void finish(r.status);
                } catch {
                    /* ignore transient DB errors */
                }
            }, 3000);

            // Enqueue after the subscription + poll are in place.
            enqueueRunExecution({
                runId: childRun.id,
                assignmentId: child.id,
                userId: input.userId || '',
                orgId: input.orgId,
                clientType: input.clientType,
            })
                .then((jobId) => {
                    if (!jobId) {
                        cleanup();
                        resolve({ success: false, error: 'Failed to enqueue sub-agent run (queue unavailable)', ...base });
                    }
                })
                .catch((e) => {
                    cleanup();
                    resolve({ success: false, error: `Failed to enqueue sub-agent: ${e instanceof Error ? e.message : 'unknown'}`, ...base });
                });
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        log.warn({ err: message }, 'sub-agent failed');
        return { success: false, error: message };
    } finally {
        active--;
    }
}
