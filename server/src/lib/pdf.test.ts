import { describe, expect, it } from 'vitest'
import { config } from '../config.js'
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
  terms: { payment: '100% Advance', delivery: '1-2 Weeks after PO', prices: 'All-inclusive as per the quote', validity: '31st July 2026.' },
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
