import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROOT } from '../config.js'

/**
 * Price memory reads the real tables, so these run against a real file with the
 * real migrations rather than a hand-built fixture — a column renamed in a
 * migration must break this test, not production.
 */
// Every migration there is, in order, rather than a list frozen at the moment
// this file was written. 003_warranty.sql went in and this kept passing only
// because it happens not to touch the term columns — the next migration that
// does would have failed here for a reason nobody could see from the diff.
const MIGRATIONS = path.resolve(ROOT, 'server', 'db', 'migrations')
const SCHEMA = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  .join('\n')

let dir: string
let db: Database.Database

vi.mock('../db/client.js', () => ({ getDb: () => db }))
const { findPastPrices } = await import('./priceHistory.js')

let clock = 0
function quote(customer: string, ref: string, items: Array<[string, string, number]>) {
  const id = randomUUID()
  clock += 1
  const stamp = `2026-08-${String(clock).padStart(2, '0')}T00:00:00.000Z`
  db.prepare(
    `INSERT INTO quotes (id, ref, revision, date, customer_name, tax_mode, tax_rate,
                         created_at, updated_at)
     VALUES (?, ?, 0, '2026-08-01', ?, 'IGST', 18, ?, ?)`,
  ).run(id, ref, customer, stamp, stamp)
  items.forEach(([desc, partCode, rate], i) => {
    db.prepare(
      `INSERT INTO quote_items (id, quote_id, line_no, description, part_code, qty, rate_paise, amount_paise)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(randomUUID(), id, i + 1, desc, partCode, rate, rate)
  })
  return id
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'price-'))
  db = new Database(path.join(dir, 'q.db'))
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  clock = 0
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('findPastPrices — by part code', () => {
  it('is an unambiguous hit and carries who and when', () => {
    quote('Morgan Stanley', 'NCS/2026-27/Quotes/RG/018', [
      ['Black i USB Type C Docking Station', 'BI-TCHUGP', 275_000],
    ])
    const [match] = findPastPrices({ desc: 'anything at all', partCode: 'bi-tchugp' })
    expect(match?.ratePaise).toBe(275_000)
    expect(match?.customerName).toBe('Morgan Stanley')
    expect(match?.ref).toBe('NCS/2026-27/Quotes/RG/018')
    expect(match?.via).toBe('part-code')
  })

  it('returns distinct prices newest first when a product moved', () => {
    quote('A', 'NCS/…/001', [['Dock', 'BI-TCHUGP', 250_000]])
    quote('B', 'NCS/…/002', [['Dock', 'BI-TCHUGP', 275_000]])
    const matches = findPastPrices({ desc: 'Dock', partCode: 'BI-TCHUGP' })
    expect(matches.map((m) => m.ratePaise)).toEqual([275_000, 250_000])
  })
})

describe('findPastPrices — by description', () => {
  it('finds the same product worded slightly differently', () => {
    quote('Morgan Stanley', 'NCS/…/018', [['Logitech Wireless Keyboard and Mouse Set #MK540', '', 345_000]])
    const [match] = findPastPrices({ desc: 'Logitech Wireless Keyboard and Mouse #MK540' })
    expect(match?.ratePaise).toBe(345_000)
    expect(match?.via).toBe('description')
  })

  it('does not offer a USB-A price for a USB-C cable', () => {
    // The whole reason this reuses the ask-vs-quote matcher rather than LIKE.
    quote('A', 'NCS/…/001', [['Black i USB-C to USB-A 1.5 mtr', '', 55_000]])
    const matches = findPastPrices({ desc: 'Black i USB-C to USB-C 1.5 mtr' })
    expect(matches.map((m) => m.ratePaise)).not.toContain(55_000)
  })

  it('does not offer a 1 mtr price for a 1.5 mtr cable', () => {
    quote('A', 'NCS/…/001', [['Black i USB-C to USB-C 1 mtr', '', 70_000]])
    const matches = findPastPrices({ desc: 'Black i USB-C to USB-C 1.5 mtr' })
    expect(matches.map((m) => m.ratePaise)).not.toContain(70_000)
  })

  it('returns nothing for a product never quoted', () => {
    quote('A', 'NCS/…/001', [['Logitech Keyboard', '', 345_000]])
    expect(findPastPrices({ desc: 'Dell 24 inch monitor' })).toEqual([])
  })

  it('ignores lines that were never priced', () => {
    quote('A', 'NCS/…/001', [['Logitech Keyboard', '', 0]])
    expect(findPastPrices({ desc: 'Logitech Keyboard' })).toEqual([])
  })
})

describe('findPastPrices — revising', () => {
  it('excludes the quotation being revised from its own history', () => {
    const id = quote('A', 'NCS/…/001', [['Dock', 'BI-TCHUGP', 275_000]])
    expect(findPastPrices({ desc: 'Dock', partCode: 'BI-TCHUGP' })).toHaveLength(1)
    expect(
      findPastPrices({ desc: 'Dock', partCode: 'BI-TCHUGP', excludeQuoteId: id }),
    ).toHaveLength(0)
  })
})

describe('the identity test, not the pairing test', () => {
  it('offers a price when the brand was left out of the wording', () => {
    // Same cable, described more briefly. This must still match, or price
    // memory is useless on real descriptions.
    quote('A', 'NCS/…/001', [['Black i Lightning to USB A 1.5 mtr', '', 125_000]])
    const [match] = findPastPrices({ desc: 'Lightning to USB A 1.5 mtr' })
    expect(match?.ratePaise).toBe(125_000)
  })

  it('does not offer one manufacturer’s price for another’s', () => {
    // Shares the variant marker "1tb" but is a different product.
    quote('A', 'NCS/…/001', [['HP 1TB SSD', '', 500_000]])
    expect(findPastPrices({ desc: 'Dell 1TB SSD' })).toEqual([])
  })

  it('does not cross makes even when the wording is close', () => {
    quote('A', 'NCS/…/001', [['Wireless Keyboard and Mouse', '', 345_000]])
    db.prepare('UPDATE quote_items SET make = ?').run('Logitech')
    expect(findPastPrices({ desc: 'Wireless Keyboard and Mouse', make: 'Dell' })).toEqual([])
    expect(
      findPastPrices({ desc: 'Wireless Keyboard and Mouse', make: 'Logitech' }),
    ).toHaveLength(1)
  })

  it('still matches when only one side records a make', () => {
    quote('A', 'NCS/…/001', [['Wireless Keyboard and Mouse', '', 345_000]])
    expect(findPastPrices({ desc: 'Wireless Keyboard and Mouse', make: 'Logitech' })).toHaveLength(1)
  })

  it('a part code still wins outright, whatever the wording', () => {
    quote('A', 'NCS/…/001', [['Dock BI-TCHUGP', 'BI-TCHUGP', 275_000]])
    const [match] = findPastPrices({ desc: 'completely different words', partCode: 'BI-TCHUGP' })
    expect(match?.ratePaise).toBe(275_000)
  })
})
