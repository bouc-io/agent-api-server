import { Queue, QueueEvents } from 'bullmq';
import { redis, isRedisAvailable } from './redis';
import { createComponentLogger } from './logger';

const log = createComponentLogger('queue');

// Queue names
export const QUEUE_NAMES = {
    RUN_EXECUTION: 'run-execution',
} as const;

// Run execution queue with enhanced retry configuration
export const runExecutionQueue =
    isRedisAvailable() && redis
        ? new Queue(QUEUE_NAMES.RUN_EXECUTION, {
              connection: redis,
              defaultJobOptions: {
                  attempts: 3, // Max 3 attempts
                  backoff: {
                      type: 'exponential',
                      delay: 5000, // 5s initial delay: 5s, 10s, 20s
                  },
                  removeOnComplete: {
                      age: 24 * 3600, // Keep completed jobs for 24 hours
                      count: 100, // Keep last 100 completed jobs
                  },
                  removeOnFail: {
                      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
                      count: 500, // Keep last 500 failed jobs
                  },
              },
          })
        : null;

// Queue events for monitoring (optional, useful for debugging)
export const runExecutionQueueEvents =
    isRedisAvailable() && redis
        ? new QueueEvents(QUEUE_NAMES.RUN_EXECUTION, { connection: redis })
        : null;

/**
 * Type definition for run execution job data
 */
export interface RunExecutionJobData {
    runId: string;
    assignmentId: string;
    userId: string;
    orgId?: string;
    accessToken?: string;
    clientType?: string; // 'cli' | 'web' — controls which tools are visible to the LLM
    /** Set by headless eval clients to request HITL auto-approval. Only honored when
     *  the server has EVAL_AUTO_APPROVE=true; ignored in production. */
    evalMode?: boolean;
}

/**
 * Enqueue a run for execution
 * @param data - The run execution job data
 * @returns The job ID if successful, null if queue is not available
 */
export const enqueueRunExecution = async (
    data: RunExecutionJobData
): Promise<string | null> => {
    if (!runExecutionQueue) {
        log.warn('Run execution queue not available, Redis may not be configured');
        return null;
    }

    log.debug({ jobData: data }, 'Enqueueing run execution job');
    const job = await runExecutionQueue.add('execute', data, {
        jobId: data.runId, // Use runId as jobId for idempotency
    });

    return job.id || null;
};

/**
 * Gracefully close all queues
 */
export const closeQueues = async (): Promise<void> => {
    if (runExecutionQueue) {
        await runExecutionQueue.close();
    }
    if (runExecutionQueueEvents) {
        await runExecutionQueueEvents.close();
    }
};
