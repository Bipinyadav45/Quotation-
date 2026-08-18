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

/**
 * Microsoft Word, the second PDF backend. Windows only, and it needs Office
 * installed — but installing Office needs no administrator rights the way a
 * per-machine LibreOffice MSI does, and it renders a Word document with Word.
 */
function detectWinword(): string | null {
  if (process.platform !== 'win32') return null

  const fromEnv = process.env.WINWORD_PATH?.trim()
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null

  const roots = ['C:\\Program Files', 'C:\\Program Files (x86)']
  const layouts = ['Microsoft Office\\root', 'Microsoft Office']
  const versions = ['Office16', 'Office15', 'Office14']

  for (const root of roots) {
    for (const layout of layouts) {
      for (const version of versions) {
        const candidate = `${root}\\${layout}\\${version}\\WINWORD.EXE`
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return null
}

const sofficePath = detectSoffice()
const winwordPath = detectWinword()

/**
 * Which converter to use. LibreOffice is preferred when both are present: it is
 * headless by design, it does not tie up the user's copy of Word, and it is the
 * only one that works on a Linux server. Word is the fallback, and on a desktop
 * with Office it is the higher-fidelity of the two.
 *
 * Override with PDF_BACKEND=word|libreoffice in .env.
 */
function choosePdfBackend(): 'libreoffice' | 'word' | null {
  const forced = process.env.PDF_BACKEND?.trim().toLowerCase()
  if (forced === 'libreoffice') return sofficePath ? 'libreoffice' : null
  if (forced === 'word') return winwordPath ? 'word' : null

  if (sofficePath) return 'libreoffice'
  if (winwordPath) return 'word'
  return null
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  dbPath: resolveFromRoot(process.env.DB_PATH ?? './data/quotes.db'),
  templatePath: resolveFromRoot(
    process.env.TEMPLATE_PATH ?? './server/templates/quotation-template.docx',
  ),
  sofficePath,
  winwordPath,
  pdfBackend: choosePdfBackend(),
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
