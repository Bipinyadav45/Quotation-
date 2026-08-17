import { Router } from 'express'
import {
  ParseRequestSchema,
  ReconcileRequestSchema,
  type ParseResponse,
  type ReconcileResponse,
} from '@shared/schema.js'
import { validateBody, validated } from '../middleware/validate.js'
import { parseThread } from '../lib/parser.js'
import { reconcile } from '../lib/reconcile.js'

export const parseRoutes = Router()

/**
 * Screen 1's "Parse thread" button. Deterministic parser only — §5 is explicit
 * that the LLM path is "exposed as a separate button, never automatic", so it
 * lives on its own route (see routes/llm.ts).
 */
parseRoutes.post('/parse', validateBody(ParseRequestSchema), (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)
  const body: ParseResponse = { lines: parseThread(thread), source: 'pattern' }
  res.json(body)
})

/**
 * Re-run reconciliation after the user flips a line's role on screen 2.
 * §5: "The UI must let a user flip any line's role. Heuristics are a starting
 * position, not a verdict." — so this has to be callable independently of parse.
 */
parseRoutes.post('/reconcile', validateBody(ReconcileRequestSchema), (req, res) => {
  const { lines } = validated(ReconcileRequestSchema, req)
  const body: ReconcileResponse = { pairs: reconcile(lines) }
  res.json(body)
})
