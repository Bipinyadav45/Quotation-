import Database from 'better-sqlite3'
import express from 'express'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Quote } from '@shared/schema.js'
import { migrate } from '../db/migrate.js'

/**
 * The desk choosing its own reference number.
 *
 * "If the current document is 042 and I edited and change the doc to 045, then
 * the next doc which I create should start from 046."
 *
 * refno.test.ts proves claimRef moves the counter and never rewinds it. This
 * file is about the route around it: that the chosen number reaches the stored
 * row, that a revision ignores it, that a number already taken comes back as a
 * sentence rather than a SQLite error, and that the refusal leaves nothing
 * behind.
 *
 * Real file, real migrations, real HTTP, for the reason the warranty test uses
 * them — the unique index that makes the duplicate case exist at all lives in
 * 001_init.sql, and a hand-built fixture that forgot it would pass this file
 * while the desk still got a 500.
 *
 * Every case uses its own initials. The series are per salesperson (§7), so no
 * case can be made to pass or fail by the order the others ran in.
 */
let db: Database.Database
vi.mock('../db/client.js', () => ({ getDb: () => db }))
const { quoteRoutes } = await import('./quote.js')

let dir: string
let server: Server
let origin: string

const BODY = {
  date: '2026-08-18', // FY 2026-27
  initials: 'RG',
  customer: { name: 'Morgan Stanley', address: 'Powai, Mumbai', attention: 'Mr. Subhransu Kar.' },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  items: [
    { desc: '1.6 TB SAS 12G Drive (Refurbished)', make: '', partCode: '', qty: 1, rate: 2_000_000 },
  ],
  tax: { mode: 'IGST', rate: 18 },
  terms: {
    payment: '100% Advance',
    delivery: '1-2 Weeks after PO',
    prices: 'All-inclusive as per this proforma invoice',
    validity: '31st August 2026.',
    warranty: '',
  },
  sourceThread: '',
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'quote-ref-'))
  db = new Database(path.join(dir, 'q.db'))
  db.pragma('foreign_keys = ON')
  migrate(db)

  const app = express()
  app.use(express.json())
  app.use('/api', quoteRoutes)
  // The 500 handler index.ts installs. Without it here a failure that is NOT a
  // clash would hang the request instead of being visible as a status.
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

type SaveResult = { status: number; body: Quote & { error?: string; ref?: string } }

async function save(patch: Record<string, unknown> = {}): Promise<SaveResult> {
  const response = await fetch(origin + '/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...BODY, ...patch }),
  })
  return { status: response.status, body: (await response.json()) as SaveResult['body'] }
}

/** What was stored, not what the response echoed back out of the request. */
const storedRef = (id: string) =>
  db.prepare('SELECT ref, revision FROM quotes WHERE id = ?').get(id) as
    | { ref: string; revision: number }
    | undefined

const counter = (initials: string) =>
  (
    db
      .prepare('SELECT last_seq FROM ref_counters WHERE fy = ? AND initials = ?')
      .get('2026-27', initials) as { last_seq: number } | undefined
  )?.last_seq ?? 0

const countOf = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

/** The preview the editor shows, through the route that serves it. */
async function peek(initials: string): Promise<number> {
  const response = await fetch(`${origin}/api/next-ref?initials=${initials}&date=2026-08-18`)
  return ((await response.json()) as { nextSeq: number }).nextSeq
}

