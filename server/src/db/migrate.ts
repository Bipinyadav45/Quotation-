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
  const isApplied = db.prepare('SELECT 1 FROM _migrations WHERE name = ?')
  const done: string[] = []

  for (const file of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    // better-sqlite3 cannot run multi-statement SQL inside a prepared transaction,
    // so drive BEGIN/COMMIT explicitly around the exec.
    //
    // IMMEDIATE rather than SQLite's default DEFERRED: it takes the write lock
    // at BEGIN instead of at the first write. Without it, two connections
    // opening this file at the same moment both read `pending`, both conclude a
    // migration is outstanding, and the loser fails with "duplicate column
    // name" on a schema that is actually correct. That is not hypothetical --
    // the test suite runs its files in parallel workers and eleven of them
    // share the default database, so CI hit it intermittently. Two overlapping
    // application starts would do the same.
    db.exec('BEGIN IMMEDIATE')
    try {
      // `pending` was computed before this lock was held, so another connection
      // may have applied this file in the meantime. Re-check inside the lock.
      if (isApplied.get(file)) {
        db.exec('COMMIT')
        continue
      }
      db.exec(sql)
      record.run(file, new Date().toISOString())
      db.exec('COMMIT')
      done.push(file)
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err })
    }
  }

  // What this call actually applied, which is not the same as what it found
  // pending when another connection got there first.
  return done
}
