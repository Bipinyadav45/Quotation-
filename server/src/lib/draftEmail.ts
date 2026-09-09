import { z } from 'zod'
import type { Quote } from '@shared/schema.js'
import { amountInWords, computeTotals, formatPaise, pad2 } from '@shared/money.js'
import { formatDateLong, fromISODate } from '@shared/fy.js'
import { COMPANY } from '@shared/company.js'
import { askAi, type AiResult } from './ai.js'

/**
 * Draft the covering email that goes with the quotation.
 *
 * Given the saved document and the thread it came out of, so the reply is in
 * the register the customer wrote in and answers what they actually asked.
 * Effort is 'medium' rather than 'low': this is the one place in the
 * application where thoughtful prose is the product rather than a field.
 *
 * It drafts and it copies. It does not send — sending mail from here is a
 * different project with a different risk profile.
 */

export const DraftedEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
})
export type DraftedEmail = z.infer<typeof DraftedEmailSchema>

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    subject: {
      type: 'string',
      description: 'Email subject line. Reference the quotation number.',
    },
    body: {
      type: 'string',
      description: 'The email body as plain text, with real newlines. No markdown.',
    },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
} as const

export async function draftCoveringEmail(quote: Quote): Promise<AiResult<DraftedEmail>> {
  const totals = computeTotals(quote.items, quote.tax.mode, quote.tax.rate)

  // Everything the model needs, already formatted, so it never has to do
  // arithmetic or currency formatting — both of which it would sometimes get
  // wrong, on numbers a customer is going to check.
  const summary = [
    `Reference: ${quote.ref}${quote.revision > 0 ? ` (Rev ${quote.revision})` : ''}`,
    `Date: ${formatDateLong(fromISODate(quote.date))}`,
    `Customer: ${quote.customer.name}`,
    `Attention: ${quote.customer.attention}`,
    '',
    'Lines:',
    ...quote.items.map(
      (item, i) =>
        `  ${pad2(i + 1)}. ${item.desc.replace(/\n/g, ' — ')}` +
        `${item.make ? ` [${item.make}]` : ''}` +
        ` — ${pad2(item.qty)} x ${formatPaise(item.rate)} = ${formatPaise(item.qty * item.rate)}`,
    ),
    '',
    `Sub total: ${formatPaise(totals.sub)}`,
    ...totals.taxRows.map((r) => `${r.label}: ${formatPaise(r.paise)}`),
    `Total: ${formatPaise(totals.total)}  (${amountInWords(totals.total)})`,
    '',
    'Terms:',
    `  Payment: ${quote.terms.payment}`,
    `  Delivery: ${quote.terms.delivery}`,
    `  Prices: ${quote.terms.prices}`,
    `  Validity: ${quote.terms.validity}`,
    '',
    `Signed by: ${quote.signatory}, ${COMPANY.name}`,
  ].join('\n')

  const system = `You write the covering email that goes out with a quotation from ${COMPANY.name}, an Indian IT hardware reseller, to a business customer.

House style, from the documents they send:
- Open "Dear Sir," unless the thread makes a name clearly appropriate.
- Short. Four or five sentences. Indian business English, courteous and plain.
- State the reference number and the total. Do not restate every line item —
  the quotation is attached and repeating it invites a discrepancy.
- Answer anything the customer specifically asked in the thread: a delivery
  location, a warranty question, a deadline.
- Close "Thanking You," then "Yours Truly," then the signatory's name.
- Never invent a delivery date, a discount, or a commitment that is not in the
  terms you were given.
- Plain text. No markdown, no bullet characters, no placeholders like [Name].

Every figure you need is given to you already formatted. Copy figures exactly;
never recompute or reformat them.`

  const user = [
    '=== The quotation being sent ===',
    summary,
    '',
    '=== The thread it came out of ===',
    quote.sourceThread.slice(0, 12_000) || '(no thread was recorded)',
  ].join('\n')

  return askAi({
    system,
    user,
    outputSchema: OUTPUT_SCHEMA,
    validate: DraftedEmailSchema,
    // The one place thoughtful prose is the product, not a field.
    effort: 'medium',
    maxTokens: 6000,
  })
}
