import Database from 'better-sqlite3'
import express from 'express'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrate } from '../db/migrate.js'

/**
 * "Do not complete a quotation unless the company is selected."
 *
 * The rule lives on the SERVER, which is the whole point of this file. The
 * editor greys out its Save button and shows a chooser, and both of those are
 * suggestions: the request is what writes a row. So every case here goes over
 * real HTTP against a real database, and the ones that are refused are checked
 * to have written nothing.
 *
 * What makes it necessary is the desk's Tally list. Three Azentio ledgers below
 * share a name and a GSTIN and differ only by address; the real list also holds
 * sixteen spellings of Datamatics and seventeen of Morgan Stanley, with
 * different GSTINs and different ship-to states — and the ship-to state decides
 * whether the document carries IGST or a CGST/SGST pair. A quotation that names
 * the company without saying which ledger has not recorded who it was for, and
 * nothing downstream can recover it afterwards.
 */
let db: Database.Database
vi.mock('../db/client.js', () => ({ getDb: () => db }))
const { quoteRoutes } = await import('./quote.js')

let dir: string
let server: Server
let origin: string

const LEDGERS = [
  ['malad', 'AZENTIO SOFTWARE PVT LTD (MALAD)', 'Sej Plaza, Malad West', '27AAUCA4876F1Z4', 'Maharashtra'],
  ['vashi', 'AZENTIO SOFTWARE PVT LTD (Vashi)', 'Infotech Park, Vashi', '27AAUCA4876F1Z4', 'Maharashtra'],
  ['hyd', 'AZENTIO SOFTWARE PVT LTD (HYD)', 'Gachibowli, Hyderabad', '36AAUCA4876F1Z5', 'Telangana'],
] as const

const DRAFT = {
  date: '2026-08-18',
  initials: 'ZZ',
  customer: {
    name: 'Azentio Software Pvt Ltd',
    address: 'Somewhere',
    attention: 'Ms. Priya Nair',
    state: 'Maharashtra',
  },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  items: [{ desc: 'HP 280 G9 MT', make: 'HP', partCode: '', qty: 1, rate: 8_300_000 }],
  tax: { mode: 'CGST+SGST', rate: 18 },
  terms: {
    payment: '100% Advance',
    delivery: '1-2 Weeks after PO',
    prices: 'All-inclusive as per this quotation',
    validity: '31st August 2026.',
    warranty: '',
  },
  sourceThread: '',
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'quote-customer-'))
  db = new Database(path.join(dir, 'q.db'))
  db.pragma('foreign_keys = ON')
  migrate(db)

  const insert = db.prepare(
    `INSERT INTO customers
       (id, name, address, attention, gstin, state, contact, email,
        ledger_key, source, country, reg_type, imported_at,
        quote_count, last_used_at, created_at)
     VALUES (?, ?, ?, '', ?, ?, '', '', ?, 'tally', 'India', 'Regular',
             '2026-01-01', 0, '2026-01-01', '2026-01-01')`,
  )
  for (const [id, name, address, gstin, state] of LEDGERS) {
    insert.run(id, name, address, gstin, state, name.trim().toLowerCase())
  }

  const app = express()
  app.use(express.json())
  app.use('/api', quoteRoutes)
  app.use((err: Error, _req: express.Request, res: express.Response, _n: express.NextFunction) => {
    res.status(500).json({ error: err.message })
  })
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

