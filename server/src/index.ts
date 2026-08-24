import express from 'express'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { getDb } from './db/client.js'
import { cleanTempDir, converterStatus, warmUp } from './lib/pdf.js'
import { parseRoutes } from './routes/parse.js'
import { quoteRoutes } from './routes/quote.js'
import { renderRoutes } from './routes/render.js'

const app = express()

app.use(express.json({ limit: '2mb' })) // email threads, not uploads

// Request log: method, path, status, duration. Enough to find the request
// behind a wrong quotation six weeks later without pulling in a log framework.
app.use((req, res, next) => {
  const started = Date.now()
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`)
  })
  next()
})

/**
 * Health covers both things that can be broken independently: the database and
 * the PDF converter. The converter being unavailable is NOT a failure — the
 * .docx path is untouched — so it reports `degraded` rather than `error`.
 */
app.get('/api/health', (_req, res) => {
  const checks: Record<string, { ok: boolean; detail: string }> = {}

  try {
    const row = getDb().prepare('SELECT count(*) AS n FROM _migrations').get() as { n: number }
    checks.database = { ok: true, detail: `${row.n} migration(s) applied` }
  } catch (err) {
    checks.database = { ok: false, detail: (err as Error).message }
  }

  const pdf = converterStatus()
  checks.pdf = { ok: pdf.status === 'ready', detail: pdf.detail }

  const status = !checks.database.ok ? 'error' : checks.pdf.ok ? 'ok' : 'degraded'
  res.status(checks.database.ok ? 200 : 503).json({ status, checks })
})

app.use('/api', parseRoutes)
app.use('/api', quoteRoutes)
app.use('/api', renderRoutes)

// In production the built frontend is served by this same process, so there is
// one port and one URL. In development Vite serves it on :5173 and proxies here.
if (existsSync(config.webDist)) {
  app.use(express.static(config.webDist))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(config.webDist, 'index.html'))
  })
}

// Express 5 forwards rejections from async handlers here automatically, so
// routes do not need try/catch around every await.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err)
  res.status(500).json({ error: err.message })
})

/**
 * A short hash of the API key, never any part of the key itself.
 *
 * It exists because an hour went into a bug that was not a bug: a dev server
 * from the previous day still held this port, so a replaced key never reached
 * the process actually answering, and the app kept reporting the OLD key's
 * quota as exhausted. Every check said the new key was fine, because every
 * check ran in a fresh process. One line at boot answers "which key is THIS
 * process using" and the whole class of confusion goes away.
 *
 * A hash rather than a prefix: two keys issued to the same project share their
 * first characters, so a prefix would have been identical for both and proved
 * nothing.
 */
function keyFingerprint(): string {
  const key = config.geminiApiKey
  if (!key) return 'none set — the AI features are off'
  return `#${createHash('sha256').update(key).digest('hex').slice(0, 8)}`
}

/** How long to let an outgoing `tsx watch` process release the port. */
const HANDOVER_MS = 5_000
const HANDOVER_STEP_MS = 250

function boot(): void {
  getDb() // opens the file and applies migrations, or throws loudly

  cleanTempDir()
  void warmUp() // fire and forget — a cold converter must not delay startup

  const server = app.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port}`)
    console.log(`[server] database ${config.dbPath}`)
    console.log(`[server] AI key ${keyFingerprint()}`)
    if (config.pdfBackend) {
      console.log(`[server] PDF backend: ${config.pdfBackend}`)
    } else {
      console.warn(
        '[server] No PDF converter found — PDF export is disabled, .docx export is unaffected.\n' +
          '         Install LibreOffice: winget install --id TheDocumentFoundation.LibreOffice\n' +
          '         Or Microsoft Word, which this will use automatically.\n' +
          '         Or set SOFFICE_PATH / WINWORD_PATH in .env',
      )
    }
  })

  /**
   * A port already in use has to be LOUD — silence is how a server from the
   * previous day kept answering while every restart died unnoticed, and it cost
   * an afternoon of chasing a bug that was not there.
   *
   * But it must not be instant. `tsx watch` starts the replacement before the
   * outgoing process has released the socket, so a brief clash is the ordinary
   * case on every file save; exiting on the first one leaves nothing running at
   * all after a couple of edits. So wait for the old one to go, and complain
   * only if it genuinely will not.
   */
  let waited = 0
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') throw err

    if (waited < HANDOVER_MS) {
      waited += HANDOVER_STEP_MS
      setTimeout(() => server.listen(config.port), HANDOVER_STEP_MS)
      return
    }

    console.error(
      `[server] Port ${config.port} is still taken after ${HANDOVER_MS / 1000}s — something ` +
        'else is answering on it, very likely an older copy of this server.\n' +
        '         Stop it first; this process is exiting rather than pretending to have started.',
    )
    process.exit(1)
  })
}

boot()
