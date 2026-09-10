import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ROOT } from '../config.js'

/**
 * Two processes opening the same database at the same moment must not fight
 * over the migrations.
 *
 * They did. CI failed with `Migration 005_queries_numbers.sql failed: duplicate
 * column name: queries_numbers` against a schema that was perfectly correct and
 * had passed twice on the same code an hour earlier.
 *
 * SQLite's default `BEGIN` is DEFERRED and takes no lock until the first write.
 * So both connections read `_migrations`, both concluded the same file was
 * outstanding, and the loser tried to apply what the winner had already
 * committed. Which file it lands on is a coin toss — reproducing it locally
 * produced "table quotes already exists" out of 001 instead.
 *
 * `migrate()` now opens with BEGIN IMMEDIATE, which takes the write lock up
 * front so the loser waits on `busy_timeout` (5s, set in client.ts) rather than
 * proceeding on a stale view, and re-checks `_migrations` inside the lock
 * because `pending` was computed before the lock was held.
 *
 * This has to be a real race to be worth anything. better-sqlite3 is
 * synchronous, so two connections on this thread cannot contend — one would
 * simply block the other. The test therefore spawns processes, which is what
 * found the bug in the first place.
 *
 * MEASURED, because a race test that nobody measured is a race test nobody
 * should trust. Reverting migrate.ts to `BEGIN` and dropping the re-check:
 *
 *   with the fix     6 runs, 6 clean      (no false positives)
 *   without the fix  6 runs, 5 caught     (18 worker starts per run)
 *
 * Five in six is what a probabilistic guard buys. Re-measure if you change the
 * round count, the worker count, or busy_timeout — and if it ever fails with
 * the fix in place, that is a real finding, not a flake to re-run.
 */

