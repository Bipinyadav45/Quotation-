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
/**
 * The quotation the desk supplied as definitive, and the one the template was
 * rebuilt from. It replaced the Morgan Stanley sample as the reference: that
 * one is a blank-letterhead-shaped document with single-line descriptions,
 * where this is a real sent quotation with product names, specifications and a
 * grouped accessory — the shape the layout actually has to survive.
 */
const SAMPLE = path.resolve(
  ROOT,
  'Quotation-DGSL(Pondicherry) 23rd June 2026 -- HP ProBook - 06 Nos. & HP 280 G9 - 25 Nos.docx',
)

/** That quotation's own contents, so ours and theirs are the same document. */
const QUOTE: Quote = {
  id: 'preview',
  ref: 'NCS/2026-27/Quotes/RG/026',
  revision: 0,
  date: '2026-06-23',
  customer: {
    name: 'Datamatics Global Services Limited.',
    address:
      'R.S No.181/5, East Coast Rd Opp. Sankara Vidhyalaya School Lawspet Post\nPuducherry \u2013 605008.',
    attention: 'Mr. Mahesh Jathar.',
    state: 'Puducherry',
  },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  /**
   * Four lines where the original has two rows: it groups each accessory into
   * the row of the product it belongs to, and a {#items} loop gives one row per
   * item. The content and every figure are identical; only the row grouping
   * differs, and it is the one place ours will not overlay theirs exactly.
   */
  items: [
    {
      desc:
        'HP ProBook 4 G1iR ProBook/440 G11\n' +
        'U5-125U/16GB/1TB SSD/FHD 300 Nits/BLK/FPR/MII/Win 11 Pro/1 Yr Onsite/ Bag',
      make: 'HP',
      partCode: '440 G11',
      qty: 6,
      rate: 10_000_000,
    },
    { desc: '3 Years NBD and 3 Years ADP', make: 'HP', partCode: '', qty: 6, rate: 650_000 },
    {
      desc:
        'HP 280 G9 MT ( MII )\n' +
        'Core i5-14500,  8GB DDR5, 512GB SSD,  Wi-Fi, Onboard, , Win 11 Pro., 3 Years Warranty',
      make: 'HP',
      partCode: '280 G9',
      qty: 25,
      rate: 7_940_000,
    },
    { desc: 'Additional 8GB HP Memory', make: 'HP', partCode: '', qty: 25, rate: 1_200_000 },
  ],
  tax: { mode: 'IGST', rate: 18 },
  terms: {
    payment: '100% Advance',
    delivery: '5 -6 Days',
    prices: 'All Inclusive as per the quote',
    validity: '31st July 2026.',
  },
  totals: { sub: 292_400_000, tax: 52_632_000, total: 345_032_000 },
  sourceThread: '',
  status: 'draft',
  createdAt: '2026-06-23T00:00:00.000Z',
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
