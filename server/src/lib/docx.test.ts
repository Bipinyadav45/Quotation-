import PizZip from 'pizzip'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Quote } from '@shared/schema.js'
import { COMPANY, gstinLine } from '@shared/company.js'
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

/**
 * The terms block, paragraph by paragraph, as its text and as the properties
 * that place it on the page.
 *
 * Term 5 is printed only when there is a warranty, and "printed nothing" and
 * "printed a blank line" are the same string once the tags are stripped — so
 * its absence can only be checked by counting paragraphs. The properties come
 * back too because that is where the tab stop lives, and the tab stop is what
 * puts the fifth colon in the same column as the other four.
 */
function termsBlock(buffer: Buffer): Array<{ text: string; props: string }> {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  const from = xml.indexOf('Terms and Conditions:')
  const to = xml.indexOf('If you have any queries')
  expect(from, 'the terms block has moved').toBeGreaterThan(-1)
  expect(to, 'the closing has moved').toBeGreaterThan(from)

  return (
    xml
      .slice(from, to)
      .split('<w:p>')
      // The first and last pieces are the tails of the two paragraphs the slice
      // cuts through — the heading above the terms and the queries line below.
      .slice(1, -1)
      .map((para) => ({
        text: stripPara(para),
        props: /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(para)?.[0] ?? '',
      }))
  )
}

const stripPara = (para: string) =>
  para
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()

