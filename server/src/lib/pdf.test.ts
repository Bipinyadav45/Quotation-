import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, config } from '../config.js'
import { converterStatus, docxToPdf, warmUp } from './pdf.js'
import { renderDocx } from './docx.js'
import type { Quote } from '@shared/schema.js'

/**
 * The concurrency test.
 *
 * Concurrent `soffice` invocations that share a user profile directory collide:
 * the second either hangs or exits 0 having written nothing. One person
 * clicking Download PDF never sees it; three people clicking at once do. These
 * tests are the reason server/src/lib/pdf.ts is a queue rather than a function.
 *
 * Skipped when no converter is installed — the .docx path does not depend on
 * it, and a machine without it should not have a red suite.
 */

const hasConverter = config.pdfBackend !== null

const QUOTE: Quote = {
  id: 'pdf-test',
  ref: 'NCS/2026-27/Quotes/RG/900',
  revision: 0,
  customerId: null,
  queriesNumbers: '40668812/88',
  date: '2026-07-10',
  customer: {
    name: 'Morgan Stanley Advantage Services Pvt Ltd',
    address: 'Campus 8B, Sarjapur, Marathahalli\nOuter Ring Road, Bengaluru - 560103',
    attention: 'Mr. Subhransu Kar.',
  },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  items: [
    { desc: 'Black i USB-C to USB-A 1.5 mtr', make: 'Black i', partCode: '', qty: 2, rate: 55_000 },
    { desc: 'Logitech Wireless Keyboard and Mouse Set #MK540', make: 'Logitech', partCode: 'MK540', qty: 1, rate: 345_000 },
  ],
  tax: { mode: 'IGST', rate: 18 },
  terms: { payment: '100% Advance', delivery: '1-2 Weeks after PO', prices: 'All-inclusive as per the quote', validity: '31st July 2026.', warranty: '' },
  totals: { sub: 455_000, tax: 81_900, total: 536_900 },
  sourceThread: '',
  status: 'draft',
  createdAt: '2026-07-10T00:00:00.000Z',
}

const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-'

describe('PDF converter', () => {
  it('reports its own availability honestly', () => {
    const { status, detail } = converterStatus()
    expect(['ready', 'unavailable', 'error']).toContain(status)
    expect(detail.length).toBeGreaterThan(0)
    // An absent LibreOffice is `unavailable`, never `error` — nothing is broken.
    if (!hasConverter) expect(status).toBe('unavailable')
  })

  it.runIf(hasConverter)('converts a rendered quotation to a real PDF', { timeout: 180_000 }, async () => {
    await warmUp()
    const pdf = await docxToPdf(renderDocx(QUOTE))
    expect(isPdf(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(5_000)
  })

  it.runIf(hasConverter)(
    'survives three simultaneous conversions — the case that breaks an unsupervised soffice',
    { timeout: 300_000 },
    async () => {
      await warmUp()
      const docx = renderDocx(QUOTE)

      const results = await Promise.all([docxToPdf(docx), docxToPdf(docx), docxToPdf(docx)])

      expect(results).toHaveLength(3)
      for (const [i, pdf] of results.entries()) {
        expect(isPdf(pdf), `conversion ${i + 1} did not produce a PDF`).toBe(true)
        expect(pdf.length, `conversion ${i + 1} produced an empty PDF`).toBeGreaterThan(5_000)
      }
    },
  )

  it.runIf(hasConverter)(
    'stays usable after a bad input — one failure must not wedge the queue',
    { timeout: 180_000 },
    async () => {
      await expect(docxToPdf(Buffer.from('this is not a docx'))).rejects.toThrow()

      // The queue must still accept work after that rejection.
      const pdf = await docxToPdf(renderDocx(QUOTE))
      expect(isPdf(pdf)).toBe(true)
    },
  )
})

describe('temp-directory cleanup', () => {
  /**
   * A conversion that has produced a PDF must not be turned into a failure by
   * the deletion of its scratch directory.
   *
   * This is not hypothetical: on Windows the server crashed with EBUSY thrown
   * out of convertOnce's `finally` while Word still held input.docx, and the
   * same call runs at boot, so it took the process down on start too.
   */
  it('survives a scratch file that is still locked', async () => {
    const { cleanTempDir } = await import('./pdf.js')
    const tmpRoot = path.resolve(ROOT, '.tmp', 'pdf')

    mkdirSync(path.join(tmpRoot, 'locked'), { recursive: true })
    const held = path.join(tmpRoot, 'locked', 'input.docx')
    writeFileSync(held, 'x')

    // An open handle is what makes Windows refuse the unlink.
    const handle = openSync(held, 'r')
    try {
      expect(() => cleanTempDir()).not.toThrow()
    } finally {
      closeSync(handle)
      rmSync(path.join(tmpRoot, 'locked'), { recursive: true, force: true })
    }
  })
})

describe('how much of a page a quotation takes', () => {
  /**
   * An ordinary quotation must come out on ONE page.
   *
   * It did not. A single-line quotation filled page one to within 2pt of the
   * footer and put "Rakhi Gupte" alone on page two, under a letterhead logo and
   * above nothing at all — which is what the desk photographed and sent back.
   *
   * Nothing in the suite could see it. Page count is a property of the RENDERED
   * document, so it needs the converter, and every other assertion in the repo
   * reads .docx XML where a page break does not exist yet. This is the only
   * test that can fail on it, which is why it lives here beside the converter
   * rather than with the document tests.
   */
  const pageCount = async (quote: Quote): Promise<number> => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const bytes = new Uint8Array(await docxToPdf(renderDocx(quote)))
    return (await pdfjs.getDocument({ data: bytes, disableFontFace: true }).promise).numPages
  }

  it.runIf(config.pdfBackend)('fits an ordinary quotation on one page', async () => {
    expect(await pageCount({ ...QUOTE, items: QUOTE.items.slice(0, 1) })).toBe(1)
    // Two lines is the common case and must still fit.
    expect(await pageCount(QUOTE)).toBe(1)
  }, 120_000)

  it.runIf(config.pdfBackend)('keeps the whole closing together when it does spill', async () => {
    // A long quotation legitimately needs a second page. What must never happen
    // again is the signature travelling alone: keepNext ties "Thanking you,"
    // down to the name, so the closing moves as a block or not at all.
    const long: Quote = {
      ...QUOTE,
      items: Array.from({ length: 6 }, (_, i) => ({
        desc: `Logitech Pebble ${i + 1} Combo, Wireless Keyboard and Mouse`,
        make: 'Logitech',
        partCode: '',
        qty: 1,
        rate: 425_000,
      })),
    }

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const bytes = new Uint8Array(await docxToPdf(renderDocx(long)))
    const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true }).promise
    expect(doc.numPages).toBeGreaterThan(1)

    const last = await doc.getPage(doc.numPages)
    const text = (await last.getTextContent()).items
      .map((i) => ('str' in i ? i.str : ''))
      .join('')
      .replace(/\s+/g, ' ')

    // The name never arrives without the block it belongs to.
    expect(text).toContain('Rakhi Gupte')
    expect(text, 'the signature was stranded without its closing').toContain('Yours Truly')
    expect(text).toContain('Thanking you')
  }, 180_000)
})

