import { Router } from 'express'
import { ParseRequestSchema, type ParseResponse } from '@shared/schema.js'
import { validateBody, validated } from '../middleware/validate.js'
import { parseThreadDetailed } from '../lib/parser.js'
import { parseThreadWithClaude } from '../lib/llmParser.js'
import { claudeAvailable } from '../lib/claude.js'

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

/**
 * Lets the UI hide every AI affordance rather than offer buttons that cannot
 * work. With no key the application stays completely usable — that is the
 * point: the AI is additive, never load-bearing.
 */
parseRoutes.get('/capabilities', (_req, res) => {
  const llm = claudeAvailable()
  res.json({
    llm,
    parseWithClaude: llm,
    extractCustomer: llm,
    draftEmail: llm,
  })
})
