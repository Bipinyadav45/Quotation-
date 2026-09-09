import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { config, ROOT } from '../src/config.js'

/**
 * npm run backup            write a timestamped copy into backups/
 * npm run backup -- <path>  write it where you say
 *
 * DO NOT REPLACE THIS WITH `cp data/quotes.db`.
 *
 * The database runs in WAL mode, so recent writes live in quotes.db-wal until
 * SQLite checkpoints them. On this machine, right now, the main file is 4 KB
 * and the -wal is 2.7 MB: copying quotes.db alone backs up an empty database,
 * reports success, and is discovered to be worthless on the day it is needed.
 *
 * VACUUM INTO takes a consistent snapshot of the whole database — committed WAL
 * content included — while the application keeps running, and compacts it on
 * the way out. The result is a single ordinary .db file with no sidecars, which
 * is exactly what a restore, a QA refresh, or a developer's `data:refresh`
 * wants.
 *
 * The copy is opened and counted afterwards. A backup nobody has read is a
 * hypothesis, and the cheapest moment to test it is immediately.
 */

function stamp(): string {
  // No colons: this has to be a filename on Windows too.
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function main(): void {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const dest = arg
    ? path.resolve(arg)
    : path.resolve(ROOT, 'backups', `quotes-${stamp()}.db`)

  if (!existsSync(config.dbPath)) {
    throw new Error(`No database at ${config.dbPath} — nothing to back up.`)
  }
  if (existsSync(dest)) {
    // VACUUM INTO refuses to overwrite, but failing here says why.
    throw new Error(`${dest} already exists; refusing to overwrite a backup.`)
  }

  mkdirSync(path.dirname(dest), { recursive: true })

  // Read-only: a backup must never be able to modify what it is copying.
  const db = new Database(config.dbPath, { readonly: true })
  try {
    const wal = `${config.dbPath}-wal`
    if (existsSync(wal)) {
      const main = statSync(config.dbPath).size
      const w = statSync(wal).size
      if (w > main) {
        // Not a problem — just the case that makes a plain file copy wrong.
        console.log(`  (${mb(w)} of this is still in the -wal; a file copy would have missed it)`)
      }
    }

    // Quoting: the path can contain spaces, and single quotes are SQLite's
    // string literal. Doubling any embedded quote is the escape.
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
  } finally {
    db.close()
  }

  // Prove it opens and carries the data, before anyone relies on it.
  const copy = new Database(dest, { readonly: true })
  try {
    const migrations = copy.prepare('SELECT count(*) AS n FROM _migrations').get() as { n: number }
    const customers = copy.prepare('SELECT count(*) AS n FROM customers').get() as { n: number }
    const quotes = copy.prepare('SELECT count(*) AS n FROM quotes').get() as { n: number }

    console.log(`Backed up to ${path.relative(ROOT, dest)}`)
    console.log(`  ${mb(statSync(dest).size)}`)
    console.log(
      `  verified: ${migrations.n} migration(s), ${customers.n} customer(s), ${quotes.n} quotation(s)`,
    )
  } finally {
    copy.close()
  }
}

try {
  main()
} catch (err) {
  console.error(`\nBackup failed: ${(err as Error).message}`)
  process.exit(1)
}
