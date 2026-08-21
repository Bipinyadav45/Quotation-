import { describe, expect, it } from 'vitest'
import { validityFromThread } from './validity.js'

/**
 * Term 4 is a CONTRACTUAL commitment: it is how long Newtech promises to hold
 * the price. The rule that matters is therefore not "find a validity" but
 * "find one WE made".
 *
 * Every case below was reproduced against the previous browser-side version,
 * which read the raw thread with no idea who wrote each line. Each one put the
 * customer's words, or a competitor's, on Newtech's letterhead.
 */

const OURS = ['newtech.in', 'newtech.co.in']

/** Newest message first, which is how these threads arrive. */
const thread = (...blocks: Array<[string, string]>) =>
  blocks
    .map(([from, body]) => `On Mon, Aug 17, 2026 at 4:02 PM <${from}> wrote:\n${body}`)
    .join('\n\n')

describe('validityFromThread — only what WE said', () => {
  it('takes the validity out of our own message', () => {
    expect(
      validityFromThread(
        thread(['rakhi.gupte@newtech.in', 'Validity: 5 days from date of offer.']),
        OURS,
      ),
    ).toBe('5 days from date of offer.')
  })

  it('ignores the customer asking us to hold the price for longer', () => {
    // The failure that prompted this module. Read over the raw thread, the
    // customer's sentence came first and became our printed term — committing
    // Newtech to December when the desk had offered five days.
    const t = thread(
      [
        'sanjay.mehta@dgsl.co.in',
        'Thanks Rakhi. Please confirm the validity till 31st December 2026, our PO cycle is long.',
      ],
      ['rakhi.gupte@newtech.in', 'Validity: 5 days from date of offer.'],
    )
    expect(validityFromThread(t, OURS)).toBe('5 days from date of offer.')
  })

  it('ignores an RFQ boilerplate demand, which is the dangerous one', () => {
    // This reads like a legitimate term and would survive a skim.
    const t = thread([
      'purchase@customer.com',
      'Kindly quote your best rates. Rates should be valid for 90 days from date of quote.',
    ])
    expect(validityFromThread(t, OURS)).toBeNull()
  })

  it('ignores a block whose sender it cannot identify', () => {
    expect(validityFromThread('Validity: 90 days from date of quote.', OURS)).toBeNull()
  })

  it('reads our other domain too', () => {
    expect(
      validityFromThread(thread(['sales@newtech.co.in', 'Price valid for 2 days.']), OURS),
    ).toBe('Valid for 2 days.')
  })
})

describe('validityFromThread — a statement, not a mention', () => {
  const ours = (body: string) => validityFromThread(thread(['rakhi.gupte@newtech.in', body]), OURS)

  it('refuses a mid-sentence label that says the opposite of a term', () => {
    expect(
      ours('We cannot hold this price. Validity: only till 12th July, after that it will be revised.'),
    ).toBeNull()
  })

  it('refuses a competitor being quoted back', () => {
    expect(ours('Our competitor Redington offered validity till 31st Aug 2026.')).toBeNull()
  })

  it('drops the label and the price noun, keeping our wording', () => {
    expect(ours('Price valid for 2 days / till stocks last.')).toBe(
      'Valid for 2 days / till stocks last.',
    )
    expect(ours('Validity - till stocks last')).toBe('Till stocks last.')
  })

  it('never puts a priced product line in the terms cell', () => {
    // Straight off the HP thread: it mentions stocks and carries a rate.
    expect(
      ours('HP 280 G9 MT Desktop - Rs. 87,250 + gst each ( Very limited stocks)'),
    ).toBeNull()
  })

  it('refuses a paragraph that would push the terms table off the page', () => {
    expect(
      ours(
        'Validity: this offer is subject to our standard terms and conditions of sale, ' +
          'a copy of which is available on request, and remains open for acceptance until withdrawn.',
      ),
    ).toBeNull()
  })

  it('says nothing when we stated nothing', () => {
    expect(ours('Dear Sir, please find our offer attached. Regards, Rakhi')).toBeNull()
  })

  it('reads a quoted reply, where our own line comes back with a > on it', () => {
    expect(ours('> Validity: 7 days.')).toBe('7 days.')
  })
})
