/**
 * Milestone 5's visual check.
 *
 *   npm run preview
 *
 * §10: "Verify the output by converting to PDF and rasterising the first page
 * during development — read the image and confirm the letterhead, the table
 * borders and the totals block all render as they do in the hand-made
 * original."
 *
 * Renders §11's quotation through the rebuilt template and converts it to PDF,
 * then does the same to the quotation Newtech actually sent, so the two can be
 * put side by side. A text diff proves the content survived Correction 1; only
 * a picture proves the layout did.
 *
 * Conversion goes through the shared converter, so it works on whichever
 * backend the machine has — LibreOffice or Word.
 *
 * Everything lands in .preview/ (gitignored).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Quote } from '@shared/schema.js'
import { ROOT, config } from '../src/config.js'
import { renderDocx } from '../src/lib/docx.js'
import { cleanTempDir, converterStatus, docxToPdf } from '../src/lib/pdf.js'

const OUT = path.resolve(ROOT, '.preview')
const SAMPLE = path.resolve(
  ROOT,
  'Quotation-Morgan Stanley - 10th July 2026 -- Black i USB, Lightning & Logitech - 01 No.(Sample).docx',
)

/** §11's quotation, exactly as Newtech sent it. */
const QUOTE: Quote = {
  id: 'preview',
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

async function main(): Promise<void> {
  if (!config.pdfBackend) {
    console.error(`No PDF converter available. ${converterStatus().detail}`)
    process.exit(1)
  }

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  cleanTempDir()

  console.log(`converter: ${converterStatus().detail}\n`)

  // Ours: rendered through the rebuilt template.
  const oursDocx = renderDocx(QUOTE)
  writeFileSync(path.join(OUT, 'ours.docx'), oursDocx)
  console.log('converting ours.docx …')
  writeFileSync(path.join(OUT, 'ours.pdf'), await docxToPdf(oursDocx))

  // Theirs: the hand-made original, untouched.
  if (!existsSync(SAMPLE)) throw new Error(`Reference quotation missing: ${SAMPLE}`)
  copyFileSync(SAMPLE, path.join(OUT, 'original.docx'))
  console.log('converting original.docx …')
  writeFileSync(path.join(OUT, 'original.pdf'), await docxToPdf(readFileSync(SAMPLE)))

  // Rasterise page one of each, so the layout can actually be looked at.
  // Done in-process with pdfjs rather than shelling out to poppler or
  // LibreOffice, so `npm run preview` works on any machine that can already
  // produce the PDF.
  console.log('\nrasterising page 1 …')
  await rasterise(path.join(OUT, 'ours.pdf'), path.join(OUT, 'ours.png'))
  await rasterise(path.join(OUT, 'original.pdf'), path.join(OUT, 'original.png'))

  console.log('\nwrote:')
  for (const f of readdirSync(OUT).sort()) console.log(`  .preview/${f}`)
  console.log('\nCompare .preview/ours.png against .preview/original.png.')
}

/** First page of a PDF to a PNG, at roughly 110 dpi. */
async function rasterise(pdfPath: string, pngPath: string): Promise<void> {
  const { createCanvas } = await import('@napi-rs/canvas')
  // The legacy build is the one that runs outside a browser.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdfPath)),
    // No system fonts to hunt for; the PDF embeds what it needs.
    disableFontFace: true,
  }).promise

  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1.5 })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')

  // PDF pages are transparent; without this the text renders onto black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise

  writeFileSync(pngPath, canvas.toBuffer('image/png'))
  console.log(`  ${path.basename(pngPath)}  ${canvas.width}x${canvas.height}  (${doc.numPages} page${doc.numPages === 1 ? '' : 's'})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
