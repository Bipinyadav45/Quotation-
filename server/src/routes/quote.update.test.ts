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
 * Editing a saved quotation without taking a new number.
 *
 * The bug this route answers: a Maharashtra quotation saved as CGST+SGST, the
 * tax then switched to one GST row on screen, and a downloaded PDF that still
 * printed CGST 9% and SGST 9% — because the download renders the stored row
 * (render.ts loads by id) while the preview renders the draft. It was never
 * about tax. Every field diverged the same way, silently, and the only cure was
 * to save again and burn a reference.
 *
 * So every assertion here reads the DATABASE, not the response. A route that
 * answered 200 with the request echoed back and wrote nothing at all would pass
 * a test that trusted the response, and would be the exact bug again.
 *
 * Real file, real migrations, real HTTP, for the reason the warranty and
 * reference tests use them: the unique index, the CASCADE and the NOT NULLs
 * that make a half-written update possible at all live in the migrations, and a
 * hand-built fixture that forgot one would pass here while the desk lost a
 * quotation.
 *
 * Every case uses its own initials and its own row. The series are per
 * salesperson (§7), so no case can be made to pass or fail by the order the
 * others ran in.
 */
let db: Database.Database
vi.mock('../db/client.js', () => ({ getDb: () => db }))
const { quoteRoutes } = await import('./quote.js')

let dir: string
let server: Server
let origin: string

/** Everything a save and an edit both carry. The reference fields are not here. */
const DRAFT = {
  date: '2026-08-18', // FY 2026-27
  customer: {
    name: 'Morgan Stanley',
    address: 'Powai, Mumbai',
    attention: 'Mr. Subhransu Kar.',
    state: 'Maharashtra',
  },
  contact: '022-40668809',
  email: 'rakhi.gupte@newtech.in',
  signatory: 'Rakhi Gupte',
  items: [
    { desc: '1.6 TB SAS 12G Drive (Refurbished)', make: '', partCode: '', qty: 1, rate: 2_000_000 },
  ],
  // The state is Maharashtra, so this is what the desk's default put in the row.
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
  dir = mkdtempSync(path.join(tmpdir(), 'quote-update-'))
  db = new Database(path.join(dir, 'q.db'))
  db.pragma('foreign_keys = ON')
  migrate(db)

  const app = express()
  app.use(express.json())
  app.use('/api', quoteRoutes)
  // The 500 handler index.ts installs. Without it a failure inside the
  // transaction would hang the request instead of arriving as a status.
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

type Body = Quote & { error?: string; issues?: Array<{ path: string; message: string }> }

async function save(patch: Record<string, unknown> = {}) {
  const response = await fetch(origin + '/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...DRAFT, initials: 'RG', ...patch }),
  })
  return { status: response.status, body: (await response.json()) as Body }
}

async function edit(id: string, patch: Record<string, unknown> = {}) {
  const response = await fetch(origin + '/api/quotes/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...DRAFT, ...patch }),
  })
  return { status: response.status, body: (await response.json()) as Body }
}

async function load(id: string) {
  const response = await fetch(origin + '/api/quotes/' + id)
  return { status: response.status, body: (await response.json()) as Body }
}

