import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ZodTypeAny, z } from 'zod'

/**
 * The whole validation layer. Every route that takes a body declares the Zod
 * schema it expects — the same schema the frontend and the LLM parser use —
 * and a malformed request is rejected here with a readable message instead of
 * blowing up three call frames deep.
 */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request body',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      })
      return
    }
    req.body = result.data as z.infer<S>
    next()
  }
}

/**
 * Reads the body a `validateBody(schema)` middleware already checked, with the
 * schema's inferred type. Express types `req.body` loosely, so without this the
 * validated shape is lost the moment it reaches the handler — and a `.forEach`
 * over it silently becomes untyped.
 */
export function validated<S extends ZodTypeAny>(_schema: S, req: Request): z.infer<S> {
  return req.body as z.infer<S>
}

/** Convenience alias so route files read as plain Express. */
export type Handler = RequestHandler
