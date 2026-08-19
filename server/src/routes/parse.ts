import { Router } from 'express'
import { ParseRequestSchema, type ParseResponse } from '@shared/schema.js'
import { validateBody, validated } from '../middleware/validate.js'
import { parseThreadDetailed } from '../lib/parser.js'
import { parseThreadWithClaude } from '../lib/llmParser.js'
import { config } from '../config.js'

export const parseRoutes = Router()

/**
 * Screen 1's "Parse thread" button. Deterministic parser only — §5 is explicit
 * that the LLM path is "exposed as a separate button, never automatic", so it
 * lives on its own route (see routes/llm.ts).
 */
parseRoutes.post('/parse', validateBody(ParseRequestSchema), (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)
  const { lines, skipped, warnings } = parseThreadDetailed(thread)
  const body: ParseResponse = { lines, source: 'pattern', skipped, warnings }
  res.json(body)
})

/** Lets the UI hide the Claude button rather than offer one that cannot work. */
parseRoutes.get('/capabilities', (_req, res) => {
  res.json({ llm: config.anthropicApiKey !== null })
})