/** The numbered terms alone — "1. Payment Terms : 100% Advance" and friends. */
const numberedTerms = (buffer: Buffer) =>
  termsBlock(buffer)
    .map((p) => p.text)
    .filter((t) => /^\d+\.\s/.test(t))

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
    // The ordinary case: no line stated a warranty, so the document has four
    // terms. Every quotation saved before term 5 existed reads exactly this.
    warranty: '',
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

  it('builds each GSTIN as a whole printed line, label included', () => {
    // The label cannot sit in the template beside a value tag: docxtemplater
    // substitutes a plain string, so a customer with no GSTIN would be sent a
    // document reading "GSTIN: " with nothing after it.
    expect(gstinLine('29AABCM1234F1Z5')).toBe('GSTIN: 29AABCM1234F1Z5')
    expect(gstinLine('')).toBe('')
    expect(gstinLine('   ')).toBe('')
    expect(gstinLine(undefined)).toBe('')

    const withGstin = buildRenderModel({
      ...QUOTE,
      customer: { ...QUOTE.customer, gstin: '29AABCM1234F1Z5' },
    })
    expect(withGstin.customerGstinLine).toBe('GSTIN: 29AABCM1234F1Z5')
    // The fixture carries none, and neither line may be filled in for it.
    expect(model.customerGstinLine).toBe('')
    expect(model.companyGstinLine).toBe(gstinLine(COMPANY.gstin))
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

  it('prints the customer GSTIN in the To cell', () => {
    const withGstin = extractText(
      renderDocx({ ...QUOTE, customer: { ...QUOTE.customer, gstin: '29AABCM1234F1Z5' } }),
    )
    expect(withGstin).toContain('GSTIN: 29AABCM1234F1Z5')
    // In the To cell — which is everything ahead of the From cell beside it —
    // and not loose somewhere further down the page.
    expect(withGstin.indexOf('GSTIN: 29AABCM1234F1Z5')).toBeLessThan(withGstin.indexOf('From:'))
  })

  it('prints no GSTIN label at all when there is no GSTIN to print', () => {
    // A dangling "GSTIN: " on a document the customer files against their own
    // return is worse than an absent line. The fixture carries none; Newtech's
    // own is blank until someone supplies it, and the count follows it rather
    // than pinning it at zero for ever.
    expect(QUOTE.customer.gstin).toBeUndefined()
    expect((text.match(/GSTIN/g) ?? []).length).toBe(COMPANY.gstin ? 1 : 0)
  })

  it('leaves no blank line behind where a GSTIN would have been', () => {
    // The regression that matters, and the one no assertion above can see: a
    // blank GSTIN used to substitute into its paragraph and leave the paragraph
    // STANDING — an empty line inside the cell, which pushed the whole row
    // taller and put visible white space under the address on every quotation
    // that had no GSTIN. Stripped of its tags that paragraph is the empty
    // string, indistinguishable from no paragraph at all, so only the count
    // sees it. It reached a customer before it was caught.
    const cells = (buffer: Buffer) => {
      const xml = new PizZip(buffer).file('word/document.xml')!.asText()
      const tbl = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'))
      return tbl.split('<w:tc>').slice(1).map((c) => c.split('<w:p>').length - 1)
    }

    // To cell: "To:", the name, the address. From cell: "From:", the name, and
    // one paragraph per address line. A GSTIN adds one to whichever side has
    // one — and neither does here, so neither may carry a spare.
    const none = cells(renderDocx(QUOTE))
    expect(none[1], 'the To cell carries a blank GSTIN paragraph').toBe(3)
    expect(none[2], 'the From cell carries a blank GSTIN paragraph').toBe(
      2 + COMPANY.addressLines.length + (COMPANY.gstin ? 1 : 0),
    )

    // Give the customer one and exactly one paragraph appears, in the To cell.
    const some = cells(renderDocx({ ...QUOTE, customer: { ...QUOTE.customer, gstin: '29AABCM1234F1Z5' } }))
    expect(some[1]).toBe(none[1]! + 1)
    expect(some[2]).toBe(none[2])
    expect(some.slice(3)).toEqual(none.slice(3))
  })

  it('leaves the address block at two columns and the item table at five', () => {
    // GSTIN yes, HSN no. Both GSTIN lines are paragraphs inside cells that
    // already exist, so neither table may have gained a column.
    const xml = new PizZip(rendered).file('word/document.xml')!.asText()
    const columns = [...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)].map(
      (m) => (m[1]!.match(/<w:gridCol /g) ?? []).length,
    )
    expect(columns).toEqual([2, 5])
  })

  it('draws one vertical rule down the address block, not two near-misses', () => {
    // The original splits To/From at 5098 and Contact/Email at 5240, with a
    // 142-twip spacer column to allow it — so the rule under "From:" printed
    // 7pt to the left of the rule under "Email:". Two rules that nearly line up
    // read as a mistake rather than as a choice, and the desk asked for them
    // joined. Every row must therefore break at the same column.
    const xml = new PizZip(rendered).file('word/document.xml')!.asText()
    const table = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'))

    const breaks = table
      .split('<w:tr>')
      .slice(1)
      .map((row) => {
        // Where each row's cells end, cumulatively. A row spanning the whole
        // width has one boundary and constrains nothing.
        let x = 0
        const edges = [...row.matchAll(/<w:tcW w:w="(\d+)"/g)].map((m) => (x += Number(m[1])))
        return edges.slice(0, -1)
      })
      .filter((edges) => edges.length > 0)

    expect(breaks.length, 'no row splits the address block any more').toBeGreaterThan(1)
    expect(new Set(breaks.flat()).size, 'the address block breaks at more than one column').toBe(1)
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

  /**
   * The document is a Proforma Invoice now and the reference file is a
   * quotation, so two lines are SUPPOSED to differ.
   *
   * Asserted as pairs rather than deleted from the list above, because deleting
   * them would mean a later accidental revert to "Quotation" passed silently —
   * the one thing this test exists to catch.
   */
  it('says Proforma Invoice where the reference said Quotation, and only there', () => {
    const original = extractText(readFileSync(SAMPLE_DOCX)).replace(/\s+/g, ' ')
    const ours = extractText(renderDocx(QUOTE)).replace(/\s+/g, ' ')

    const renamed = [
      {
        was: 'Please find the following Quotation for your kind consideration: -',
        now: 'Please find the following Proforma Invoice for your kind consideration: -',
      },
      // The centred, bold, underlined heading.
      { was: 'Quotation', now: 'Proforma Invoice' },
    ]

    for (const { was, now } of renamed) {
      expect(original, `the reference document should still say "${was}"`).toContain(was)
      expect(ours, `ours should say "${now}"`).toContain(now)
    }

    // The rename is confined to those two lines: nothing else in our document
    // still calls itself a quotation.
    expect(ours).not.toMatch(/\bQuotation\b/)
    // ...and the reference series is untouched, because it is an identifier.
    expect(ours).toContain('NCS/2026-27/Quotes/RG/030')
  })
})

/**
 * Term 5 — the warranty, hoisted out of the line descriptions and printed once.
 *
 * It is the only term that is sometimes not there. Most quotations state no
 * warranty and must read exactly as they did before this term existed: four
 * numbered lines and nothing under them. That is what the template's
 * {#warranty} section is for, and it is a section spanning three paragraphs
 * rather than one inline pair for a reason these tests hold in place.
 */
describe('renderDocx — the fifth term', () => {
  const withWarranty = (warranty: string) =>
    renderDocx({ ...QUOTE, terms: { ...QUOTE.terms, warranty } })

  it('prints the warranty as term 5, under the other four', () => {
    expect(numberedTerms(withWarranty('3 Years Warranty'))).toEqual([
      '1. Payment Terms : 100% Advance',
      '2. Delivery : 1-2 Weeks after PO',
      '3. Prices : All-inclusive as per the quote',
      '4. Validity : 31st July 2026.',
      '5. Warranty : 3 Years Warranty',
    ])
  })

  it('prints the fifth term even when it holds nothing', () => {
    // The desk asked for term 5 on every document, so an empty one shows the
    // label with nothing after it rather than disappearing. That is why
    // DEFAULT_TERMS carries a warranty — the blank is filled before it prints,
    // not hidden after. This fixture deliberately has none, to pin the shape.
    expect(QUOTE.terms.warranty).toBe('')
    const numbered = numberedTerms(renderDocx(QUOTE))
    expect(numbered).toHaveLength(5)
    expect(numbered[4]).toMatch(/^5\. Warranty :/)
  })

  it('is the same block of paragraphs whether or not it holds a value', () => {
    // The terms block must not change SHAPE with its contents: a value that
    // adds or removes a paragraph moves everything below it — the closing, the
    // signature — and on a full quotation that is the difference between one
    // page and two. Only the count and the paragraph properties can see this;
    // stripped of its tags an empty paragraph and an absent one are the same
    // empty string.
    const none = termsBlock(renderDocx(QUOTE))
    const some = termsBlock(withWarranty('1 Year'))
    expect(some).toHaveLength(none.length)
    expect(none.map((p) => p.props)).toEqual(some.map((p) => p.props))
  })

  it('lands the fifth colon in the same column as the other four', () => {
    // Every numbered term carries the same indent and the same explicit tab
    // stop, which is what puts all five colons in one column. Term 5 built by
    // hand with a different paragraph shape would print half a centimetre out
    // and nothing else would notice.
    const numbered = termsBlock(withWarranty('1 Year')).filter((p) => /^\d+\.\s/.test(p.text))
    expect(numbered).toHaveLength(5)
    expect(new Set(numbered.map((p) => p.props)).size, 'the five terms disagree on layout').toBe(1)
    expect(numbered[4]!.props).toContain('<w:tab w:val="left" w:pos="3413"/>')
  })

  it('prints no value for a warranty that is only whitespace', () => {
    // Without the trim in buildRenderModel a stray space typed in the editor
    // reaches the document as a value, so the label is followed by a blank that
    // looks deliberate rather than by nothing.
    expect(buildRenderModel({ ...QUOTE, terms: { ...QUOTE.terms, warranty: '  ' } }).warranty).toBe(
      '',
    )
    expect(numberedTerms(withWarranty('   '))).toEqual(numberedTerms(renderDocx(QUOTE)))
  })

  it('resolves the value rather than printing the model into the document', () => {
    // Kept from when term 5 was wrapped in a {#warranty} section, where {.} —
    // the documented way to print a section's own value — rendered
    // "[object Object]" onto the quotation, because docxtemplater treats a
    // truthy STRING as a condition and not as a scope. The section is gone, but
    // an assertion that the customer's copy never carries a JavaScript object
    // costs nothing to keep.
    const text = extractText(withWarranty('1 Year Onsite'))
    expect(text).toContain('5. Warranty : 1 Year Onsite')
    expect(text).not.toContain('[object Object]')
  })
})

describe('documentFilename — §8', () => {
  it('uses the customer first word and the date', () => {
    expect(documentFilename(QUOTE, 'docx')).toBe('ProformaInvoice-Morgan-2026-07-10.docx')
    expect(documentFilename(QUOTE, 'pdf')).toBe('ProformaInvoice-Morgan-2026-07-10.pdf')
  })

  it('marks revisions and survives punctuation in the customer name', () => {
    expect(documentFilename({ ...QUOTE, revision: 2 }, 'docx')).toBe(
      'ProformaInvoice-Morgan-2026-07-10-Rev2.docx',
    )
    expect(
      documentFilename({ ...QUOTE, customer: { ...QUOTE.customer, name: 'L&T / Infotech' } }, 'docx'),
    ).toBe('ProformaInvoice-LT-2026-07-10.docx')
  })
})
