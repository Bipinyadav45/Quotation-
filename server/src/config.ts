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

// §1's company details live in shared/ so the editor's defaults and the
// document renderer read one definition.
export { COMPANY, DEFAULT_TERMS, GST_RATE_PERCENT, SALESPEOPLE } from '@shared/company.js'