async function save(body: Record<string, unknown>) {
  const response = await fetch(origin + '/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...DRAFT, ...body }),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

const rows = () =>
  (db.prepare('SELECT count(*) AS n FROM quotes').get() as { n: number }).n

describe('a quotation whose customer could be several ledgers', () => {
  it('is refused, and writes nothing', async () => {
    const before = rows()
    const { status } = await save({})

    expect(status).toBe(409)
    expect(rows()).toBe(before)
  })

  it('names the ledgers rather than saying "please select a customer"', async () => {
    const { body } = await save({})

    expect(String(body.error)).toContain('MALAD')
    expect(String(body.error)).toContain('Vashi')
    // ...and says why it matters. Two of these share a GSTIN and the third
    // ships to a different state.
    expect(String(body.error)).toMatch(/GSTIN/)
    expect(Array.isArray(body.customerCandidates)).toBe(true)
    expect(body.customerCandidates).toHaveLength(3)
  })

  it('sends a chooser with the refusal, not only a sentence naming the ledgers', async () => {
    /**
     * The dead end this closes is an ordinary one: every quotation saved before
     * 004 has no ledger recorded, so opening one and revising it reaches the
     * save with nothing read and nothing to choose from. The refusal carries
     * what the read path would have carried, so it is one click rather than a
     * retyped name.
     */
    const { body } = await save({})
    const offered = body.customerCandidates as Array<Record<string, unknown>>

    for (const candidate of offered) {
      // Enough for the chooser to draw a row...
      expect(candidate.record).toBeTruthy()
      expect(typeof candidate.gstinMatch).toBe('boolean')
      // ...and enough to fill the draft the moment one is clicked.
      expect(candidate.customer).toBeTruthy()
    }

    const malad = offered.find(
      (c) => (c.record as { id: string }).id === 'malad',
    )!.customer as Record<string, string>
    expect(malad.address).toBe('Sej Plaza, Malad West')
    expect(malad.gstin).toBe('27AAUCA4876F1Z4')
    // The draft's own Kind attention survives being merged with a ledger,
    // exactly as the thread's does on the read path.
    expect(malad.attention).toBe('Ms. Priya Nair')
  })

  it('is accepted once a ledger is named, and records which one', async () => {
    const { status, body } = await save({ initials: 'ZA', customerId: 'vashi' })

    expect(status).toBe(201)
    expect(body.customerId).toBe('vashi')
    const stored = db
      .prepare('SELECT customer_id FROM quotes WHERE id = ?')
      .get(body.id as string) as { customer_id: string }
    expect(stored.customer_id).toBe('vashi')
  })

  it('is accepted when the desk says the company is not on the list at all', async () => {
    // Quoting before Tally has the customer is ordinary. It has to be
    // deliberate, though — the flag is the desk answering, not avoiding.
    const { status, body } = await save({ initials: 'ZB', customerOffList: true })

    expect(status).toBe(201)
    expect(body.customerId).toBeNull()
  })

  it('refuses a ledger id that is not on the list', async () => {
    // Far more likely a stale browser than anything sinister, but it must not
    // be written as a fact.
    const { status, body } = await save({ initials: 'ZC', customerId: 'no-such-ledger' })

    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/no longer on your customer list/)
  })
})

describe('a customer name that identifies one ledger on its own', () => {
  it('is accepted without a chooser, because Tally ledger names are unique', () => {
    // The exact name of one row IS a selection. Without this the desk would be
    // blocked by their own previous quotation every time they typed a name
    // instead of picking it from the list.
    return save({
      initials: 'ZD',
      customer: { ...DRAFT.customer, name: 'AZENTIO SOFTWARE PVT LTD (Vashi)' },
    }).then(({ status, body }) => {
      expect(status).toBe(201)
      // ...and the ledger is resolved server-side, so the record still says who.
      expect(body.customerId).toBe('vashi')
    })
  })

  it('matches it however it was capitalised', async () => {
    const { status, body } = await save({
      initials: 'ZE',
      customer: { ...DRAFT.customer, name: 'azentio software pvt ltd (vashi)' },
    })

    expect(status).toBe(201)
    expect(body.customerId).toBe('vashi')
  })
})

describe('a customer nothing on the list could be', () => {
  it('saves exactly as it always did, and is remembered', async () => {
    const { status, body } = await save({
      initials: 'ZF',
      customer: { ...DRAFT.customer, name: 'Kirloskar Brothers Limited' },
    })

    expect(status).toBe(201)
    expect(body.customerId).toBeNull()

    const remembered = db
      .prepare('SELECT source FROM customers WHERE lower(name) = lower(?)')
      .get('Kirloskar Brothers Limited') as { source: string }
    expect(remembered.source).toBe('quote')
  })

  it('can then be quoted again by name, now that it is on the list', async () => {
    // The regression this guards: the first save puts the name on the list, and
    // a rule that only checked "does anything match?" would refuse the second
    // quotation to the desk's own new customer.
    const { status } = await save({
      initials: 'ZG',
      customer: { ...DRAFT.customer, name: 'Kirloskar Brothers Limited' },
    })
    expect(status).toBe(201)
  })
})
