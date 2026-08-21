import { Router } from 'express'
import { ParseRequestSchema, type AiReadResponse, type ParseResponse } from '@shared/schema.js'
import { validateBody, validated } from '../middleware/validate.js'
import { parseThreadDetailed } from '../lib/parser.js'
import { parseThreadWithClaude } from '../lib/llmParser.js'
import { validityFromThread } from '../lib/validity.js'
import {
  INTERNAL_EMAIL_DOMAINS,
  extractCustomerFromThread,
  resolveCustomer,
  type ExtractionResult,
} from '../lib/extractCustomer.js'
import { aiAvailable, type AiResult } from '../lib/ai.js'

export const parseRoutes = Router()

/**
 * Screen 1's "Parse thread" button. Deterministic parser only — §5 is explicit
 * that the AI path is "exposed as a separate button, never automatic", so it
 * lives on its own route below.
 */
parseRoutes.post('/parse', validateBody(ParseRequestSchema), (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)
  const { lines, skipped, warnings } = parseThreadDetailed(thread)
  const body: ParseResponse = {
    lines,
    source: 'pattern',
    skipped,
    warnings,
    ...suggestedValidity(thread),
  }
  res.json(body)
})

/**
 * Term 4 off the thread, as a spreadable fragment so an absent one adds no key
 * at all rather than an `undefined` the schema would have to tolerate.
 *
 * Both routes get it: it depends on who wrote the line, not on which reader
 * found the products, and a desk that switches readers should not see the term
 * change under it.
 */
function suggestedValidity(thread: string): { suggestedValidity?: string } {
  const stated = validityFromThread(thread, INTERNAL_EMAIL_DOMAINS)
  return stated === null ? {} : { suggestedValidity: stated }
}

/**
 * The two AI buttons as one: the line items and the customer, read in a single
 * pass. Still §5's separate button, still never automatic — but the customer
 * details now land on the draft directly instead of waiting in a review panel,
 * which is what makes the guards in resolveCustomer load-bearing.
 *
 * ALWAYS answers 200 with AiReadResponseSchema. The two halves are independent
 * and fail independently, and neither failing is an error page: the desk keeps
 * whichever half worked.
 */
parseRoutes.post('/parse/ai', validateBody(ParseRequestSchema), async (req, res) => {
  const { thread } = validated(ParseRequestSchema, req)

  // allSettled rather than all: the customer half touches the database, and a
  // throw there would otherwise reject the pair and take the line items down
  // with it — the one half the desk cannot work without.
  const [linesRead, customerRead] = await Promise.allSettled([
    parseThreadWithClaude(thread),
    extractCustomerFromThread(thread),
  ])

  const parsed = linesFrom(linesRead, thread)
  const customer = sayTheReasonOnce(parsed, customerHalf(customerRead))

  const body: AiReadResponse = { ...parsed, ...suggestedValidity(thread), ...customer }
  res.json(body)
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
    /**
     * The one AI button. `parseWithAi` and `extractCustomer` stood for the two
     * buttons this replaced and went with their routes — a flag nothing reads
     * is a flag that drifts out of step with what the server can actually do.
     */
    readWithAi: llm,
    draftEmail: llm,
  })
})

/** The customer half of the reply, on its own so the two halves compose. */
type CustomerHalf = Pick<
  AiReadResponse,
  | 'customer'
  | 'customerConfidence'
  | 'customerFrom'
  | 'customerMissing'
  | 'customerConflicts'
  | 'customerNote'
>

/** A sentence, never a stack — the promise ai.ts makes, kept here too. */
function messageOf(err: unknown): string {
  return err instanceof Error && err.message !== '' ? err.message : String(err)
}

/**
 * parseThreadWithClaude already turns every AI failure into the pattern
 * parser's result with a note, so the only way it rejects is a genuine throw.
 * Even then the deterministic parser still runs and the desk still gets lines.
 */
function linesFrom(outcome: PromiseSettledResult<ParseResponse>, thread: string): ParseResponse {
  if (outcome.status === 'fulfilled') return outcome.value

  const { lines, skipped, warnings } = parseThreadDetailed(thread)
  return {
    lines,
    source: 'pattern',
    skipped,
    warnings,
    note: `${messageOf(outcome.reason)} The pattern parser was used instead.`,
  }
}

/**
 * `customer: null` says the READ FAILED, which is not the same thing as a
 * thread that named nobody — see AiReadResponseSchema. Nothing was read, so
 * nothing is known to be missing either: customerMissing stays empty and the
 * note carries the reason.
 */
function customerFailed(reason: string): CustomerHalf {
  return {
    customer: null,
    customerConfidence: 'low',
    customerFrom: 'thread',
    customerMissing: [],
    customerConflicts: [],
    customerNote: reason,
  }
}

function customerHalf(outcome: PromiseSettledResult<AiResult<ExtractionResult>>): CustomerHalf {
  if (outcome.status === 'rejected') {
    return customerFailed(`The customer details could not be read (${messageOf(outcome.reason)}).`)
  }
  if (!outcome.value.ok) return customerFailed(outcome.value.reason)

  const { extracted, onFile } = outcome.value.data
  return resolveCustomer(extracted, onFile)
}

/**
 * Both halves ask the same model, so a missing key or a spent quota fails them
 * with the byte-identical sentence. Printed twice — once over the lines, once
 * over the customer — one fault reads as two. State the reason where the lines
 * are, and let the customer's note say only that it was hit as well.
 */
function sayTheReasonOnce(parsed: ParseResponse, customer: CustomerHalf): CustomerHalf {
  const repeated =
    customer.customer === null &&
    customer.customerNote !== undefined &&
    parsed.note?.startsWith(customer.customerNote) === true

  if (!repeated) return customer
  return { ...customer, customerNote: 'The customer details could not be read either.' }
}
