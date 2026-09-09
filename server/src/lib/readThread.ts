import { createHash } from 'node:crypto'
import { z } from 'zod'
import { LlmParsedLineSchema, type ParsedLine } from '@shared/schema.js'
import { askAi, type AiResult } from './ai.js'
import { toParsedLines } from './llmParser.js'
import {
  candidatesOnFile,
  ExtractedCustomerSchema,
  INTERNAL_EMAIL_DOMAINS,
  rejectOwnDetails,
  type ExtractedCustomer,
} from './extractCustomer.js'
import type { Candidate } from './customerMatch.js'

/**
 * Reading a thread — the line items AND the customer — in ONE call.
 *
 * IT USED TO BE TWO, fired together with Promise.allSettled, and each walked a
 * fallback chain of up to four models. So one press of the button cost between
 * two and EIGHT requests. The free tier allows twenty a day, which made three
 * presses a plausible way to run out, and the desk did — twice, blaming the key
 * both times.
 *
 * One call also removes the burst. Two concurrent structured requests is enough
 * to trip a per-minute limit on its own, and a 429 from that is indistinguishable
 * from a key that is genuinely spent.
 *
 * It is not a compromise on quality either: the two prompts were reading the
 * same text for related facts, and the model now sees the customer's signature
 * while it decides which side of the thread a line came from — the exact
 * judgement the "request" / "offer" split turns on.
 */

const ThreadReadSchema = z.object({
  lines: z.array(LlmParsedLineSchema),
  customer: ExtractedCustomerSchema,
})

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      description: 'Every product line in the thread, in the order they appear.',
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
    customer: {
      type: 'object',
      description: "The CUSTOMER's details — never the reseller's.",
      properties: {
        name: { type: 'string', description: 'The customer company name. "" if not stated.' },
        address: {
          type: 'string',
          description: 'The customer postal address, newline separated. "" if not stated.',
        },
        attention: {
          type: 'string',
          description: 'The person to address it to, e.g. "Mr. Mahesh Jathar". "" if not stated.',
        },
        gstin: { type: 'string', description: 'Their 15-character GSTIN. "" if not stated.' },
        state: {
          type: 'string',
          description: 'Their Indian state, spelled in full, e.g. "Karnataka". "" if not stated.',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'How clearly the thread identified the customer.',
        },
      },
      required: ['name', 'address', 'attention', 'gstin', 'state', 'confidence'],
      additionalProperties: false,
    },
  },
  required: ['lines', 'customer'],
  additionalProperties: false,
} as const

function systemPrompt(): string {
  const ours = INTERNAL_EMAIL_DOMAINS.map((d) => `"@${d}"`).join(' or ')

  return `You read B2B email threads at an Indian IT hardware reseller and return two things: the product lines, and the CUSTOMER's details.

The reseller is Newtech Computer Services Pvt. Ltd. Their email addresses end in
${ours}. Their signature block appears in almost every message, often several
times, and their address is 6th Floor, Solaris-II, Saki Vihar Road, Powai, Mumbai.

A thread interleaves two sides:
- the CUSTOMER asking for products, usually with quantities and no prices
- the RESELLER quoting those products back, with a unit price

=== THE LINES ===

For each product line in the thread, return one entry:
- role "request" for a customer line, "offer" for a reseller line. Decide this
  from WHOSE MESSAGE the line sits in, not from whether it carries a price.
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
convert currencies, or tidy up spelling in "raw".

=== THE CUSTOMER ===

NEVER return Newtech's details. You want the other party — whoever is asking for
a quotation. The same signature block that tells you who the customer is also
tells you which lines are theirs, so use it for both.

- Copy values exactly as written. Do not correct, expand or reformat them.
- A field you cannot find is "", never a guess. An invented address on a
  quotation is worse than a blank one someone types.
- "attention" is the individual the quotation should be addressed to, with any
  honorific, as the thread writes it.
- "state" is the Indian state, spelled in full. Infer it from the city only
  when the city is unambiguous (Bengaluru -> Karnataka, Powai -> Maharashtra).
- "gstin" is 15 characters. If you cannot see one, "".
- confidence: "high" when the thread clearly identifies one customer,
  "medium" when you had to infer, "low" when you are unsure who the customer is.`
}

export interface ThreadRead {
  lines: ParsedLine[]
  /** Lines whose rate could not be read — surfaced, never silently dropped. */
  rejected: string[]
  extracted: ExtractedCustomer
  /**
   * Every ledger on the customer master this thread could mean, best first —
   * a LIST, because a name is not an identity here. It replaced a single
   * `onFile` record, which was the shape that let one Morgan Stanley ledger out
   * of seventeen be chosen by score and written to a draft unreviewed.
   */
  candidates: Candidate[]
}

/**
 * Answers already paid for.
 *
 * Pressing the button twice on the same thread — because the first answer
 * scrolled past, because a colleague wants to see it, because nothing seemed to
 * happen — used to cost a second read. On a twenty-a-day allowance that is not
 * a rounding error.
 *
 * Keyed on the thread text, so an edited thread is genuinely a different
 * question and is asked again. Held in memory only: it is a cost optimisation,
 * not a store, and a restart losing it costs one request.
 */
const CACHE_LIMIT = 32
const cache = new Map<string, ThreadRead>()

const cacheKey = (thread: string) => createHash('sha256').update(thread).digest('hex')

/** Visible to tests, and to anyone wondering whether a press actually cost anything. */
export function cachedReads(): number {
  return cache.size
}

export function clearReadCache(): void {
  cache.clear()
}

export async function readThreadWithAi(thread: string): Promise<AiResult<ThreadRead>> {
  const key = cacheKey(thread)
  const hit = cache.get(key)
  if (hit) return { ok: true, data: hit }

  const result = await askAi({
    system: systemPrompt(),
    user: thread,
    outputSchema: OUTPUT_SCHEMA,
    validate: ThreadReadSchema,
    effort: 'low',
  })

  if (!result.ok) return result

  const { lines, rejected } = toParsedLines(result.data.lines)
  // The last line of defence against our own details reaching a document
  // addressed to us — unchanged from when the customer read stood alone.
  const extracted = rejectOwnDetails(result.data.customer)
  const candidates = candidatesOnFile(extracted)

  const data: ThreadRead = { lines, rejected, extracted, candidates }

  // Oldest out first. A desk works on one thread at a time, so this holds far
  // more than a day's work and the eviction is a backstop rather than a policy.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, data)

  return { ok: true, data }
}
