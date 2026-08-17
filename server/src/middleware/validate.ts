import type { NextFunction, Request, Response } from 'express'
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
