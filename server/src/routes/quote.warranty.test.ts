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
 * The warranty is term 5, and term 5 has to survive the save.
 *
 * This runs against a real file with the real migrations rather than a
 * hand-built fixture, for the reason price memory does: a column that 003 never
 * adds, or a name the INSERT and the SELECT spell differently, must break here
 * and not on the desk's machine.
 *
 * The response to POST /quote is not evidence on its own — it is built from the
 * request body, so a route that persisted nothing would still echo the warranty
 * straight back. Every case below reads it again through GET /quotes/:id.
 */
let db: Database.Database
vi.mock('../db/client.js', () => ({ getDb: () => db }))
const { quoteRoutes } = await import('./quote.js')

let dir: string
let applied: string[]
let server: Server
let origin: string

const TERMS = {
  payment: '100% Advance',
  delivery: '1-2 Weeks after PO',
  prices: 'All-inclusive as per this quotation',
  validity: '31st August 2026.',
}

/** A quotation for the drive that started this, minus the terms. */
const BODY = {
  date: '2026-08-18',
  initials: 'RG',
  customer: { name: 'Morgan Stanley', address: 'Powai, Mumbai', attention: 'Mr. Subhransu Kar.' },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  items: [
    { desc: '1.6 TB SAS 12G Drive (Refurbished)', make: '', partCode: '', qty: 1, rate: 2_000_000 },
  ],
  tax: { mode: 'IGST', rate: 18 },
  sourceThread: '',
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'warranty-'))
  db = new Database(path.join(dir, 'q.db'))
  db.pragma('foreign_keys = ON')
  applied = migrate(db)

  const app = express()
  app.use(express.json())
  app.use('/api', quoteRoutes)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

async function save(terms: Record<string, string>) {
  const response = await fetch(origin + '/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...BODY, terms }),
  })
  return { status: response.status, body: (await response.json()) as Quote }
}

async function load(id: string) {
  const response = await fetch(origin + '/api/quotes/' + id)
  return { status: response.status, body: (await response.json()) as Quote }
}

const storedWarranty = (id: string) =>
  (db.prepare('SELECT term_warranty FROM quotes WHERE id = ?').get(id) as {
    term_warranty: string
  }).term_warranty

describe('the warranty term', () => {
  it('is a migration the runner finds on its own', () => {
    expect(applied).toContain('003_warranty.sql')
  })

  it('survives the round trip through the route', async () => {
    const saved = await save({ ...TERMS, warranty: '1 Year' })
    expect(saved.status).toBe(201)
    expect(saved.body.terms.warranty).toBe('1 Year')

    expect(storedWarranty(saved.body.id)).toBe('1 Year')

    const loaded = await load(saved.body.id)
    expect(loaded.status).toBe(200)
    expect(loaded.body.terms.warranty).toBe('1 Year')
    // The other four are untouched by the fifth arriving.
    expect(loaded.body.terms).toEqual({ ...TERMS, warranty: '1 Year' })
  })

  it('is stored verbatim, so the desk can type one no line ever stated', async () => {
    const saved = await save({ ...TERMS, warranty: '3 Years On-site, extendable' })
    const loaded = await load(saved.body.id)

    expect(loaded.body.terms.warranty).toBe('3 Years On-site, extendable')
  })

  it('accepts a body that does not mention it, and stores blank', async () => {
    // The browser as it stands today. Sending no warranty is not a malformed
    // request, it is a quotation that states none — and it must still save.
    const saved = await save(TERMS)
    expect(saved.status).toBe(201)
    expect(saved.body.terms.warranty).toBe('')

    const loaded = await load(saved.body.id)
    expect(loaded.body.terms.warranty).toBe('')
  })

  it('reads back blank on a row written before the column existed', () => {
    // An old quotation, inserted the way the route used to insert one: every
    // term column named except this one. It has to load, and it has to load
    // with a warranty of '' rather than undefined, so it renders four terms
    // exactly as it did before today.
    db.prepare(
      `INSERT INTO quotes (id, ref, revision, date, customer_name,
                           tax_mode, tax_rate,
                           term_payment, term_delivery, term_prices, term_validity,
                           created_at, updated_at)
       VALUES ('old', 'NCS/2025-26/Quotes/RG/099', 0, '2026-07-10', 'Morgan Stanley',
               'IGST', 18,
               @payment, @delivery, @prices, @validity,
               '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z')`,
    ).run(TERMS)

    expect(storedWarranty('old')).toBe('')
  })

  it('loads that old quotation through the route with a blank warranty', async () => {
    const loaded = await load('old')

    expect(loaded.status).toBe(200)
    expect(loaded.body.terms).toEqual({ ...TERMS, warranty: '' })
  })
})
