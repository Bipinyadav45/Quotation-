import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import type { Quote } from '@shared/schema.js'
import { hoistWarranty } from '../../../web/src/lib/draft.js'
import { renderDocx } from './docx.js'

/**
 * The seam between lifting a warranty out of the lines and printing it as a
 * term — the one place neither half's own tests can see.
 *
 * Both halves were green when the document read
 *
 *     5.    Warranty    : Warranty: 1 Year
 *
 * because the hoist returned the clause with the label still on it and the
 * template prints a label of its own. draft.test.ts asserted the hoist's return
 * value and docx.test.ts asserted the template's output, and neither ever ran
 * one into the other. This does, against real .docx bytes, and it is the only
 * test in the suite that would catch the label being changed on one side alone.
 */

const QUOTE: Quote = {
  id: 'warranty-seam',
  ref: 'NCS/2026-27/Quotes/RG/019',
  revision: 0,
  date: '2026-08-21',
  customer: {
    name: 'Datamatics Global Services Limited',
    address: 'R.S No.181/5, East Coast Rd\nPuducherry - 605008',
    attention: 'Mr. Mahesh Jathar.',
    state: 'Puducherry',
  },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  items: [],
  tax: { mode: 'IGST', rate: 18 },
  terms: {
    payment: '100% Advance',
    delivery: '1-2 Weeks after PO',
    prices: 'All-inclusive as per this proforma invoice',
    validity: '31st August 2026.',
    warranty: '',
  },
  totals: { sub: 0, tax: 0, total: 0 },
  sourceThread: '',
  status: 'draft',
  createdAt: '2026-08-21T00:00:00.000Z',
}

function textOf(buffer: Buffer): string {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  return xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
}

/** Run a description the whole way: hoist it, then render what came out. */
function through(desc: string, rate = 2_000_000) {
  const hoisted = hoistWarranty([{ desc, make: '', partCode: '', qty: 1, rate }])
  const rendered = renderDocx({
    ...QUOTE,
    items: hoisted.items,
    terms: { ...QUOTE.terms, warranty: hoisted.warranty ?? '' },
    totals: { sub: rate, tax: Math.round(rate * 0.18), total: rate + Math.round(rate * 0.18) },
  })
  return { hoisted, text: textOf(rendered) }
}

describe('a warranty lifted out of a line and printed as term 5', () => {
  it('prints the label once, not once from each side', () => {
    const { text } = through('1.6 TB SAS 12G Drive (Refurbished)\nWarranty: 1 Year')

    expect(text).toContain('5. Warranty : 1 Year')
    // The bug this file exists for. Both halves passed their own tests while
    // the customer's document said this.
    expect(text).not.toContain('Warranty : Warranty')
    expect(text).not.toMatch(/Warranty\s*:\s*Warranty/)
  })

  it('says it once on the whole page — hoisted, not copied', () => {
    const { text } = through('1.6 TB SAS 12G Drive (Refurbished)\nWarranty: 1 Year')

    expect(text.match(/Warranty/g)).toHaveLength(1)
    expect(text).toContain('1.6 TB SAS 12G Drive (Refurbished)')
  })

  it('does the same for a warranty written as a trailing clause', () => {
    const { text } = through(
      'HP 280 G9 MT Desktop\nCore i5-14400, 16 GB RAM, 512GB SSD, Win 11 Pro., 3 Years Warranty',
    )

    expect(text).toContain('5. Warranty : 3 Years')
    expect(text).not.toMatch(/Warranty\s*:\s*\d+\s*Years?\s*Warranty/)
    // The rest of the specification survives, and reads properly.
    expect(text).toContain('Core i5-14400, 16 GB RAM, 512GB SSD, Win 11 Pro.')
    expect(text).not.toMatch(/,\s*,/)
  })

  it('prints no fifth term when the line never mentioned one', () => {
    const { hoisted, text } = through('Black i USB-C to USB-A 1.5 mtr')

    expect(hoisted.warranty).toBeNull()
    expect(text).not.toContain('Warranty')
    expect(text).toContain('4. Validity')
    expect(text).not.toContain('5.')
  })

  it('leaves both descriptions alone when the lines disagree', () => {
    // One term cannot say two things, so nothing moves and the page keeps each
    // warranty next to the product it is actually true of.
    const hoisted = hoistWarranty([
      { desc: 'Drive A\nWarranty: 1 Year', make: '', partCode: '', qty: 1, rate: 100 },
      { desc: 'Drive B\nWarranty: 3 Years', make: '', partCode: '', qty: 1, rate: 100 },
    ])

    expect(hoisted.warranty).toBeNull()
    expect(hoisted.items.map((i) => i.desc)).toEqual([
      'Drive A\nWarranty: 1 Year',
      'Drive B\nWarranty: 3 Years',
    ])
    expect(hoisted.warnings.join(' ')).toMatch(/differ|different/i)
  })
})
