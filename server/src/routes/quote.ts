import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import {
  SaveQuoteRequestSchema,
  UpdateStatusRequestSchema,
  type Quote,
  type QuoteSummary,
} from '@shared/schema.js'
import { computeTotals } from '@shared/money.js'
import { fromISODate } from '@shared/fy.js'
import { validateBody, validated } from '../middleware/validate.js'
import { getDb } from '../db/client.js'
import { allocateRef, peekNextSeq } from '../lib/refno.js'
import { loadMakes } from '../lib/makes.js'

export const quoteRoutes = Router()

/** The makes list, for the editor's Make column and the Ariba address. */
quoteRoutes.get('/makes', (_req, res) => {
  res.json({
    makes: loadMakes().map((m) => ({ name: m.name, manufacturerAddress: m.manufacturerAddress })),
  })
})

/** Preview only — deliberately does NOT take a number (§7). */
quoteRoutes.get('/next-ref', (req, res) => {
  const initials = String(req.query.initials ?? 'RG')
  const date = typeof req.query.date === 'string' ? fromISODate(req.query.date) : new Date()
  res.json({ nextSeq: peekNextSeq(getDb(), date, initials) })
})

quoteRoutes.post('/quote', validateBody(SaveQuoteRequestSchema), (req, res) => {
  const input = validated(SaveQuoteRequestSchema, req)
  const db = getDb()
  const now = new Date().toISOString()

  // Totals are recomputed here from the items. Whatever the browser thought
  // they were is irrelevant — this is the number that reaches the document.
  const totals = computeTotals(input.items, input.tax.mode, input.tax.rate)

  const save = db.transaction((): Quote => {
    let ref: string
    let revision = 0

    if (input.reviseOf) {
      // §10 — clone as a revision: same reference, next revision number.
      const parent = db
        .prepare('SELECT ref FROM quotes WHERE id = ?')
        .get(input.reviseOf) as { ref: string } | undefined
      if (!parent) throw new Error(`No quote with id ${input.reviseOf} to revise`)

      const highest = db
        .prepare('SELECT MAX(revision) AS r FROM quotes WHERE ref = ?')
        .get(parent.ref) as { r: number | null }

      ref = parent.ref
      revision = (highest.r ?? 0) + 1
    } else {
      // §7 — allocated on save, never on page load.
      ref = allocateRef(db, fromISODate(input.date), input.initials).ref
    }

    const id = randomUUID()

    db.prepare(
      `INSERT INTO quotes (
         id, ref, revision, date,
         customer_name, customer_address, customer_attention, customer_gstin, customer_state,
         contact, email, signatory,
         tax_mode, tax_rate,
         term_payment, term_delivery, term_prices, term_validity,
         sub_paise, tax_paise, total_paise,
         source_thread, reconciliation,
         status, created_at, updated_at
       ) VALUES (
         @id, @ref, @revision, @date,
         @customerName, @customerAddress, @customerAttention, @customerGstin, @customerState,
         @contact, @email, @signatory,
         @taxMode, @taxRate,
         @termPayment, @termDelivery, @termPrices, @termValidity,
         @sub, @tax, @total,
         @sourceThread, @reconciliation,
         'draft', @now, @now
       )`,
    ).run({
      id,
      ref,
      revision,
      date: input.date,
      customerName: input.customer.name,
      customerAddress: input.customer.address,
      customerAttention: input.customer.attention,
      customerGstin: input.customer.gstin ?? null,
      customerState: input.customer.state ?? null,
      contact: input.contact,
      email: input.email,
      signatory: input.signatory,
      taxMode: input.tax.mode,
      taxRate: input.tax.rate,
      termPayment: input.terms.payment,
      termDelivery: input.terms.delivery,
      termPrices: input.terms.prices,
      termValidity: input.terms.validity,
      sub: totals.sub,
      tax: totals.tax,
      total: totals.total,
      sourceThread: input.sourceThread,
      reconciliation: JSON.stringify(input.reconciliation),
      now,
    })

    const insertItem = db.prepare(
      `INSERT INTO quote_items
         (id, quote_id, line_no, description, make, part_code, hsn, qty, rate_paise, amount_paise)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    input.items.forEach((item, index) => {
      insertItem.run(
        randomUUID(),
        id,
        index + 1,
        item.desc,
        item.make,
        item.partCode,
        item.hsn ?? null,
        item.qty,
        item.rate,
        item.qty * item.rate,
      )
    })

    return {
      id,
      ref,
      revision,
      date: input.date,
      customer: input.customer,
      contact: input.contact,
      email: input.email,
      signatory: input.signatory,
      items: input.items,
      tax: input.tax,
      terms: input.terms,
      totals: { sub: totals.sub, tax: totals.tax, total: totals.total },
      sourceThread: input.sourceThread,
      reconciliation: input.reconciliation,
      status: 'draft',
      createdAt: now,
    }
  })

  res.status(201).json(save())
})

quoteRoutes.get('/quotes', (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, ref, revision, date, customer_name, total_paise, status, created_at
       FROM quotes ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>

  const summaries: QuoteSummary[] = rows.map((r) => ({
    id: r.id as string,
    ref: r.ref as string,
    revision: r.revision as number,
    date: r.date as string,
    customerName: r.customer_name as string,
    total: r.total_paise as number,
    status: r.status as QuoteSummary['status'],
    createdAt: r.created_at as string,
  }))

  res.json({ quotes: summaries })
})

quoteRoutes.get('/quotes/:id', (req, res) => {
  const quote = loadQuote(req.params.id)
  if (!quote) {
    res.status(404).json({ error: `No quote with id ${req.params.id}` })
    return
  }
  res.json(quote)
})

quoteRoutes.post('/quotes/:id/status', validateBody(UpdateStatusRequestSchema), (req, res) => {
  const { status } = validated(UpdateStatusRequestSchema, req)
  const result = getDb()
    .prepare('UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), req.params.id)

  if (result.changes === 0) {
    res.status(404).json({ error: `No quote with id ${req.params.id}` })
    return
  }
  res.json({ ok: true })
})

/** Shared by the routes above and by document rendering (M5). */
export function loadQuote(id: string): Quote | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return null

  const items = db
    .prepare(
      'SELECT description, make, part_code, hsn, qty, rate_paise FROM quote_items WHERE quote_id = ? ORDER BY line_no',
    )
    .all(id) as Array<Record<string, unknown>>

  return {
    id: row.id as string,
    ref: row.ref as string,
    revision: row.revision as number,
    date: row.date as string,
    customer: {
      name: row.customer_name as string,
      address: row.customer_address as string,
      attention: row.customer_attention as string,
      ...(row.customer_gstin ? { gstin: row.customer_gstin as string } : {}),
      ...(row.customer_state ? { state: row.customer_state as string } : {}),
    },
    contact: row.contact as string,
    email: row.email as string,
    signatory: row.signatory as string,
    items: items.map((i) => ({
      desc: i.description as string,
      make: i.make as string,
      partCode: i.part_code as string,
      ...(i.hsn ? { hsn: i.hsn as string } : {}),
      qty: i.qty as number,
      rate: i.rate_paise as number,
    })),
    tax: { mode: row.tax_mode as 'IGST' | 'CGST+SGST', rate: row.tax_rate as number },
    terms: {
      payment: row.term_payment as string,
      delivery: row.term_delivery as string,
      prices: row.term_prices as string,
      validity: row.term_validity as string,
    },
    totals: {
      sub: row.sub_paise as number,
      tax: row.tax_paise as number,
      total: row.total_paise as number,
    },
    sourceThread: row.source_thread as string,
    reconciliation: JSON.parse(row.reconciliation as string),
    status: row.status as Quote['status'],
    createdAt: row.created_at as string,
  }
}
