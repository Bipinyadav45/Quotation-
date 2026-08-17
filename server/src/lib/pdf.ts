import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { config, ROOT } from '../config.js'

/**
 * DOCX -> PDF, supervised.
 *
 * Shelling `soffice` naively has a failure that does not show up in testing:
 * concurrent invocations that SHARE A USER PROFILE DIRECTORY collide — the
 * second call either hangs or exits 0 having written nothing. With one person
 * clicking Download PDF you never see it; with three people clicking at once,
 * you do.
 *
 * So every conversion in this process goes through here, and this module:
 *   1. runs a queue of concurrency 1, so two conversions never overlap
 *   2. gives each call an isolated profile via -env:UserInstallation
 *   3. enforces a hard timeout and kills the whole process tree on expiry
 *   4. verifies the output file actually exists (exit 0 is not proof)
 *   5. retries once, then fails with a clear message
 *   6. warms up at boot so the first real PDF does not pay the 2-4s cold start
 *
 * If LibreOffice is not installed the module reports `unavailable` and the PDF
 * route returns 503. The .docx download never depends on this.
 */

const TIMEOUT_MS = 60_000
const TMP_ROOT = path.resolve(ROOT, '.tmp', 'soffice')

export type ConverterStatus = 'ready' | 'unavailable' | 'error'

let status: ConverterStatus = config.sofficePath ? 'ready' : 'unavailable'
let statusDetail: string = config.sofficePath
  ? `LibreOffice at ${config.sofficePath}`
  : 'LibreOffice not found. Install it (winget install --id TheDocumentFoundation.LibreOffice) or set SOFFICE_PATH in .env.'

export function converterStatus(): { status: ConverterStatus; detail: string } {
  return { status, detail: statusDetail }
}

export class PdfUnavailableError extends Error {
  readonly code = 'PDF_UNAVAILABLE'
  constructor(detail: string) {
    super(detail)
    this.name = 'PdfUnavailableError'
  }
}

// ---------------------------------------------------------------------------
// Concurrency-1 queue. Five lines, no dependency. A rejection must never poison
// the chain, hence the swallow on the tail.
// ---------------------------------------------------------------------------
let chain: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

// ---------------------------------------------------------------------------

/** Windows needs `C:\x\y` expressed as `file:///C:/x/y` for -env:UserInstallation. */
function toFileUrl(dir: string): string {
  const withForwardSlashes = dir.replace(/\\/g, '/')
  return `file:///${withForwardSlashes.replace(/^\/+/, '')}`
}

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // Already gone. Nothing to do.
  }
}

function runSoffice(soffice: string, args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(soffice, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))

    const timer = setTimeout(() => {
      if (child.pid) killTree(child.pid)
      reject(new Error(`LibreOffice timed out after ${TIMEOUT_MS}ms and was killed`))
    }, TIMEOUT_MS)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stderr })
      else reject(new Error(`LibreOffice exited ${code}: ${stderr || stdout || '(no output)'}`))
    })
  })
}

/** One conversion attempt in a freshly created, isolated profile directory. */
async function convertOnce(soffice: string, input: Buffer, extension: string): Promise<Buffer> {
  const jobDir = path.join(TMP_ROOT, randomUUID())
  const profileDir = path.join(jobDir, 'profile')
  const outDir = path.join(jobDir, 'out')
  const inputPath = path.join(jobDir, `input.${extension}`)
  const outputPath = path.join(outDir, 'input.pdf')

  mkdirSync(profileDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(inputPath, input)

  try {
    await runSoffice(soffice, [
      // Must come first, and is the entire reason concurrent calls stop colliding.
      `-env:UserInstallation=${toFileUrl(profileDir)}`,
      '--headless',
      '--norestore',
      '--invisible',
      '--nolockcheck',
      '--nodefault',
      '--nofirststartwizard',
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      inputPath,
    ])

    // Exit 0 is NOT proof of success — a colliding invocation exits 0 having
    // written nothing at all. The output file is the only real evidence.
    if (!existsSync(outputPath)) {
      throw new Error('LibreOffice reported success but produced no PDF')
    }

    return readFileSync(outputPath)
  } finally {
    rmSync(jobDir, { recursive: true, force: true })
  }
}

/**
 * Convert a DOCX buffer to a PDF buffer. Serialised against every other caller.
 * Retries once — a first failure is often a cold or half-initialised profile.
 */
export function docxToPdf(docx: Buffer): Promise<Buffer> {
  const soffice = config.sofficePath
  if (!soffice) throw new PdfUnavailableError(statusDetail)

  return enqueue(async () => {
    try {
      return await convertOnce(soffice, docx, 'docx')
    } catch (first) {
      try {
        return await convertOnce(soffice, docx, 'docx')
      } catch (second) {
        status = 'error'
        statusDetail = `Conversion failed twice: ${(second as Error).message}`
        throw new Error(
          `PDF conversion failed. First attempt: ${(first as Error).message}. ` +
            `Retry: ${(second as Error).message}. The .docx download is unaffected.`,
        )
      }
    }
  })
}

/**
 * Fired once at boot. LibreOffice's first invocation in a fresh profile costs
 * 2-4 seconds; paying it here means the first real Download PDF does not.
 * Never throws — a failed warm-up just flips the reported status.
 */
export async function warmUp(): Promise<void> {
  const soffice = config.sofficePath
  if (!soffice) return

  const started = Date.now()
  try {
    await enqueue(() => convertOnce(soffice, Buffer.from('warmup\n', 'utf8'), 'txt'))
    status = 'ready'
    statusDetail = `LibreOffice at ${soffice} (warmed in ${Date.now() - started}ms)`
    console.log(`[pdf] converter ready — ${statusDetail}`)
  } catch (err) {
    status = 'error'
    statusDetail = `LibreOffice found at ${soffice} but the warm-up conversion failed: ${(err as Error).message}`
    console.warn(`[pdf] ${statusDetail}`)
  }
}

/** Clear anything a previous crash left behind. Called at boot. */
export function cleanTempDir(): void {
  rmSync(TMP_ROOT, { recursive: true, force: true })
  mkdirSync(TMP_ROOT, { recursive: true })
}
