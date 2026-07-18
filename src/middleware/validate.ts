import { RequestHandler } from 'express';
import { z } from 'zod';

type SchemaSet = { body?: z.ZodTypeAny; query?: z.ZodTypeAny; params?: z.ZodTypeAny };

/**
 * Returns Express middleware that validates the request against zod schema(s).
 * On success, parsed (typed/coerced) values replace req.body/query/params.
 * On failure, the ZodError is forwarded to the global error handler (-> HTTP 400).
 *
 * Usage:
 *   router.post('/', validate(createThingSchema), handler)            // shorthand: body only
 *   router.post('/', validate({ body, query, params }), handler)      // full form
 */
export const validate = (schemas: z.ZodTypeAny | SchemaSet): RequestHandler => {
  const set: SchemaSet =
    typeof (schemas as { parse?: unknown }).parse === 'function'
      ? { body: schemas as z.ZodTypeAny }
      : (schemas as SchemaSet);

  return (req, _res, next) => {
    try {
      if (set.body) req.body = set.body.parse(req.body);
      if (set.query) Object.assign(req.query as Record<string, unknown>, set.query.parse(req.query));
      if (set.params) Object.assign(req.params as Record<string, unknown>, set.params.parse(req.params));
      next();
    } catch (err) {
      next(err);
    }
  };
};
