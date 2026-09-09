import Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { config, ROOT } from '../src/config.js'
import { closeDb, getDb } from '../src/db/client.js'

/**
 * npm run migrate            apply pending migrations, then exit
 * npm run migrate -- --check report what is pending, change nothing
 *
 * Migrations otherwise run implicitly inside getDb(), which means the first
 * thing a bad migration does is take the server down at boot — on whichever
 * machine happened to start it. That is a poor place to find out.
 *
 * Running the same code as its own step gives the pipeline somewhere to fail
 * safely: apply against a restored copy of the QA database, and a migration
 * that works on an empty schema but not on real data is caught before it is
 * anywhere near production. --check is the read-only form, for asserting that
 * a database is already current.
 *
 * There is no down-migration, by design (see server/src/db/migrate.ts). Rolling
 * a schema change back means restoring the pre-deploy backup — which is why the
 * production deploy takes one first.
 */

const MIGRATIONS_DIR = path.resolve(ROOT, 'server', 'db', 'migrations')

function pendingWithoutApplying(): string[] {
  const onDisk = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  // A database that does not exist yet has everything pending. Opening it here
  // would create an empty file as a side effect of asking a question.
  if (!existsSync(config.dbPath)) return onDisk

  const db = new Database(config.dbPath, { readonly: true })
  try {
    const hasTable = db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
      .get() as { n: number }
    if (hasTable.n === 0) return onDisk

    const applied = new Set(
      db.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
    )
    return onDisk.filter((f) => !applied.has(f))
  } finally {
    db.close()
  }
}

function main(): void {
  const check = process.argv.slice(2).includes('--check')

  console.log(`Database ${path.relative(ROOT, config.dbPath)}`)

  if (check) {
    const pending = pendingWithoutApplying()
    if (pending.length === 0) {
      console.log('Up to date — nothing pending.')
      return
    }
    console.log(`${pending.length} migration(s) pending:`)
    for (const f of pending) console.log(`  ${f}`)
    // Non-zero so a pipeline step can assert "this database is current".
    process.exitCode = 1
    return
  }

  // getDb() applies them and logs what it applied.
  const db = getDb()
  const { n } = db.prepare('SELECT count(*) AS n FROM _migrations').get() as { n: number }
  console.log(`Up to date — ${n} migration(s) applied in total.`)
  closeDb()
}

try {
  main()
} catch (err) {
  // A failed migration is the one error here that must not scroll past.
  console.error(`\nMigration failed: ${(err as Error).message}`)
  process.exit(1)
}
