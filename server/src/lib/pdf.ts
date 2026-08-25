import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import PizZip from 'pizzip'
import { config, ROOT } from '../config.js'

/**
 * DOCX -> PDF, supervised.
 *
 * Two backends, because the machines this runs on differ:
 *
 *   libreoffice  headless, cross-platform, no Office needed. Preferred on a
 *                server, and the only option on Linux.
 *   word         Microsoft Word driven over COM. Windows only, and needs Office
 *                installed — but it is Word's own renderer on a document
 *                authored for Word, so fidelity is as good as it gets, and it
 *                needs no administrator rights to set up.
 *
 * Whichever runs, the supervision around it is the same, and it exists because
 * naive conversion has a failure that does not show up in testing: concurrent
 * `soffice` invocations SHARING A USER PROFILE DIRECTORY collide — the second
 * either hangs or exits 0 having written nothing. Word automation is likewise
 * not built for concurrent use. With one person clicking Download PDF you never
 * see it; with three at once you do.
 *
 * So every conversion in this process goes through here, and this module:
 *   1. runs a queue of concurrency 1, so two conversions never overlap
 *   2. isolates each LibreOffice call with its own -env:UserInstallation
 *   3. enforces a hard timeout and kills the whole process tree on expiry
 *   4. verifies the output file actually exists (exit 0 is not proof)
 *   5. retries once, then fails with a clear message
 *   6. warms up at boot so the first real PDF does not pay the cold start
 *
 * If neither backend is present the module reports `unavailable` and the PDF
 * route returns 503. The .docx download never depends on this.
 */

const TIMEOUT_MS = 90_000
const TMP_ROOT = path.resolve(ROOT, '.tmp', 'pdf')

export type ConverterStatus = 'ready' | 'unavailable' | 'error'
export type Backend = 'libreoffice' | 'word'

let status: ConverterStatus = config.pdfBackend ? 'ready' : 'unavailable'
let statusDetail: string = describeBackend()

function describeBackend(): string {
  switch (config.pdfBackend) {
    case 'libreoffice':
      return `LibreOffice at ${config.sofficePath}`
    case 'word':
      return `Microsoft Word (${config.winwordPath})`
    default:
      return (
        'No PDF converter found. Install LibreOffice ' +
        '(winget install --id TheDocumentFoundation.LibreOffice) or Microsoft Word, ' +
        'or set SOFFICE_PATH in .env.'
      )
  }
}

export function converterStatus(): {
  status: ConverterStatus
  detail: string
  backend: Backend | null
} {
  return { status, detail: statusDetail, backend: config.pdfBackend }
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

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))

    const timer = setTimeout(() => {
      if (child.pid) killTree(child.pid)
      reject(new Error(`${path.basename(command)} timed out after ${TIMEOUT_MS}ms and was killed`))
    }, TIMEOUT_MS)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`exited ${code}: ${(stderr || stdout || '(no output)').trim()}`))
    })
  })
}

/** Windows needs `C:\x\y` expressed as `file:///C:/x/y` for -env:UserInstallation. */
function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

async function convertWithLibreOffice(
  soffice: string,
  inputPath: string,
  outDir: string,
  jobDir: string,
): Promise<void> {
  const profileDir = path.join(jobDir, 'profile')
  mkdirSync(profileDir, { recursive: true })

  await run(soffice, [
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
}

/**
 * Word, driven over COM from a throwaway PowerShell script.
 *
 * A script file rather than -Command so paths with spaces, ampersands and
 * apostrophes cannot break the quoting — the letterhead's own filename has all
 * three. Word is opened read-only with alerts suppressed so it can never sit
 * waiting on a dialog nobody can see.
 *
 * THE FINALLY BLOCK IS NOT ENOUGH, and believing it was cost a source file.
 * Word is started by COM, so it is NOT a child of this PowerShell — it is its
 * own process, owned by DCOM. `killTree` on a timeout therefore kills the
 * script and leaves WINWORD.EXE running, and so does killing the server while a
 * conversion is in flight. Two hundred and eighty-two of them had accumulated
 * on this machine over four days, each quietly writing Office telemetry into
 * %TEMP%\Diagnostics until it reached 12.7 GB, filled the disk, and truncated
 * a file mid-write.
 *
 * So the script records the PID of the Word it started, and the caller kills
 * that PID if it is still there when the conversion ends — however it ended.
 */
async function convertWithWord(inputPath: string, outputPath: string, jobDir: string): Promise<void> {
  const scriptPath = path.join(jobDir, 'convert.ps1')
  const pidPath = path.join(jobDir, 'word.pid')

  const script = `
$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null
# Which WINWORD processes existed before we started one. The queue runs at
# concurrency 1, so anything new between these two lines is ours — and a copy
# of Word the desk opened themselves is never in the difference.
$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
try {
  $word = New-Object -ComObject Word.Application
  @(Get-Process WINWORD -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) |
    Where-Object { $_ -notin $before } |
    Set-Content -Path ${psString(pidPath)} -Encoding ascii
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open(
    ${psString(inputPath)},
    [ref]$false,   # ConfirmConversions
    [ref]$true,    # ReadOnly
    [ref]$false    # AddToRecentFiles
  )
  # 17 = wdExportFormatPDF
  $doc.ExportAsFixedFormat(${psString(outputPath)}, 17)
} finally {
  if ($doc)  { try { $doc.Close([ref]$false) } catch {} }
  if ($word) { try { $word.Quit() } catch {} }
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc)  2>$null | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) 2>$null | Out-Null
  [GC]::Collect()
}
`.trim()

  writeFileSync(scriptPath, script, 'utf8')

  try {
    await run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ])
  } finally {
    // However that ended — cleanly, by throwing, or by being killed on the
    // timeout — the Word it started is not a child of it and will outlive it
    // otherwise.
    reapWord(pidPath)
  }
}

