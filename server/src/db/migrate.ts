import type BetterSqlite3 from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from '../config.js'

const MIGRATIONS_DIR = path.resolve(ROOT, 'server', 'db', 'migrations')

/**
 * The whole migration system. Numbered .sql files in server/db/migrations are
 * applied in filename order; each one runs inside a transaction and is recorded
 * so it never runs twice. Ordered, idempotent, and readable in one sitting —
 * which is the entire reason we did not reach for an ORM.
 *
 * To change the schema: add 002_whatever.sql. Never edit an applied file.
 */
export function migrate(db: BetterSqlite3.Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
  )

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f))

  const record = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')

  for (const file of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    // better-sqlite3 cannot run multi-statement SQL inside a prepared transaction,
    // so drive BEGIN/COMMIT explicitly around the exec.
    db.exec('BEGIN')
    try {
      db.exec(sql)
      record.run(file, new Date().toISOString())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err })
    }
  }

  return pending
}
