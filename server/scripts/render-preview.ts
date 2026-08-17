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
 * Renders §11's quotation through the rebuilt template, converts it to PDF,
 * rasterises page one, and does the same to the quotation Newtech actually
 * sent — so the two can be put side by side. A text diff proves the content
 * survived Correction 1; only a picture proves the layout did.
 *
 * Everything lands in .preview/ (gitignored).
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Quote } from '@shared/schema.js'
import { ROOT, config } from '../src/config.js'
import { renderDocx } from '../src/lib/docx.js'

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
  reconciliation: [],
  status: 'draft',
  createdAt: '2026-07-10T00:00:00.000Z',
}

function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

function convert(soffice: string, input: string, target: string, outDir: string): void {
  const profile = path.join(outDir, `.profile-${path.basename(input)}-${target.split(':')[0]}`)
  mkdirSync(profile, { recursive: true })

  const result = spawnSync(
    soffice,
    [
      `-env:UserInstallation=${toFileUrl(profile)}`,
      '--headless',
      '--norestore',
      '--invisible',
      '--nolockcheck',
      '--nodefault',
      '--convert-to',
      target,
      '--outdir',
      outDir,
      input,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`soffice exited ${result.status}: ${result.stderr || result.stdout}`)
  }
  rmSync(profile, { recursive: true, force: true })
}

function main(): void {
  const soffice = config.sofficePath
  if (!soffice) {
    console.error('LibreOffice not found. Install it, or set SOFFICE_PATH in .env.')
    process.exit(1)
  }

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  // Ours: render through the rebuilt template.
  const oursDocx = path.join(OUT, 'ours.docx')
  writeFileSync(oursDocx, renderDocx(QUOTE))

  // Theirs: the hand-made original, copied under a simple name so LibreOffice
  // does not have to cope with the spaces and ampersand in the real filename.
  const theirsDocx = path.join(OUT, 'original.docx')
  if (!existsSync(SAMPLE)) throw new Error(`Reference quotation missing: ${SAMPLE}`)
  copyFileSync(SAMPLE, theirsDocx)

  // A4 at 150dpi — legible without being enormous.
  const PNG =
    'png:writer_png_Export:{"PixelWidth":{"type":"long","value":1240},' +
    '"PixelHeight":{"type":"long","value":1754}}'

  for (const file of [oursDocx, theirsDocx]) {
    console.log(`converting ${path.basename(file)} …`)
    convert(soffice, file, 'pdf', OUT)
    convert(soffice, file, PNG, OUT)
  }

  console.log('\nwrote:')
  for (const f of readdirSync(OUT).sort()) console.log(`  .preview/${f}`)
  console.log('\nCompare .preview/ours.png against .preview/original.png.')
}

main()
