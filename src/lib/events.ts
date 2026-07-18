import { redis } from './redis';
import { createComponentLogger } from './logger';

const log = createComponentLogger('events');

/**
 * Event types for run lifecycle
 */
export type RunEventType =
    | 'run.status'
    | 'run.snapshot'
    | 'plan.created'
    | 'plan.updated'
    | 'step.reasoning'
    | 'tool.call'
    | 'tool.result'
    | 'tool.client_call'
    | 'tool.approval_required'
    | 'tool.approval_resolved'
    | 'message.created'
    | 'run.completed'
    | 'run.failed'
    | 'run.cancelled'
    | 'run.usage'
    | 'distill.triggered';

/**
 * Run event structure
 */
export interface RunEvent {
    type: RunEventType;
    data: Record<string, unknown>;
    timestamp: string;
}

/**
 * Get Redis PubSub channel name for a run
 */
export const getChannelName = (runId: string): string => {
    return `run:${runId}:events`;
};

/**
 * Publish an event to a run's channel via Redis PubSub
 */
export const publishRunEvent = async (
    runId: string,
    event: { type: RunEventType; data: Record<string, unknown> }
): Promise<void> => {
    if (!redis) {
        log.warn('Redis not available, skipping event publish');
        return;
    }

    const channel = getChannelName(runId);
    const fullEvent: RunEvent = {
        type: event.type,
        data: event.data,
        timestamp: new Date().toISOString(),
    };

    try {
        await redis.publish(channel, JSON.stringify(fullEvent));
    } catch (error) {
        log.error({ err: error, channel }, 'Failed to publish event');
    }
};
