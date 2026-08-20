import PizZip from 'pizzip'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Quote } from '@shared/schema.js'
import { ROOT } from '../config.js'
import { buildRenderModel, documentFilename, renderDocx } from './docx.js'

/**
 * The golden-file test.
 *
 * §11's fixture rendered through the rebuilt template, checked against the
 * text of the hand-made quotation that Newtech actually sent. Every label, the
 * reference, both address blocks and every amount has to survive Correction 1's
 * template rebuild.
 */

const SAMPLE_DOCX = path.resolve(
  ROOT,
  'Quotation-Morgan Stanley - 10th July 2026 -- Black i USB, Lightning & Logitech - 01 No.(Sample).docx',
)

/** Pull the visible text out of a .docx, including anything inside a text box. */
function extractText(buffer: Buffer): string {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  return xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
}

const QUOTE: Quote = {
  id: 'test',
  ref: 'NCS/2026-27/Quotes/RG/030',
  revision: 0,
  date: '2026-07-10',
  customer: {
    name: 'Morgan Stanley Advantage Services Pvt Ltd',
    address: 'Campus 8B, Sarjapur, Marathahalli\nOuter Ring Road, Bengaluru - 560103',
    attention: 'Mr. Subhransu Kar.',
    state: 'Karnataka',
  },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  items: [
    { desc: 'Black i USB-C to USB-A 1.5 mtr', make: 'Black i', partCode: '', qty: 2, rate: 55_000 },
    { desc: 'Black i USB-C to USB-C 1.5 mtr', make: 'Black i', partCode: '', qty: 2, rate: 85_000 },
    { desc: 'Lightning to USB A 1.5 mtr', make: 'Black i', partCode: '', qty: 2, rate: 125_000 },
    {
      desc: 'Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP',
      make: 'Black i',
      partCode: 'BI-TCHUGP',
      qty: 1,
      rate: 275_000,
    },
    {
      desc: 'Logitech Wireless Keyboard and Mouse Set #MK540',
      make: 'Logitech',
      partCode: 'MK540',
      qty: 1,
      rate: 345_000,
    },
  ],
  tax: { mode: 'IGST', rate: 18 },
  terms: {
    payment: '100% Advance',
    delivery: '1-2 Weeks after PO',
    prices: 'All-inclusive as per the quote',
    validity: '31st July 2026.',
  },
  totals: { sub: 1_150_000, tax: 207_000, total: 1_357_000 },
  sourceThread: '',
  status: 'draft',
  createdAt: '2026-07-10T00:00:00.000Z',
}

describe('buildRenderModel — §8, every value a string', () => {
  const model = buildRenderModel(QUOTE)

  it('hands docxtemplater no raw numbers at all', () => {
    const scalars = Object.entries(model).filter(([, v]) => !Array.isArray(v))
    for (const [key, value] of scalars) {
      expect(typeof value, `${key} must be a string`).toBe('string')
    }
    for (const item of model.items) {
      for (const [key, value] of Object.entries(item)) {
        expect(typeof value, `items.${key} must be a string`).toBe('string')
      }
    }
    for (const row of model.taxRows) {
      expect(typeof row.taxLabel).toBe('string')
      expect(typeof row.taxAmount).toBe('string')
    }
  })

  it('formats money the Indian way and pads serials and quantities', () => {
    expect(model.items.map((i) => i.sr)).toEqual(['01', '02', '03', '04', '05'])
    expect(model.items.map((i) => i.qty)).toEqual(['02', '02', '02', '01', '01'])
    expect(model.items.map((i) => i.rate)).toEqual([
      '550.00', '850.00', '1,250.00', '2,750.00', '3,450.00',
    ])
    expect(model.items.map((i) => i.amount)).toEqual([
      '1,100.00', '1,700.00', '2,500.00', '2,750.00', '3,450.00',
    ])
  })

  it('reproduces the totals block', () => {
    expect(model.subTotal).toBe('11,500.00')
    expect(model.taxRows).toEqual([{ taxLabel: 'GST 18%', taxAmount: '2,070.00' }])
    expect(model.grandTotal).toBe('13,570.00')
  })

  it('uses the house date format', () => {
    expect(`${model.dateDay}${model.dateOrd}${model.dateRest}`).toBe('10th July 2026.')
  })

  it('splits a description into a product name and a specification', () => {
    // The name is printed bold and underlined and the spec plain beneath it, so
    // they reach the template as two fields. One {desc} tag could only ever
    // render both in the same weight.
    const [first] = buildRenderModel({
      ...QUOTE,
      items: [
        {
          desc: 'HP 280 G9 MT ( MII )\nCore i5-14500, 8GB DDR5\n3 Years Warranty',
          make: 'HP',
          partCode: '',
          qty: 1,
          rate: 100,
        },
      ],
    }).items

    expect(first!.descName).toBe('HP 280 G9 MT ( MII )')
    expect(first!.descSpec).toBe('Core i5-14500, 8GB DDR5\n3 Years Warranty')
  })

  it('leaves the specification empty for a one-line description', () => {
    expect(model.items[0]!.descName).toBe('Black i USB-C to USB-A 1.5 mtr')
    expect(model.items[0]!.descSpec).toBe('')
  })

  it('marks a revision in the reference', () => {
    expect(buildRenderModel({ ...QUOTE, revision: 1 }).ref).toBe(
      'NCS/2026-27/Quotes/RG/030 (Rev 1)',
    )
  })
})

