import 'dotenv/config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path to the project root, resolved from this file's own location. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p))

/**
 * LibreOffice is not on PATH on a Windows machine, so §12's env gets SOFFICE_PATH.
 * If it is blank we probe the usual install locations before giving up — the
 * converter degrades to "unavailable" rather than throwing, so the .docx download
 * keeps working either way. See server/src/lib/pdf.ts.
 */
function detectSoffice(): string | null {
  const fromEnv = process.env.SOFFICE_PATH?.trim()
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null

  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/usr/local/bin/soffice',
  ]
  return candidates.find(existsSync) ?? null
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dbPath: resolveFromRoot(process.env.DB_PATH ?? './data/quotes.db'),
  templatePath: resolveFromRoot(
    process.env.TEMPLATE_PATH ?? './server/templates/quotation-template.docx',
  ),
  sofficePath: detectSoffice(),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,

  /**
   * §5 role assignment cross-checks the sender of each thread block. Anything
   * from this domain is us, so a priced line in a block from anywhere else gets
   * surfaced for manual reassignment rather than silently classified.
   */
  internalEmailDomain: (process.env.INTERNAL_EMAIL_DOMAIN ?? 'newtech.in').toLowerCase(),

  /** Where the built frontend lands. Served by Express when it exists. */
  webDist: path.resolve(ROOT, 'web', 'dist'),
} as const

/** §1 — fixed company details. These are printed, not configured per quote. */
export const COMPANY = {
  name: 'Newtech Computer Services Pvt. Ltd.',
  addressLines: [
    '6th Floor, Solaris-II, Opp L&T Gate-6,',
    'Saki Vihar Road, Powai,',
    'Mumbai- 400072.',
  ],
  tel: '022 40668888',
  cin: 'U99999MH1984PTC034412',
  /** §7 — Newtech is registered in Maharashtra; this drives the tax-mode default. */
  homeState: 'Maharashtra',
} as const

/** §7 — defaults, all editable on the quote. */
export const DEFAULT_TERMS = {
  payment: '100% Advance',
  delivery: '1-2 Weeks after PO',
  prices: 'All-inclusive as per the quote',
  /** validity defaults to the end of the current month — computed in shared/fy.ts */
  validity: '',
} as const

export const GST_RATE_PERCENT = 18