/**
 * Kill the Word instance a conversion started, if it is still there.
 *
 * Reads the PID the script wrote rather than guessing from process names, so a
 * copy of Word the desk has open with unsaved work is never a candidate. A PID
 * that has already exited is the ordinary case and not an error.
 */
function reapWord(pidPath: string): void {
  let recorded: string
  try {
    recorded = readFileSync(pidPath, 'utf8')
  } catch {
    return // the script never got as far as starting Word
  }

  for (const line of recorded.split(/\r?\n/)) {
    const pid = Number(line.trim())
    if (!Number.isInteger(pid) || pid <= 0) continue
    try {
      process.kill(pid, 'SIGKILL')
      console.warn(`[pdf] Word ${pid} outlived its conversion and was stopped`)
    } catch {
      // Already gone, which is what the finally block in the script is for.
    }
  }
}

/** Single-quoted PowerShell literal — the only escape needed is a doubled quote. */
function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** One conversion attempt, in its own throwaway directory. */
async function convertOnce(input: Buffer, extension: string): Promise<Buffer> {
  const jobDir = path.join(TMP_ROOT, randomUUID())
  const outDir = path.join(jobDir, 'out')
  const inputPath = path.join(jobDir, `input.${extension}`)
  const outputPath = path.join(outDir, 'input.pdf')

  mkdirSync(outDir, { recursive: true })
  writeFileSync(inputPath, input)

  try {
    if (config.pdfBackend === 'word') {
      await convertWithWord(inputPath, outputPath, jobDir)
    } else {
      await convertWithLibreOffice(config.sofficePath!, inputPath, outDir, jobDir)
    }

    // Exit 0 is NOT proof of success — a colliding LibreOffice invocation exits
    // 0 having written nothing at all. The output file is the only real evidence.
    if (!existsSync(outputPath)) {
      throw new Error('the converter reported success but produced no PDF')
    }

    return readFileSync(outputPath)
  } finally {
    discard(jobDir)
  }
}

/**
 * Delete a finished job directory, and never let that deletion become the
 * failure.
 *
 * `force: true` swallows a missing path but NOT a locked one, and on Windows
 * the converter can still hold a handle for a moment after the process has
 * exited — Word especially, which releases its COM objects on its own schedule.
 * The result was EBUSY thrown out of a `finally` block: a conversion that had
 * already produced a perfectly good PDF reported a crash instead, and because
 * this also runs at boot it took the whole API process down with it.
 *
 * So: a few short retries, then give up quietly. A directory left behind costs
 * a few hundred kilobytes until the next boot, which is precisely what
 * cleanTempDir exists to sweep up. Losing a rendered document, or the server,
 * costs considerably more.
 */
function discard(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      // Busy-wait rather than await: this is called from a finally block that
      // must not change the shape of what it is wrapping.
      const until = Date.now() + 40
      while (Date.now() < until) { /* let the handle close */ }
    }
  }
  console.warn(`[pdf] could not remove ${dir}; it will be swept at the next start`)
}

/**
 * Convert a DOCX buffer to a PDF buffer. Serialised against every other caller.
 * Retries once — a first failure is often a cold or half-initialised backend.
 */
export function docxToPdf(docx: Buffer): Promise<Buffer> {
  if (!config.pdfBackend) throw new PdfUnavailableError(statusDetail)

  return enqueue(async () => {
    try {
      return await convertOnce(docx, 'docx')
    } catch (first) {
      try {
        return await convertOnce(docx, 'docx')
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
 * Fired once at boot. The first conversion in a fresh profile — or the first
 * time Word is launched — costs several seconds; paying it here means the first
 * real Download PDF does not. Never throws; a failed warm-up flips the status.
 */
export async function warmUp(): Promise<void> {
  if (!config.pdfBackend) return

  const started = Date.now()
  try {
    // Word will not open a .txt as a Word document reliably, so warm both
    // backends with a real (tiny) docx-shaped round trip via the same path.
    await enqueue(() => convertOnce(MINIMAL_DOCX, 'docx'))
    status = 'ready'
    statusDetail = `${describeBackend()} — warmed in ${Date.now() - started}ms`
    console.log(`[pdf] converter ready — ${statusDetail}`)
  } catch (err) {
    status = 'error'
    statusDetail = `${describeBackend()} was found, but the warm-up conversion failed: ${(err as Error).message}`
    console.warn(`[pdf] ${statusDetail}`)
  }
}

/**
 * Clear anything a previous crash left behind. Called at boot.
 *
 * Tolerant of a directory still locked by a converter that has not quite let go
 * — a stale temp file is not a reason to refuse to start.
 */
export function cleanTempDir(): void {
  discard(TMP_ROOT)
  mkdirSync(TMP_ROOT, { recursive: true })
}

/**
 * The smallest valid .docx — a Word document containing the word "warmup".
 * Built at import time rather than checked in as a binary, so there is nothing
 * opaque in the repository.
 */
const MINIMAL_DOCX: Buffer = buildMinimalDocx()

function buildMinimalDocx(): Buffer {
  const zip = new PizZip()

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>warmup</w:t></w:r></w:p></w:body>
</w:document>`,
  )

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