describe('renderDocx — the golden file', () => {
  const rendered = renderDocx(QUOTE)
  const text = extractText(rendered)

  it('renders without leaving a single unresolved tag', () => {
    expect(text).not.toMatch(/\{[#/]?\w+\}/)
    expect(text).not.toContain('undefined')
  })

  it('carries every field from the header block', () => {
    expect(text).toContain('Ref: NCS/2026-27/Quotes/RG/030')
    expect(text).toContain('Date: 10th July 2026.')
    expect(text).toContain('Morgan Stanley Advantage Services Pvt Ltd')
    expect(text).toContain('Campus 8B, Sarjapur, Marathahalli')
    expect(text).toContain('Outer Ring Road, Bengaluru - 560103')
    expect(text).toContain('Kind Attention: Mr. Subhransu Kar.')
    // No space after the colon — that is how the letterhead writes it.
    expect(text).toContain('Contact Number:022-40668809')
    expect(text).toContain('Email: rakhi.gupte@newtech.in')
    expect(text).toContain('Newtech Computer Services Pvt. Ltd.')
  })

  it('carries every line item, rate and amount', () => {
    for (const item of QUOTE.items) expect(text).toContain(item.desc)
    for (const amount of ['1,100.00', '1,700.00', '2,500.00', '2,750.00', '3,450.00']) {
      expect(text).toContain(amount)
    }
  })

  it('carries the totals block and the amount in words', () => {
    expect(text).toContain('Sub Total')
    expect(text).toContain('11,500.00')
    expect(text).toContain('GST 18%')
    expect(text).toContain('2,070.00')
    expect(text).toContain('Total Amount')
    expect(text).toContain('13,570.00')
  })

  it('carries the terms and the closing', () => {
    expect(text).toContain('100% Advance')
    expect(text).toContain('1-2 Weeks after PO')
    expect(text).toContain('All-inclusive as per the quote')
    expect(text).toContain('31st July 2026.')
    expect(text).toContain('please feel free to call us at 40668812/88')
    expect(text).toContain('Looking forward to an encouraging and early response.')
    expect(text).toContain('For Newtech Computer Services Pvt., Ltd.')
    expect(text).toContain('Rakhi Gupte')
  })

  it('reproduces the letterhead exactly, adding nothing to it', () => {
    // A Make column and an "Amount in words" line were both added earlier and
    // both removed: the letterhead has neither, and the instruction is to
    // reproduce this document rather than improve it.
    expect(text).not.toContain('Make')
    expect(text).not.toContain('Amount in words')
    expect(text).toContain('Terms and Conditions:')
    expect(text).toContain('please feel free to call us at 40668812/88')
    // The fourth term is Validity — the date the price holds until.
    expect(text).toContain('Validity')
    expect(text).toContain('31st July 2026.')
  })

  it('raises the ordinal in the date', () => {
    // "23rd June 2026." is printed "23^rd June 2026." Word can only superscript
    // a whole run and a docxtemplater tag IS one run, so the date arrives
    // pre-split — and this is the assertion that catches it being rejoined.
    const xml = new PizZip(rendered).file('word/document.xml')!.asText()
    const raised = /<w:vertAlign w:val="superscript"\/>[\s\S]{0,120}?<w:t[^>]*>th<\/w:t>/
    expect(xml).toMatch(raised)
    expect(text).toContain('10th July 2026.')
  })

  it('runs the serial-number column unbroken past the totals', () => {
    // The last line item's serial cell merges downward over Sub Total, the tax
    // rows and Total, so no rule is drawn across it. A totals row built by hand
    // rather than through the shared helper once broke that chain, and the only
    // symptom was a stray line in one corner of the table.
    const xml = new PizZip(rendered).file('word/document.xml')!.asText()
    expect((xml.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length).toBe(QUOTE.items.length)
    // Sub Total, one tax row, Total.
    expect((xml.match(/<w:vMerge\/>/g) ?? []).length).toBe(3)
  })

  it('expands the tax loop to two rows for an in-state customer', () => {
    const inState = renderDocx({
      ...QUOTE,
      customer: { ...QUOTE.customer, state: 'Maharashtra' },
      tax: { mode: 'CGST+SGST', rate: 18 },
    })
    const t = extractText(inState)
    expect(t).toContain('CGST 9%')
    expect(t).toContain('SGST 9%')
  })

  it('preserves the letterhead — header, footer, styles and logo untouched', () => {
    const source = new PizZip(readFileSync(path.resolve(ROOT, 'Quotation -- Format.docx')))
    const out = new PizZip(rendered)
    for (const part of [
      'word/header1.xml',
      'word/footer1.xml',
      'word/styles.xml',
      'word/media/image1.jpeg',
    ]) {
      expect(
        out.file(part)!.asUint8Array(),
        `${part} must survive the rebuild byte-for-byte`,
      ).toEqual(source.file(part)!.asUint8Array())
    }
  })

  it('no longer routes the body through a text box', () => {
    const xml = new PizZip(rendered).file('word/document.xml')!.asText()
    expect(xml).not.toContain('txbxContent')
  })
})

describe('against the quotation Newtech actually sent', () => {
  it('reproduces every label and amount from the real document', () => {
    // Guard rather than fail if someone moves the reference file.
    if (!existsSync(SAMPLE_DOCX)) {
      throw new Error(`Reference quotation not found at ${SAMPLE_DOCX}`)
    }

    const original = extractText(readFileSync(SAMPLE_DOCX)).replace(/\s+/g, ' ')
    const ours = extractText(renderDocx(QUOTE)).replace(/\s+/g, ' ')

    const mustAppearInBoth = [
      'Ref: NCS/2026-27/Quotes/RG/030',
      'Morgan Stanley Advantage Services Pvt Ltd',
      'Campus 8B, Sarjapur, Marathahalli',
      'Outer Ring Road, Bengaluru - 560103',
      'Newtech Computer Services Pvt. Ltd.',
      'Saki Vihar Road, Powai,',
      'rakhi.gupte@newtech.in',
      'Dear Sir,',
      'Please find the following Quotation for your kind consideration: -',
      'Product Name and Description',
      'Black i USB-C to USB-A 1.5 mtr',
      'Black i USB-C to USB-C 1.5 mtr',
      'Lightning to USB A 1.5 mtr',
      'Logitech Wireless Keyboard and Mouse Set #MK540',
      'BI-TCHUGP',
      '550.00', '850.00', '1,250.00', '2,750.00', '3,450.00',
      '1,100.00', '1,700.00', '2,500.00',
      'Sub Total', '11,500.00',
      '2,070.00',
      'Total Amount', '13,570.00',
      '100% Advance',
      'Looking forward to an encouraging and early response.',
      'Yours Truly,',
      'For Newtech Computer Services Pvt., Ltd.',
      'Rakhi Gupte',
    ]

    const missingFromOriginal = mustAppearInBoth.filter((s) => !original.includes(s))
    const missingFromOurs = mustAppearInBoth.filter((s) => !ours.includes(s))

    // If this fails, the assertion list has drifted from the reference file
    // rather than the renderer being wrong — worth knowing which.
    expect(missingFromOriginal, 'expected strings absent from the REFERENCE document').toEqual([])
    expect(missingFromOurs, 'expected strings absent from OUR rendered document').toEqual([])
  })
})

describe('documentFilename — §8', () => {
  it('uses the customer first word and the date', () => {
    expect(documentFilename(QUOTE, 'docx')).toBe('Quotation-Morgan-2026-07-10.docx')
    expect(documentFilename(QUOTE, 'pdf')).toBe('Quotation-Morgan-2026-07-10.pdf')
  })

  it('marks revisions and survives punctuation in the customer name', () => {
    expect(documentFilename({ ...QUOTE, revision: 2 }, 'docx')).toBe(
      'Quotation-Morgan-2026-07-10-Rev2.docx',
    )
    expect(
      documentFilename({ ...QUOTE, customer: { ...QUOTE.customer, name: 'L&T / Infotech' } }, 'docx'),
    ).toBe('Quotation-LT-2026-07-10.docx')
  })
})