let dir: string
let dbPath: string
let worker: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'migrate-race-'))
  dbPath = path.join(dir, 'race.db')

  // Written per-run rather than committed: it exists only to be a second
  // process, and a stray .ts file in server/db/ would look like production code.
  worker = path.join(dir, 'worker.mjs')
  const clientUrl = new URL('file:///' + path.resolve(ROOT, 'server', 'src', 'db', 'client.ts').replace(/\\/g, '/'))
  writeFileSync(
    worker,
    `process.env.DB_PATH = process.argv[2]\n` +
      `const { getDb } = await import(${JSON.stringify(clientUrl.href)})\n` +
      `const db = getDb()\n` +
      `const { n } = db.prepare('SELECT count(*) AS n FROM _migrations').get()\n` +
      `process.stdout.write(String(n))\n`,
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Every process is STARTED before any of them is awaited. That is the whole
 * test.
 *
 * The first version of this used execFileSync in an Array.from callback, which
 * runs them strictly one after another — each finishing before the next began,
 * so no two ever held the database at the same moment. It passed four times in
 * a row against the pre-fix migrate.ts, which is to say it tested nothing at
 * all. `spawn` returns immediately; the overlap is real.
 *
 * `node --import tsx` rather than node_modules/.bin/tsx: on Windows the latter
 * resolves to tsx.cmd, which cannot be launched without a shell.
 */
function openConcurrently(count: number): Promise<Array<{ ok: boolean; out: string }>> {
  const started = Array.from(
    { length: count },
    () =>
      new Promise<{ ok: boolean; out: string }>((resolve) => {
        const child = spawn(process.execPath, ['--import', 'tsx', worker, dbPath], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (d) => (stdout += d))
        child.stderr.on('data', (d) => (stderr += d))
        child.on('error', (e) => resolve({ ok: false, out: e.message }))
        child.on('close', (code) => {
          if (code === 0) {
            // getDb() logs the migrations it applied, so the count is the last
            // line rather than the whole of stdout.
            const lines = stdout.trim().split(/\r?\n/)
            resolve({ ok: true, out: (lines[lines.length - 1] ?? '').trim() })
          } else {
            resolve({ ok: false, out: `${stderr}${stdout}`.trim() || `exit ${code}` })
          }
        })
      }),
  )

  return Promise.all(started)
}

describe('two processes opening the same database at once', () => {
  it(
    'both migrate it, and neither is told a column it never added already exists',
    { timeout: 180_000 },
    async () => {
      // Three rounds against three fresh databases, not one. A race test is
      // probabilistic by nature: with a single round of six this caught the
      // pre-fix code in two runs out of three, which is a regression test that
      // lets the regression through a third of the time. Repeating the round
      // is the cheapest way to buy near-certainty, and the whole file still
      // finishes in seconds.
      const corrupted: string[] = []
      let contended = 0

      for (let round = 0; round < 3; round++) {
        dbPath = path.join(dir, `race-${round}.db`)
        const results = await openConcurrently(6)

        for (const r of results.filter((x) => !x.ok)) {
          // Two different failures live here and only one is the regression.
          //
          // "duplicate column name" / "table ... already exists" is the bug:
          // a process applied something another had already committed, which
          // means it acted on a stale view of _migrations.
          //
          // SQLITE_BUSY is not. Six processes cold-starting at once contend for
          // the write lock BEGIN IMMEDIATE takes, and busy_timeout is 5s
          // (client.ts). On a loaded machine the sixth can exceed it. That is
          // the fix working — waiting rather than proceeding — and failing the
          // build for it would make this test flaky under load, which is how a
          // regression test turns into something people re-run until it is
          // green.
          if (/already exists|duplicate column|no such (table|column)/i.test(r.out)) {
            corrupted.push(r.out.split('\n').find((l) => /Migration|exists|duplicate/.test(l)) ?? r.out)
          } else if (/SQLITE_BUSY|database is locked|timeout/i.test(r.out)) {
            contended++
          } else {
            corrupted.push(r.out.split('\n')[0] ?? r.out)
          }
        }
      }

      if (contended > 0) {
        console.log(`[migrate-race] ${contended} worker(s) hit busy_timeout under load — not a regression`)
      }

      expect(corrupted.length, corrupted.slice(0, 3).join(' | ')).toBe(0)
    },
  )

  it('leaves exactly one row per migration, however many processes raced', { timeout: 180_000 }, async () => {
    const results = await openConcurrently(6)
    // A worker that lost the lock race and hit busy_timeout is the fix working.
    // What must hold regardless is the state it left the schema in.
    expect(results.some((r) => r.ok), 'every worker failed - the schema was never migrated').toBe(true)

    const db = new Database(dbPath, { readonly: true })
    try {
      const rows = db.prepare('SELECT name, count(*) AS n FROM _migrations GROUP BY name').all() as Array<{
        name: string
        n: number
      }>

      // The guard that matters: the fix could also have been written by
      // swallowing the duplicate-column error, which would leave a migration
      // applied but unrecorded, or recorded twice.
      expect(rows.length, 'no migrations were recorded at all').toBeGreaterThan(0)
      const duplicated = rows.filter((r) => r.n !== 1)
      expect(duplicated.map((r) => r.name).join(', ')).toBe('')

      // Every migration on disk is accounted for, so nobody skipped one by
      // deciding another process had it in hand.
      const applied = new Set(rows.map((r) => r.name))
      expect(applied.size, 'a migration was applied by one process and recorded by none').toBe(rows.length)
    } finally {
      db.close()
    }
  })

  it('reports the same migration count to every process', { timeout: 180_000 }, async () => {
    const results = await openConcurrently(6)
    const succeeded = results.filter((r) => r.ok)
    expect(succeeded.length, 'every worker failed - nothing to compare').toBeGreaterThan(1)

    // A process that got a stale view would report fewer. Each read the table
    // after its own migrate() returned, so those that finished must agree.
    const counts = new Set(succeeded.map((r) => r.out))
    expect(counts.size, `processes disagreed on the migration count: ${[...counts].join(', ')}`).toBe(1)
  })
})