describe('a reference number the desk chose', () => {
  it('is used as typed, and the next save carries on from it', async () => {
    const chosen = await save({ initials: 'AA', seqOverride: 45 })

    expect(chosen.status).toBe(201)
    expect(chosen.body.ref).toBe('NCS/2026-27/Quotes/AA/045')
    expect(storedRef(chosen.body.id)).toEqual({ ref: 'NCS/2026-27/Quotes/AA/045', revision: 0 })

    // The whole ask: 045 was typed, so the next one is 046.
    expect(await peek('AA')).toBe(46)

    const next = await save({ initials: 'AA' })
    expect(next.body.ref).toBe('NCS/2026-27/Quotes/AA/046')
    expect(storedRef(next.body.id)?.ref).toBe('NCS/2026-27/Quotes/AA/046')
  })

  it('below the counter fills the gap without rewinding the series', async () => {
    await save({ initials: 'BB', seqOverride: 45 })
    expect(counter('BB')).toBe(45)

    const gap = await save({ initials: 'BB', seqOverride: 10 })
    expect(gap.status).toBe(201)
    expect(gap.body.ref).toBe('NCS/2026-27/Quotes/BB/010')

    // 010 was used and the counter stayed at 45. Had it followed the typed
    // number down, this next save would re-issue 011 to a second customer.
    expect(counter('BB')).toBe(45)
    expect(await peek('BB')).toBe(46)
    expect((await save({ initials: 'BB' })).body.ref).toBe('NCS/2026-27/Quotes/BB/046')
  })

  it('is refused by name when it is already in use, and writes nothing', async () => {
    expect((await save({ initials: 'CC', seqOverride: 7 })).status).toBe(201)

    const before = {
      quotes: countOf('quotes'),
      items: countOf('quote_items'),
      customers: countOf('customers'),
      counter: counter('CC'),
    }

    const clash = await save({
      initials: 'CC',
      seqOverride: 7,
      // A customer nobody has quoted before and two lines rather than one, so
      // the rollback has something of its own to leave behind if it leaks.
      customer: { name: 'Never Saved Ltd', address: 'Nowhere', attention: 'Nobody' },
      items: [
        { desc: 'Line one', make: '', partCode: '', qty: 1, rate: 100_000 },
        { desc: 'Line two', make: '', partCode: '', qty: 2, rate: 250_000 },
      ],
    })

    expect(clash.status).toBe(409)
    expect(clash.body.error).toContain('NCS/2026-27/Quotes/CC/007')
    expect(clash.body.error).toMatch(/already in use/i)
    // Which number is taken, not which index objected.
    expect(clash.body.error).not.toMatch(/constraint|sqlite/i)
    expect(clash.body.ref).toBe('NCS/2026-27/Quotes/CC/007')

    // Half a quotation is worse than none. The row, its lines, the customer it
    // would have taught us, and the counter roll back together.
    expect(countOf('quotes')).toBe(before.quotes)
    expect(countOf('quote_items')).toBe(before.items)
    expect(countOf('customers')).toBe(before.customers)
    expect(counter('CC')).toBe(before.counter)
    expect(
      db.prepare('SELECT id FROM customers WHERE name = ?').get('Never Saved Ltd'),
    ).toBeUndefined()

    // And the series is still usable afterwards.
    expect((await save({ initials: 'CC' })).body.ref).toBe('NCS/2026-27/Quotes/CC/008')
  })

  it('is ignored by a revision, which keeps its parent reference', async () => {
    const original = await save({ initials: 'DD' })
    expect(original.body.ref).toBe('NCS/2026-27/Quotes/DD/001')

    const revised = await save({ initials: 'DD', reviseOf: original.body.id, seqOverride: 900 })

    expect(revised.status).toBe(201)
    expect(revised.body.ref).toBe('NCS/2026-27/Quotes/DD/001')
    expect(revised.body.revision).toBe(1)
    expect(storedRef(revised.body.id)).toEqual({ ref: 'NCS/2026-27/Quotes/DD/001', revision: 1 })

    // 900 must not have leaked into the counter on the way past.
    expect(counter('DD')).toBe(1)
    expect((await save({ initials: 'DD' })).body.ref).toBe('NCS/2026-27/Quotes/DD/002')
  })
})

describe('omitting it — every caller that exists today', () => {
  it('allocates the next number in the series, exactly as before', async () => {
    expect((await save({ initials: 'EE' })).body.ref).toBe('NCS/2026-27/Quotes/EE/001')
    expect((await save({ initials: 'EE' })).body.ref).toBe('NCS/2026-27/Quotes/EE/002')
    expect((await save({ initials: 'EE' })).body.ref).toBe('NCS/2026-27/Quotes/EE/003')
    expect(counter('EE')).toBe(3)
  })

  it('still burns no number on a page that is only previewed', async () => {
    expect(await peek('FF')).toBe(1)
    expect(await peek('FF')).toBe(1)
    expect(counter('FF')).toBe(0)
  })

  it('sending it as undefined is the same as leaving it out', async () => {
    // JSON.stringify drops an undefined, which is what a screen with an empty
    // box sends — it must not be read as "choose 0" or refused as malformed.
    const saved = await save({ initials: 'GG', seqOverride: undefined })
    expect(saved.status).toBe(201)
    expect(saved.body.ref).toBe('NCS/2026-27/Quotes/GG/001')
  })
})

describe('a value that is not a reference number', () => {
  // Caught by the schema, so it never reaches the counter or the table at all.
  it.each([0, -3, 4.5, 'forty-five', null])(
    'is refused before anything is written: %p',
    async (bad) => {
      const quotesBefore = countOf('quotes')

      const refused = await save({ initials: 'HH', seqOverride: bad })

      expect(refused.status).toBe(400)
      expect(counter('HH')).toBe(0)
      expect(countOf('quotes')).toBe(quotesBefore)
    },
  )
})
