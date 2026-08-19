import { LlmParseResultSchema, type ParsedLine, type ParseResponse } from '@shared/schema.js'
import { parseRupeesToPaise } from '@shared/money.js'
import { askAi } from './ai.js'
import { parseThreadDetailed } from './parser.js'
import { findMake } from './makes.js'

/**
 * The AI fallback parser (§5).
 *
 * "Exposed as a separate button, never automatic." It exists for threads the
 * regexes cannot handle — tables pasted out of Excel, lines that put the
 * quantity before the description, quotations written as prose.
 *
 * §5 specifies instructing the model to "return a bare JSON array ... with no
 * prose and no markdown fences", then validating with zod. Structured outputs
 * do that at the API layer instead: the response is constrained to the schema,
 * which removes the whole fence-stripping and parse-retry class of failure. The
 * same zod schema generates the constraint and validates the result, so §5's
 * intent is unchanged and there is less to go wrong.
 *
 * §5's failure rule is preserved exactly: on ANY failure, return the pattern
 * parser's result with a note. This never surfaces an error page.
 */

/**
 * The output constraint, as plain JSON Schema.
 *
 * The SDK ships a `zodOutputFormat` helper, but it is typed against zod v4
 * while this project is on v3 — using it would mean running two versions of
 * zod side by side for one call site. The schema is small enough to state
 * directly, and the response is still validated with the shared zod schema
 * afterwards, which is what §5 actually asks for.
 *
 * Structured outputs require `additionalProperties: false` and every property
 * listed in `required`.
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          raw: { type: 'string', description: 'The source line, copied exactly.' },
          desc: { type: 'string', description: 'The product, without quantity or price.' },
          make: { type: 'string', description: 'Brand if named, else an empty string.' },
          partCode: { type: 'string', description: 'Part or model code, else an empty string.' },
          qty: { type: 'integer', description: 'Quantity as a whole number, 0 if not stated.' },
          rateText: {
            type: 'string',
            description: 'Unit price exactly as written, e.g. "1,250". Empty string if absent.',
          },
          role: {
            type: 'string',
            enum: ['request', 'offer'],
            description: '"request" for a customer line, "offer" for a reseller line.',
          },
        },
        required: ['raw', 'desc', 'make', 'partCode', 'qty', 'rateText', 'role'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const

const SYSTEM = `You extract product line items from B2B email threads at an Indian IT hardware reseller.

A thread interleaves two sides:
- the CUSTOMER asking for products, usually with quantities and no prices
- the RESELLER quoting those products back, with a unit price

For each product line in the thread, return one entry:
- role "request" for a customer line, "offer" for a reseller line
- raw: the source line copied exactly
- desc: the product only, with the quantity and price removed
- make: the brand if one is named, else ""
- partCode: the part or model code if present, else ""
- qty: the quantity as a whole number, 0 if not stated
- rateText: the unit price exactly as written ("1,250", "550.00"), "" if absent

Ignore greetings, signatures, disclaimers, phone lines and repeated quoted
copies of a line you have already returned. Copy values; do not compute them,
convert currencies, or tidy up spelling in "raw".`

export async function parseThreadWithClaude(thread: string): Promise<ParseResponse> {
  const fallback = (note: string): ParseResponse => {
    const { lines, skipped, warnings } = parseThreadDetailed(thread)
    return { lines, source: 'pattern', note, skipped, warnings }
  }

  // §5's rule, unchanged: on ANY failure return the pattern parser's result
  // with a note. This never surfaces an error page.
  const result = await askAi({
    system: SYSTEM,
    user: thread,
    outputSchema: OUTPUT_SCHEMA,
    validate: LlmParseResultSchema,
    effort: 'low',
  })

  if (!result.ok) return fallback(`${result.reason} The pattern parser was used instead.`)
  if (result.data.lines.length === 0) {
    return fallback('The AI found no line items, so the pattern parser was used instead.')
  }

  const lines: ParsedLine[] = []
  const rejected: string[] = []

  result.data.lines.forEach((line, index) => {
    const text = line.rateText.trim()
    const rate = text === '' ? 0 : parseRupeesToPaise(text)

    // A rate that will not parse is dropped, not zeroed. `?? 0` here quoted
    // ₹0.00 for a product that had a price — silently, on a document sent to a
    // customer.
    if (rate === null) {
      rejected.push(`${line.desc || line.raw} (could not read the rate "${text}")`)
      return
    }

    lines.push({
      id: `llm-${index + 1}`,
      raw: line.raw,
      desc: line.desc,
      // The makes table is authoritative, so a brand the model invented does
      // not become a brand on the document. Fall back to the model only if we
      // have no entry for it.
      make: findMake(line.raw) || line.make,
      partCode: line.partCode,
      qty: line.qty,
      rate,
      role: line.role,
      source: 'llm',
    })
  })

  if (lines.length === 0) {
    return fallback("None of the AI's lines could be read, so the pattern parser was used.")
  }

  return {
    lines,
    source: 'llm',
    skipped: rejected,
    warnings: [],
  }
}
