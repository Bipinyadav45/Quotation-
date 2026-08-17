import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { getDb } from './db/client.js'
import { cleanTempDir, converterStatus, warmUp } from './lib/pdf.js'

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

// --- routes land here as milestones complete -------------------------------
// app.use('/api', parseRoutes)
// app.use('/api', quoteRoutes)
// app.use('/api', renderRoutes)

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

function boot(): void {
  getDb() // opens the file and applies migrations, or throws loudly

  cleanTempDir()
  void warmUp() // fire and forget — a cold converter must not delay startup

  app.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port}`)
    console.log(`[server] database ${config.dbPath}`)
    if (!config.sofficePath) {
      console.warn(
        '[server] LibreOffice not found — PDF export is disabled, .docx export is unaffected.\n' +
          '         Install with: winget install --id TheDocumentFoundation.LibreOffice\n' +
          '         Or set SOFFICE_PATH in .env',
      )
    }
  })
}

boot()
