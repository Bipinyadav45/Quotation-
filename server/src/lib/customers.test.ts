import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT } from '../config.js'
import { rememberCustomer } from './customers.js'

/**
 * The master fills itself from saves, so the rules that matter are about what a
 * later quotation is allowed to do to what an earlier one recorded.
 *
 * 004 changed the answer to "which row is this?" and these tests changed with
 * it. Identity used to be the name, under a UNIQUE index; against the desk's
 * real Tally list that is wrong in a way that puts one company's GSTIN on
 * another company's quotation, because sixteen ledgers are spelled some
 * version of "Datamatics Global Services Limited" and three Azentio sites share
 * a name AND a registration. Identity is the row's id now, and a save that
 * chose a ledger passes it.
 */
const SCHEMA = ['001_init.sql', '002_customers.sql', '003_warranty.sql', '004_customer_identity.sql']
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

const count = (d: Database.Database) =>
  (d.prepare('SELECT count(*) AS n FROM customers').get() as { n: number }).n

describe('rememberCustomer', () => {
  it('records a customer the first time one is quoted', () => {
    const d = db()
    rememberCustomer(d, { name: 'Morgan Stanley', gstin: '27AABCU9603R1ZM', state: 'Karnataka' })
    const row = read(d, 'Morgan Stanley')!
    expect(row.gstin).toBe('27AABCU9603R1ZM')
    expect(row.quote_count).toBe(1)
    // Learned from a save, not imported — so a debtors import will not treat it
    // as a ledger it owns and overwrite it.
    expect(row.source).toBe('quote')
  })

  it('counts quotations rather than creating a second row', () => {
    const d = db()
    rememberCustomer(d, { name: 'Morgan Stanley' })
    rememberCustomer(d, { name: 'morgan stanley' })
    rememberCustomer(d, { name: 'MORGAN STANLEY' })
    expect(count(d)).toBe(1)
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
    expect(count(d)).toBe(1)
    expect(read(d, 'Datamatics Global')!.name).toBe('Datamatics Global')
  })

  it('treats a differently-worded name as a different customer', () => {
    // "Ltd" and "Limited" are two rows, deliberately. Merging on similarity
    // would eventually merge two real companies that share a word, and a
    // quotation addressed to the wrong company is worse than a duplicate row.
    const d = db()
    rememberCustomer(d, { name: 'Datamatics Global Services Ltd' })
    rememberCustomer(d, { name: 'Datamatics Global Services Limited' })
    expect(count(d)).toBe(2)
  })

  it('ignores a quotation saved with no customer name', () => {
    const d = db()
    rememberCustomer(d, { name: '   ' })
    expect(count(d)).toBe(0)
  })
})

describe('rememberCustomer against a chosen ledger', () => {
  /** Three sites of one company, sharing a registration. The real list has these. */
  function withAzentio(d: Database.Database) {
    const insert = d.prepare(
      `INSERT INTO customers
         (id, name, address, attention, gstin, state, contact, email,
          ledger_key, source, country, reg_type, imported_at,
          quote_count, last_used_at, created_at)
       VALUES (?, ?, ?, '', '27AAUCA4876F1Z4', 'Maharashtra', '', '',
               ?, 'tally', 'India', 'Regular', '2026-01-01', 0, '2026-01-01', '2026-01-01')`,
    )
    insert.run('malad', 'AZENTIO SOFTWARE PVT LTD (MALAD)', 'Sej Plaza, Malad West', 'azentio software pvt ltd (malad)')
    insert.run('vashi', 'AZENTIO SOFTWARE PVT LTD (Vashi)', 'Infotech Park, Vashi', 'azentio software pvt ltd (vashi)')
    return d
  }

  it('updates the ledger that was chosen, not one that matches by name', () => {
    const d = withAzentio(db())
    rememberCustomer(d, { id: 'vashi', name: 'AZENTIO SOFTWARE PVT LTD (Vashi)', attention: 'Ms. Priya Nair' })

    expect((d.prepare('SELECT attention FROM customers WHERE id = ?').get('vashi') as { attention: string }).attention).toBe('Ms. Priya Nair')
    expect((d.prepare('SELECT attention FROM customers WHERE id = ?').get('malad') as { attention: string }).attention).toBe('')
    expect(count(d)).toBe(2)
  })

  it('does not fork a new row when the name on a chosen ledger is corrected', () => {
    // The whole reason the id travels with the quotation. Fixing a spelling on
    // a document must not create a second ledger for the same company — and
    // under the old name-keyed write, it did exactly that.
    const d = withAzentio(db())
    rememberCustomer(d, { id: 'malad', name: 'Azentio Software Pvt Ltd (Malad West)' })

    expect(count(d)).toBe(2)
    expect((d.prepare('SELECT name FROM customers WHERE id = ?').get('malad') as { name: string }).name).toBe('Azentio Software Pvt Ltd (Malad West)')
  })

  it('leaves an imported ledger its import key, so a re-import still matches it', () => {
    // ledger_key follows the name for a row the master taught itself, and must
    // NOT for one that came from Tally: that key is what the next export
    // matches on, and moving it would insert a duplicate rather than update.
    const d = withAzentio(db())
    rememberCustomer(d, { id: 'malad', name: 'Azentio Software Pvt Ltd (Malad West)' })

    expect((d.prepare('SELECT ledger_key FROM customers WHERE id = ?').get('malad') as { ledger_key: string }).ledger_key).toBe('azentio software pvt ltd (malad)')
  })

  it('renames an off-list customer in place, key and all', () => {
    const d = db()
    rememberCustomer(d, { name: 'Zensar' })
    const id = (d.prepare('SELECT id FROM customers').get() as { id: string }).id
    rememberCustomer(d, { id, name: 'Zensar Technologies' })

    expect(count(d)).toBe(1)
    const row = d.prepare('SELECT name, ledger_key FROM customers').get() as Record<string, string>
    expect(row.name).toBe('Zensar Technologies')
    expect(row.ledger_key).toBe('zensar technologies')
  })
})

describe('the name is no longer an identity', () => {
  it('lets two ledgers share a GSTIN, which the real list requires', () => {
    // 002 put a UNIQUE index on lower(name); this is what it would have blocked
    // if the list had been imported under it. Thirty-nine GSTINs on the desk's
    // list are held by more than one ledger.
    const d = withTwo(db())
    expect(count(d)).toBe(2)
  })

  function withTwo(d: Database.Database) {
    const insert = d.prepare(
      `INSERT INTO customers
         (id, name, address, attention, gstin, state, contact, email,
          ledger_key, source, country, reg_type, imported_at,
          quote_count, last_used_at, created_at)
       VALUES (?, ?, ?, '', '27AAUCA4876F1Z4', 'Maharashtra', '', '',
               ?, 'tally', 'India', 'Regular', '2026-01-01', 0, '2026-01-01', '2026-01-01')`,
    )
    insert.run('a', 'AZENTIO SOFTWARE PVT LTD (MALAD)', 'Sej Plaza', 'azentio software pvt ltd (malad)')
    insert.run('b', 'AZENTIO SOFTWARE PVT LTD (Vashi)', 'Infotech Park', 'azentio software pvt ltd (vashi)')
    return d
  }
})
