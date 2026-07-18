import { describe, it, expect, vi } from 'vitest';
import { z, ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { validate } from './validate';

const schema = z.object({ name: z.string(), count: z.number().optional() }).passthrough();

function invoke(mw: ReturnType<typeof validate>, req: Partial<Request>) {
  const next = vi.fn() as unknown as NextFunction;
  mw(req as Request, {} as Response, next);
  return next as unknown as ReturnType<typeof vi.fn>;
}

describe('validate middleware', () => {
  it('calls next() with no error on a valid body', () => {
    const req: Partial<Request> = { body: { name: 'ok' } };
    const next = invoke(validate(schema), req);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]).toHaveLength(0);
  });

  it('forwards a ZodError to next() on an invalid body', () => {
    const req: Partial<Request> = { body: { name: 123 } };
    const next = invoke(validate(schema), req);
    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
  });

  it('preserves unknown keys (passthrough) on the parsed body', () => {
    const req: Partial<Request> = { body: { name: 'ok', extra: 'kept' } };
    invoke(validate(schema), req);
    expect((req.body as Record<string, unknown>).extra).toBe('kept');
  });

  it('treats a bare schema as a body schema (shorthand)', () => {
    const req: Partial<Request> = { body: { name: 'ok' } };
    const next = invoke(validate(schema), req);
    expect(next.mock.calls[0]).toHaveLength(0);
  });

  it('validates query and params when provided as a SchemaSet', () => {
    const req: Partial<Request> = {
      body: {},
      query: { q: 'hi' } as Request['query'],
      params: { id: 'x' } as Request['params'],
    };
    const mw = validate({ query: z.object({ q: z.string() }).passthrough() });
    const next = invoke(mw, req);
    expect(next.mock.calls[0]).toHaveLength(0);
  });
});