/**
 * The PDF has to be EDITABLE, in Acrobat and in everything else.
 *
 * The desk asked for it and it is not a given: Word's ExportAsFixedFormat
 * defaults BitmapMissingFonts to TRUE, which means "if a font cannot be
 * embedded, draw that text as a picture". A quotation that comes out that way
 * has no text at all — nothing to select, search, copy or edit — and there is
 * no error to notice, because the export succeeds. It would happen only for the
 * customers whose document used the wrong glyph, which is the worst way for a
 * fault like this to be distributed.
 *
 * So this asserts the properties that make the file editable rather than the
 * flag that produces them: real extractable text, no encryption dictionary of
 * any kind, and embedded fonts.
 */
describe.skipIf(!hasConverter)('the PDF is editable, not a picture of a quotation', () => {
  it('carries the whole document as real text', async () => {
    const pdf = await docxToPdf(renderDocx(QUOTE))
    const text = (await pdfText(pdf)).replace(/\s+/g, ' ')

    // If any of these came back as a bitmap there would be no text to find.
    expect(text).toContain('Quotation')
    expect(text).toContain('Morgan Stanley Advantage Services Pvt Ltd')
    expect(text).toContain('NCS/2026-27/Quotes/RG/900')
    expect(text).toContain('Black i USB-C to USB-A 1.5 mtr')
    expect(text).toContain('GST 18%')
    expect(text).toContain('Rakhi Gupte')
    expect(text.length).toBeGreaterThan(800)
  }, 180_000)

  it('is not encrypted, so no editor has to ask for a password or refuse', async () => {
    // Word does not encrypt unless asked, and nothing here asks. Asserted
    // because an /Encrypt dictionary is also how permissions are expressed —
    // "printing allowed, editing not" is an encrypted PDF with an empty user
    // password, and it opens perfectly right up until somebody tries to change
    // a figure.
    const pdf = await docxToPdf(renderDocx(QUOTE))
    expect(pdf.toString('latin1')).not.toContain('/Encrypt')
  }, 180_000)

  it('embeds the fonts it uses', async () => {
    // An editor that has to substitute a font it cannot find re-flows the
    // document while you edit it. Word subsets on export and gives no way to
    // stop it — the faces come out as BCDEEE+TimesNewRomanPSMT — which is fine
    // for Times New Roman and Arial, the two the letterhead uses, because every
    // machine already has them. What must not happen is no embedding at all.
    const raw = (await docxToPdf(renderDocx(QUOTE))).toString('latin1')
    expect(raw).toMatch(/\/FontFile[23]/)
  }, 180_000)
})

/** The text of every page, joined. */
async function pdfText(pdf: Buffer): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise

  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await doc.getPage(n).then((page) => page.getTextContent())
    pages.push(
      content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
    )
  }
  return pages.join('\n')
}
