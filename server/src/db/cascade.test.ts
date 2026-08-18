import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from '../config.js'

/**
 * Deleting a quotation has to take its line items with it.
 *
 * That relies on `PRAGMA foreign_keys = ON`. SQLite's own default is OFF, but
 * better-sqlite3 overrides it and turns it on per connection — so the explicit
 * pragma in db/client.ts is belt-and-braces rather than load-bearing. It stays
 * because it is one line, it survives a driver change, and it says out loud
 * what the schema depends on.
 *
 * The failure it guards against is a quiet one: with foreign keys off, the
 * delete still succeeds and `ON DELETE CASCADE` becomes decorative, so every
 * deleted quotation strands its rows in quote_items forever. Nothing visible
 * breaks, which is exactly why it needs a test.
 */

const SCHEMA = readFileSync(
  path.resolve(ROOT, 'server', 'db', 'migrations', '001_init.sql'),
  'utf8',
)

function seed(db: Database.Database) {
  db.exec(SCHEMA)

  const insertQuote = db.prepare(
    `INSERT INTO quotes (id, ref, revision, date, customer_name, tax_mode, tax_rate, created_at, updated_at)
     VALUES (?, ?, ?, '2026-07-10', 'Morgan Stanley', 'IGST', 18, '', '')`,
  )
  const insertItem = db.prepare(
    `INSERT INTO quote_items (id, quote_id, line_no, description, qty, rate_paise, amount_paise)
     VALUES (?, ?, ?, 'Cable', 2, 55000, 110000)`,
  )

  insertQuote.run('q1', 'NCS/2026-27/Quotes/RG/006', 0)
  insertQuote.run('q2', 'NCS/2026-27/Quotes/RG/006', 1) // a revision, same ref
  insertItem.run('i1', 'q1', 1)
  insertItem.run('i2', 'q1', 2)
  insertItem.run('i3', 'q2', 1)
}

const itemsFor = (db: Database.Database, quoteId: string) =>
  (db.prepare('SELECT count(*) AS n FROM quote_items WHERE quote_id = ?').get(quoteId) as {
    n: number
  }).n

describe('deleting a quotation', () => {
  it('takes its line items with it', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    seed(db)

    expect(itemsFor(db, 'q1')).toBe(2)
    db.prepare('DELETE FROM quotes WHERE id = ?').run('q1')
    expect(itemsFor(db, 'q1')).toBe(0)

    db.close()
  })

  it('leaves the other revisions of the same reference alone', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    seed(db)

    db.prepare('DELETE FROM quotes WHERE id = ?').run('q1')

    const survivors = db
      .prepare('SELECT id, revision FROM quotes WHERE ref = ?')
      .all('NCS/2026-27/Quotes/RG/006') as Array<{ id: string; revision: number }>

    expect(survivors).toEqual([{ id: 'q2', revision: 1 }])
    expect(itemsFor(db, 'q2')).toBe(1)

    db.close()
  })

  it('gets foreign keys from the driver by default, not from our pragma', () => {
    // Worth pinning: SQLite defaults this OFF, better-sqlite3 defaults it ON.
    // If that ever changes, the explicit pragma in client.ts is what saves the
    // cascade, and this test says so rather than leaving it to be discovered.
    const db = new Database(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('strands the line items if foreign keys are ever turned off', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = OFF')
    seed(db)

    db.prepare('DELETE FROM quotes WHERE id = ?').run('q1')

    // The delete "succeeds" and the items survive with no parent. This is the
    // damage the first test exists to catch.
    expect(itemsFor(db, 'q1')).toBe(2)

    db.close()
  })

  it('does not release the reference number', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    seed(db)

    db.prepare('INSERT INTO ref_counters (fy, initials, last_seq) VALUES (?, ?, ?)').run(
      '2026-27', 'RG', 6,
    )
    db.prepare('DELETE FROM quotes WHERE id = ?').run('q1')

    const counter = db
      .prepare('SELECT last_seq FROM ref_counters WHERE fy = ? AND initials = ?')
      .get('2026-27', 'RG') as { last_seq: number }

    // Still 6, so the next allocation is 007. Reusing 006 would let two
    // different customers hold quotations with the same reference.
    expect(counter.last_seq).toBe(6)

    db.close()
  })
})
