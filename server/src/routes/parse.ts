import { Router } from 'express'
import { ParseRequestSchema, type ParseResponse } from '@shared/schema.js'
import { validateBody, validated } from '../middleware/validate.js'
import { parseThreadDetailed } from '../lib/parser.js'
import { parseThreadWithClaude } from '../lib/llmParser.js'
import { aiAvailable } from '../lib/ai.js'

export const parseRoutes = Router()

/**
 * Screen 1's "Parse thread" button. Deterministic parser only — §5 is explicit
 * that the AI path is "exposed as a separate button, never automatic", so it
 * lives on its own route below.
 */
parseRoutes.post('/parse', validateBody(ParseRequestSchema), (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)
  const { lines, skipped, warnings } = parseThreadDetailed(thread)
  const body: ParseResponse = { lines, source: 'pattern', skipped, warnings }
  res.json(body)
})

/**
 * §5's AI path: a separate button, never automatic. Falls back to the pattern
 * parser with a note on any failure, so it can never surface an error page.
 *
 * This route was lost for a week: removing the neighbouring /reconcile route
 * took it with it, and nothing noticed because the button beside it is hidden
 * whenever no API key is set — which it was. Hence the test below it.
 */
parseRoutes.post('/parse/llm', validateBody(ParseRequestSchema), async (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)
  res.json(await parseThreadWithClaude(thread))
})

/**
 * Lets the UI hide every AI affordance rather than offer buttons that cannot
 * work. With no key the application stays completely usable — that is the
 * point: the AI is additive, never load-bearing.
 */
parseRoutes.get('/capabilities', (_req, res) => {
  const llm = aiAvailable()
  res.json({
    llm,
    parseWithAi: llm,
    extractCustomer: llm,
    draftEmail: llm,
  })
})
