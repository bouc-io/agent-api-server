import pino from 'pino';

/**
 * Log level from environment
 */
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/**
 * Base logger configuration following CLAUDE.md logging standards:
 * - timestamp (ISO8601)
 * - level
 * - agent (service name)
 * - message
 * - request_id / run_id
 * - component
 * - elapsed_ms
 */
export const logger = pino({
    level: LOG_LEVEL,
    formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => ({
            pid: bindings.pid,
            host: bindings.hostname,
        }),
    },
    base: {
        agent: 'agent-api-server',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger for a specific run
 * Adds run_id to all log entries
 */
export const createRunLogger = (runId: string) => {
    return logger.child({
        run_id: runId,
        component: 'run-orchestrator',
    });
};

/**
 * Create a child logger for a specific component
 */
export const createComponentLogger = (component: string) => {
    return logger.child({
        component,
    });
};

/**
 * Create a child logger for HTTP requests
 */
export const createRequestLogger = (requestId: string) => {
    return logger.child({
        request_id: requestId,
        component: 'http',
    });
};

/**
 * Log a canonical summary at the end of an operation
 * Per CLAUDE.md requirements
 */
export interface CanonicalLogData {
    duration_ms: number;
    status: 'success' | 'failure' | 'cancelled';
    metrics?: Record<string, number>;
}

export const logCanonical = (
    log: pino.Logger,
    message: string,
    data: CanonicalLogData
) => {
    log.info(
        {
            duration_ms: data.duration_ms,
            status: data.status,
            ...data.metrics,
        },
        message
    );
};
