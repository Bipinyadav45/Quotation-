import { LlmParseResultSchema, type ParsedLine, type ParseResponse } from '@shared/schema.js'
import { parseRupeesToPaise } from '@shared/money.js'
import { askAi } from './ai.js'
import { looksLikeSpecification, parseThreadDetailed } from './parser.js'
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
          desc: {
            type: 'string',
            description:
              'The product, without quantity or price. The product NAME on the first line, ' +
              'the SPECIFICATION on the lines after it, separated by \\n. Name only if the ' +
              'thread gives no specification.',
          },
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
- desc: the product only, with the quantity and price removed. Write the product
  NAME on the first line and the SPECIFICATION on the lines after it, joined by
  \\n — the document prints the first line bold and underlined and the rest
  plain beneath it. A specification usually sits on the line below the product
  it belongs to, so these two source lines

    HP 280 G9 MT ( MII ) - Rs. 83,000 + gst each
    Core i5-14500, 8GB DDR5, 512GB SSD, Wi-Fi, Onboard, Win 11 Pro., 3 Years Warranty.

  are one entry, whose rateText is "83,000" and whose desc is

    HP 280 G9 MT ( MII )\\nCore i5-14500, 8GB DDR5, 512GB SSD, Wi-Fi, Onboard, Win 11 Pro., 3 Years Warranty.

  A line that names a product and nothing else has no second line.
- make: the brand if one is named, else ""
- partCode: the part or model code if present, else ""
- qty: the quantity as a whole number, 0 if not stated
- rateText: the unit price exactly as written ("1,250", "550.00"), "" if absent

Ignore greetings, signatures, disclaimers, phone lines and repeated quoted
copies of a line you have already returned. Copy values; do not compute them,
convert currencies, or tidy up spelling in "raw".`

/**
 * Move a specification onto its own line when the model left it on the first.
 *
 * The document prints the first line of a description bold and underlined and
 * everything after it plain beneath a blank line, so a description that arrives
 * as one line is printed entirely as a product name — the configuration the
 * customer is buying set in the same weight as the model code. The prompt asks
 * for the newline; this is what happens on the occasions it does not arrive.
 *
 * The signal is parser.ts's own, imported rather than restated: a second list
 * would drift, and the same thread would then split one way through the
 * patterns and another through the AI. The guards follow that function's
 * instinct too — a boundary in the wrong place prints a mangled product name on
 * a customer's quotation, which is worse than a specification the desk can move
 * by hand.
 */
export function splitSingleLineDescription(desc: string): string {
  // The model obeyed. It read the thread; this function has not.
  if (desc.includes('\n')) return desc

  const words = desc.split(/\s+/).filter((word) => word !== '')

  // The word each specification signal starts at.
  const signals: number[] = []
  for (const [i, word] of words.entries()) {
    const next = words[i + 1] ?? ''
    // "16 GB" reads as a specification only as a pair, and the boundary
    // belongs before the number rather than between it and its unit.
    const paired = !looksLikeSpecification(next) && looksLikeSpecification(`${word} ${next}`.trim())
    if (looksLikeSpecification(word) || paired) signals.push(i)
  }

  const at = signals[0]
  // Nothing that reads as hardware: a name-only description, which is correct
  // and common — a 1.5 mtr cable is the whole of that product.
  if (at === undefined) return desc
  // One signal is as likely to belong to the name as to start a specification:
  // "HP ProBook 440 14 inch G11 Notebook PC" is a name, all of it.
  if (signals.length < 2) return desc
  // And one word is not a product name: "Numeric 1 kVA UPS" is one product.
  if (at < 2) return desc

  // Runs of whitespace collapse, as they do where parser.ts folds a
  // specification into the product above it.
  return `${words.slice(0, at).join(' ')}\n${words.slice(at).join(' ')}`
}

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
      // The document splits this at the first newline, so a description that
      // came back as one line is repaired before it can be printed as one.
      desc: splitSingleLineDescription(line.desc),
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
