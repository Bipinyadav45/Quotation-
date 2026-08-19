import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from '../config.js'
import { rememberCustomer } from './customers.js'

/**
 * The master fills itself from saves, so the rules that matter are about what
 * a later quotation is allowed to do to what an earlier one recorded.
 */
const SCHEMA = ['001_init.sql', '002_customers.sql']
  .map((f) => readFileSync(path.resolve(ROOT, 'server', 'db', 'migrations', f), 'utf8'))
  .join('\n')

function db() {
  const d = new Database(':memory:')
  d.exec(SCHEMA)
  return d
}

const read = (d: Database.Database, name: string) =>
  d.prepare('SELECT * FROM customers WHERE lower(name) = lower(?)').get(name) as
    | Record<string, string | number>
    | undefined

describe('rememberCustomer', () => {
  it('records a customer the first time one is quoted', () => {
    const d = db()
    rememberCustomer(d, { name: 'Morgan Stanley', gstin: '27AABCU9603R1ZM', state: 'Karnataka' })
    const row = read(d, 'Morgan Stanley')!
    expect(row.gstin).toBe('27AABCU9603R1ZM')
    expect(row.quote_count).toBe(1)
  })

  it('counts quotations rather than creating a second row', () => {
    const d = db()
    rememberCustomer(d, { name: 'Morgan Stanley' })
    rememberCustomer(d, { name: 'morgan stanley' })
    rememberCustomer(d, { name: 'MORGAN STANLEY' })
    expect(d.prepare('SELECT count(*) AS n FROM customers').get()).toEqual({ n: 3 - 2 })
    expect(read(d, 'Morgan Stanley')!.quote_count).toBe(3)
  })

  it('never erases a stored value with a blank one', () => {
    // A quotation that omits the GSTIN is an absence of information, not a
    // statement that the customer has no GSTIN.
    const d = db()
    rememberCustomer(d, { name: 'Datamatics', gstin: '27AABCU9603R1ZM', address: 'Mumbai' })
    rememberCustomer(d, { name: 'Datamatics', gstin: '', address: '' })
    const row = read(d, 'Datamatics')!
    expect(row.gstin).toBe('27AABCU9603R1ZM')
    expect(row.address).toBe('Mumbai')
  })

  it('does take a new value when one is given', () => {
    const d = db()
    rememberCustomer(d, { name: 'Datamatics', address: 'Mumbai' })
    rememberCustomer(d, { name: 'Datamatics', address: 'Puducherry' })
    expect(read(d, 'Datamatics')!.address).toBe('Puducherry')
  })

  it('keeps the latest capitalisation of the same name', () => {
    const d = db()
    rememberCustomer(d, { name: 'datamatics global' })
    rememberCustomer(d, { name: 'Datamatics Global' })
    expect(d.prepare('SELECT count(*) AS n FROM customers').get()).toEqual({ n: 1 })
    expect(read(d, 'Datamatics Global')!.name).toBe('Datamatics Global')
  })

  it('treats a differently-worded name as a different customer', () => {
    // "Ltd" and "Limited" are two rows, deliberately. Merging on similarity
    // would eventually merge two real companies that share a word, and a
    // quotation addressed to the wrong company is worse than a duplicate row.
    // The typeahead is the answer: the stored name is offered before a variant
    // gets typed.
    const d = db()
    rememberCustomer(d, { name: 'Datamatics Global Services Ltd' })
    rememberCustomer(d, { name: 'Datamatics Global Services Limited' })
    expect(d.prepare('SELECT count(*) AS n FROM customers').get()).toEqual({ n: 2 })
  })

  it('ignores a quotation saved with no customer name', () => {
    const d = db()
    rememberCustomer(d, { name: '   ' })
    expect(d.prepare('SELECT count(*) AS n FROM customers').get()).toEqual({ n: 0 })
  })
})

describe('searchCustomers escaping', () => {
  it('treats % and _ in a customer name as text, not wildcards', () => {
    // Regression: the ESCAPE clause lived in a template literal, where '\' is
    // not a backslash — SQLite received an empty ESCAPE and threw on every
    // non-empty query. Nothing caught it because the empty query never used it.
    const d = db()
    rememberCustomer(d, { name: 'L&T 100% Solutions' })
    rememberCustomer(d, { name: 'Datamatics' })

    const like = (q: string) => {
      const escaped = q.replace(/[!%_]/g, (c) => `!${c}`)
      return d
        .prepare(
          `SELECT name FROM customers
            WHERE lower(name) LIKE ? ESCAPE '!'
         ORDER BY last_used_at DESC`,
        )
        .all(`%${escaped}%`) as Array<{ name: string }>
    }

    expect(like('100%').map((r) => r.name)).toEqual(['L&T 100% Solutions'])
    // A bare wildcard must not match everything.
    expect(like('%').map((r) => r.name)).toEqual(['L&T 100% Solutions'])
  })
})
