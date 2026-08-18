import { Router } from 'express'
import {
  ParseRequestSchema,
  ReconcileRequestSchema,
  type ParseResponse,
  type ReconcileResponse,
} from '@shared/schema.js'
import { validateBody, validated } from '../middleware/validate.js'
import { parseThreadDetailed } from '../lib/parser.js'
import { parseThreadWithClaude } from '../lib/llmParser.js'
import { reconcile } from '../lib/reconcile.js'
import { config } from '../config.js'

export const parseRoutes = Router()

/**
 * Screen 1's "Parse thread" button. Deterministic parser only — §5 is explicit
 * that the LLM path is "exposed as a separate button, never automatic", so it
 * lives on its own route (see routes/llm.ts).
 */
parseRoutes.post('/parse', validateBody(ParseRequestSchema), (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)
  const { lines, skipped } = parseThreadDetailed(thread)
  const body: ParseResponse = { lines, source: 'pattern', skipped }
  res.json(body)
})

/**
 * Re-run reconciliation after the user flips a line's role on screen 2.
 * §5: "The UI must let a user flip any line's role. Heuristics are a starting
 * position, not a verdict." — so this has to be callable independently of parse.
 */
/**
 * §5 — the LLM path, "exposed as a separate button, never automatic". Falls
 * back to the pattern parser with a note on any failure; never errors.
 */
parseRoutes.post('/parse/llm', validateBody(ParseRequestSchema), async (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)
  res.json(await parseThreadWithClaude(thread))
})

/** Lets the UI hide the Claude button rather than offer one that cannot work. */
parseRoutes.get('/capabilities', (_req, res) => {
  res.json({ llm: config.anthropicApiKey !== null })
})

parseRoutes.post('/reconcile', validateBody(ReconcileRequestSchema), (req, res) => {
  const { lines } = validated(ReconcileRequestSchema, req)
  const body: ReconcileResponse = { pairs: reconcile(lines) }
  res.json(body)
})
