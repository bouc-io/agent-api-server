import { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger';
import { AgentError, ValidationError, CancellationError } from '../types/errors';

/**
 * 404 handler. Mount AFTER all routes and BEFORE errorHandler.
 */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
};

/**
 * Maps the agent's domain error hierarchy (types/errors.ts) and zod validation
 * errors onto consistent HTTP JSON responses. Must be registered LAST.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Validation errors (thrown by the validate() middleware) -> 400
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof AgentError) {
    const status =
      err instanceof ValidationError ? 400 : err instanceof CancellationError ? 409 : 500;
    if (status >= 500) {
      logger.error({ err, code: err.code, path: req.originalUrl }, err.message);
    } else {
      logger.warn({ code: err.code, path: req.originalUrl }, err.message);
    }
    res.status(status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  logger.error(
    { err: err instanceof Error ? { message: err.message, stack: err.stack } : err, path: req.originalUrl },
    'Unhandled error'
  );
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
};