async function mark(id: string, status: string) {
  return fetch(`${origin}/api/quotes/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

/** The stored row, whole. Every "nothing was written" assertion compares one of these. */
const row = (id: string) =>
  db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Record<string, unknown>

const storedItems = (id: string) =>
  db
    .prepare(
      `SELECT line_no, description, make, part_code, qty, rate_paise, amount_paise
         FROM quote_items WHERE quote_id = ? ORDER BY line_no`,
    )
    .all(id) as Array<Record<string, unknown>>

const countOf = (table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

const counter = (initials: string) =>
  (
    db
      .prepare('SELECT last_seq FROM ref_counters WHERE fy = ? AND initials = ?')
      .get('2026-27', initials) as { last_seq: number } | undefined
  )?.last_seq ?? 0

/**
 * Park updated_at somewhere no clock would produce it.
 *
 * Save and edit land in the same millisecond often enough that comparing two
 * real timestamps is a coin toss. This makes "updated_at moved" an assertion
 * about the route rather than about how fast the machine is.
 */
const SENTINEL = '1999-12-31T00:00:00.000Z'
const parkUpdatedAt = (id: string) =>
  db.prepare('UPDATE quotes SET updated_at = ? WHERE id = ?').run(SENTINEL, id)

describe('editing a saved draft in place', () => {
  it('changes the tax mode on the stored row, not only in the preview', async () => {
    // A rate whose halves do not divide evenly, so the two modes cannot produce
    // the same tax by accident: 18% of 10,000.50 is 1,800.09, while 9% twice is
    // 900.045 rounded to 900.05 each — 1,800.10. One paisa apart, which is the
    // whole point of computing in integer paise.
    const line = {
      desc: '1.6 TB SAS 12G Drive (Refurbished)',
      make: '',
      partCode: '',
      qty: 1,
      rate: 1_000_050,
    }
    const saved = await save({ initials: 'AA', items: [line] })
    expect(saved.status).toBe(201)

    const before = row(saved.body.id)
    expect(before.tax_mode).toBe('CGST+SGST')
    expect(before.tax_paise).toBe(180_010)
    parkUpdatedAt(saved.body.id)

    const edited = await edit(saved.body.id, { items: [line], tax: { mode: 'IGST', rate: 18 } })
    expect(edited.status).toBe(200)

    // The column, not the echo. This is the assertion the bug report asked for.
    const after = row(saved.body.id)
    expect(after.tax_mode).toBe('IGST')
    expect(after.tax_rate).toBe(18)
    expect(after.sub_paise).toBe(1_000_050)
    expect(after.tax_paise).toBe(180_009)
    expect(after.total_paise).toBe(1_180_059)

    // The identity is untouched, which is the reason this route exists rather
    // than another save.
    expect(after.ref).toBe(before.ref)
    expect(after.revision).toBe(before.revision)
    expect(after.created_at).toBe(before.created_at)
    expect(after.status).toBe('draft')

    // And the record now says when it last caught up with the screen.
    expect(after.updated_at).not.toBe(SENTINEL)
    expect(String(after.updated_at) >= String(after.created_at)).toBe(true)

    // One row, not two, and no number burned — the fix that cost a reference is
    // exactly what this replaces.
    expect(
      db.prepare('SELECT count(*) AS n FROM quotes WHERE ref = ?').get(before.ref),
    ).toEqual({ n: 1 })
    expect(counter('AA')).toBe(1)
  })

  it('answers with the stored record, so the screen and the download agree', async () => {
    const saved = await save({ initials: 'AB' })
    const edited = await edit(saved.body.id, {
      signatory: 'Rohan Gupte',
      customer: { ...DRAFT.customer, attention: 'Ms. Anita Rao' },
    })

    // Byte for byte what GET — and therefore what the renderer — will see.
    expect(edited.body).toEqual((await load(saved.body.id)).body)
    expect(edited.body.signatory).toBe('Rohan Gupte')
    expect(row(saved.body.id).signatory).toBe('Rohan Gupte')
  })
})

describe('the line items', () => {
  const RAIL = { desc: 'Rack rail kit', make: 'Dell', partCode: 'RK-2U', qty: 2, rate: 150_000 }
  const CORD = { desc: 'Power cord C13', make: '', partCode: 'C13-2M', qty: 4, rate: 25_000 }
  const DRIVE = {
    desc: '1.6 TB SAS 12G Drive (Refurbished)',
    make: 'Seagate',
    partCode: 'ST16',
    qty: 1,
    rate: 2_000_000,
  }

  it('are replaced wholesale, surviving a reorder and a delete', async () => {
    const saved = await save({ initials: 'BB', items: [RAIL, CORD, DRIVE] })
    expect(storedItems(saved.body.id).map((i) => i.description)).toEqual([
      'Rack rail kit',
      'Power cord C13',
      '1.6 TB SAS 12G Drive (Refurbished)',
    ])

    // The drive moves to the top, the cord is deleted, and the rails change
    // quantity — the three things the editor does that a positional diff gets
    // wrong at once.
    const edited = await edit(saved.body.id, { items: [DRIVE, { ...RAIL, qty: 3 }] })
    expect(edited.status).toBe(200)

    expect(storedItems(saved.body.id)).toEqual([
      {
        line_no: 1,
        description: '1.6 TB SAS 12G Drive (Refurbished)',
        make: 'Seagate',
        part_code: 'ST16',
        qty: 1,
        rate_paise: 2_000_000,
        amount_paise: 2_000_000,
      },
      {
        line_no: 2,
        description: 'Rack rail kit',
        make: 'Dell',
        part_code: 'RK-2U',
        qty: 3,
        rate_paise: 150_000,
        amount_paise: 450_000,
      },
    ])

    // The deleted line is gone from the table, not merely unreferenced.
    expect(
      db.prepare('SELECT count(*) AS n FROM quote_items WHERE part_code = ?').get('C13-2M'),
    ).toEqual({ n: 0 })

    // And it reads back in that order through the route the renderer uses.
    const loaded = await load(saved.body.id)
    expect(loaded.body.items.map((i) => i.desc)).toEqual([
      '1.6 TB SAS 12G Drive (Refurbished)',
      'Rack rail kit',
    ])
  })

  it('drive the totals, and a total the client sent is ignored', async () => {
    const saved = await save({ initials: 'CC', items: [RAIL] })
    expect(row(saved.body.id).total_paise).toBe(354_000) // 3,000.00 + 18%

    const edited = await edit(saved.body.id, {
      items: [{ ...RAIL, qty: 5 }],
      // A browser that thinks it knows better — stale, or tampered with. Either
      // way it is not what reaches the document.
      totals: { sub: 1, tax: 2, total: 3 },
    })

    expect(edited.status).toBe(200)
    const after = row(saved.body.id)
    expect(after.sub_paise).toBe(750_000)
    expect(after.tax_paise).toBe(135_000) // 67,500 CGST + 67,500 SGST
    expect(after.total_paise).toBe(885_000)
    expect(edited.body.totals).toEqual({ sub: 750_000, tax: 135_000, total: 885_000 })
  })
})

describe('a customer detail corrected after the save', () => {
  it('reaches the customer master, which is what makes the repair permanent', async () => {
    const name = 'Morgan Stanley Advantage Services'
    const saved = await save({
      initials: 'DD',
      customer: { name, address: 'Powai', attention: 'Mr. Subhransu Kar.', state: 'Maharashtra' },
    })
    expect(saved.status).toBe(201)

    await edit(saved.body.id, {
      customer: {
        name,
        address: 'Nirlon Knowledge Park, Goregaon (E), Mumbai 400063',
        attention: 'Mr. Subhransu Kar.',
        gstin: '27AAACM1234F1Z5',
        state: 'Maharashtra',
      },
    })

    const customer = db.prepare('SELECT * FROM customers WHERE name = ?').get(name) as Record<
      string,
      unknown
    >
    expect(customer.address).toBe('Nirlon Knowledge Park, Goregaon (E), Mumbai 400063')
    expect(customer.gstin).toBe('27AAACM1234F1Z5')

    // Stated rather than assumed: rememberCustomer is called exactly as a save
    // calls it, so an edit counts as another quotation against this customer.
    // The count is shown in the typeahead. Worth knowing about; not worth a
    // stale address.
    expect(customer.quote_count).toBe(2)
  })
})

describe('a quotation that is no longer a draft', () => {
  it('is refused, told what to do instead, and left exactly as it was', async () => {
    const saved = await save({ initials: 'EE' })
    expect((await mark(saved.body.id, 'sent')).status).toBe(200)

    const before = row(saved.body.id)
    const itemsBefore = storedItems(saved.body.id)
    const customersBefore = countOf('customers')

    const refused = await edit(saved.body.id, {
      customer: { name: 'Never Edited Ltd', address: 'Nowhere', attention: 'Nobody' },
      tax: { mode: 'IGST', rate: 18 },
      items: [
        { desc: 'Line one', make: '', partCode: '', qty: 1, rate: 100_000 },
        { desc: 'Line two', make: '', partCode: '', qty: 2, rate: 250_000 },
      ],
    })

    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain(String(before.ref))
    expect(refused.body.error).toMatch(/revise/i)
    expect(refused.body.error).not.toMatch(/constraint|sqlite/i)
    expect(refused.body.status).toBe('sent')

    // The document in the customer's inbox still has a record behind it that
    // matches it, down to the timestamp.
    expect(row(saved.body.id)).toEqual(before)
    expect(storedItems(saved.body.id)).toEqual(itemsBefore)
    expect(countOf('customers')).toBe(customersBefore)
    expect(
      db.prepare('SELECT id FROM customers WHERE name = ?').get('Never Edited Ltd'),
    ).toBeUndefined()
  })

  it.each(['won', 'lost'])('is refused when it is %s too', async (status) => {
    const saved = await save({ initials: status === 'won' ? 'EF' : 'EG' })
    await mark(saved.body.id, status)
    const before = row(saved.body.id)

    const refused = await edit(saved.body.id, { tax: { mode: 'IGST', rate: 18 } })

    expect(refused.status).toBe(409)
    expect(refused.body.status).toBe(status)
    expect(row(saved.body.id)).toEqual(before)
  })
})

describe('an id that is not a quotation', () => {
  it('is a 404 in the same words the rest of the API uses', async () => {
    const quotesBefore = countOf('quotes')

    const missing = await edit('no-such-id')

    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe('No quote with id no-such-id')
    expect(countOf('quotes')).toBe(quotesBefore)
  })
})

describe('a body a save would refuse', () => {
  it.each([
    [{ items: [] }, 'A quotation needs at least one line'],
    [{ date: '18-08-2026' }, 'Date must be YYYY-MM-DD'],
  ])('is refused here in the same words: %j', async (patch, message) => {
    const saved = await save({ initials: 'FF' })
    parkUpdatedAt(saved.body.id)

    const refused = await edit(saved.body.id, patch)

    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe('Invalid request body')
    expect(refused.body.issues?.map((i) => i.message)).toContain(message)
    // Rejected by the middleware, so the transaction never opened.
    expect(row(saved.body.id).updated_at).toBe(SENTINEL)
  })

  it('refuses a rate that is not whole paise', async () => {
    const saved = await save({ initials: 'FG' })

    const refused = await edit(saved.body.id, {
      items: [{ desc: 'Half a paisa', make: '', partCode: '', qty: 1, rate: 1250.5 }],
    })

    expect(refused.status).toBe(400)
    expect(row(saved.body.id).sub_paise).toBe(2_000_000)
  })
})

describe('the reference, which an edit may not touch', () => {
  it.each([
    ['initials', 'ZZ'],
    ['seqOverride', 45],
    ['reviseOf', 'some-other-id'],
  ])('refuses %s rather than accepting it and ignoring it', async (field, value) => {
    const saved = await save({ initials: 'GG' })
    const before = row(saved.body.id)
    parkUpdatedAt(saved.body.id)

    const refused = await edit(saved.body.id, { [field]: value })

    expect(refused.status).toBe(400)
    const issue = refused.body.issues?.find((i) => i.path === field)
    // A sentence about the reference, not "expected undefined, received string".
    expect(issue?.message).toMatch(/reference|revision/i)
    expect(row(saved.body.id).ref).toBe(before.ref)
    expect(row(saved.body.id).updated_at).toBe(SENTINEL)
  })

  it('accepts a body that simply leaves them out — which is every edit', async () => {
    const saved = await save({ initials: 'GH' })
    const edited = await edit(saved.body.id, { seqOverride: undefined })

    expect(edited.status).toBe(200)
    expect(edited.body.ref).toBe(String(row(saved.body.id).ref))
  })
})

describe('a write that fails half way through', () => {
  it('leaves the previous version whole rather than half of each', async () => {
    const saved = await save({
      initials: 'HH',
      items: [
        { desc: 'Rack rail kit', make: 'Dell', partCode: 'RK-2U', qty: 2, rate: 150_000 },
        { desc: 'Power cord C13', make: '', partCode: 'C13-2M', qty: 4, rate: 25_000 },
      ],
    })
    const before = row(saved.body.id)
    const itemsBefore = storedItems(saved.body.id)
    parkUpdatedAt(saved.body.id)
    const parked = row(saved.body.id)

    /**
     * A real failure at the worst possible moment: the header has been
     * rewritten and the old lines deleted, and the second new line will not go
     * in. Without one transaction around all of it the desk is left with a
     * quotation whose customer and totals are the new ones and whose lines are
     * whatever survived — a document that has never existed on anyone's screen.
     */
    db.exec(`CREATE TRIGGER explode BEFORE INSERT ON quote_items
             WHEN NEW.description = 'EXPLODE'
             BEGIN SELECT RAISE(ABORT, 'the disk went away'); END`)

    try {
      const failed = await edit(saved.body.id, {
        customer: { name: 'Half Written Ltd', address: 'Nowhere', attention: 'Nobody' },
        tax: { mode: 'IGST', rate: 18 },
        items: [
          { desc: 'Survivor', make: '', partCode: '', qty: 1, rate: 100_000 },
          { desc: 'EXPLODE', make: '', partCode: '', qty: 1, rate: 100_000 },
        ],
      })
      expect(failed.status).toBe(500)
    } finally {
      db.exec('DROP TRIGGER explode')
    }

    // Every column, including the ones the failed edit had already written.
    expect(row(saved.body.id)).toEqual(parked)
    expect(storedItems(saved.body.id)).toEqual(itemsBefore)
    expect(String(before.ref)).toBe(String(parked.ref))
    expect(
      db.prepare('SELECT count(*) AS n FROM quote_items WHERE description = ?').get('Survivor'),
    ).toEqual({ n: 0 })
    expect(
      db.prepare('SELECT id FROM customers WHERE name = ?').get('Half Written Ltd'),
    ).toBeUndefined()

    // And the row is still editable afterwards, so the rollback left no lock or
    // half-open transaction behind.
    expect((await edit(saved.body.id, { signatory: 'Rakhi Gupte' })).status).toBe(200)
  })
})
