import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import {
  SaveQuoteRequestSchema,
  UpdateQuoteRequestSchema,
  UpdateStatusRequestSchema,
  type Quote,
  type QuoteSummary,
} from '@shared/schema.js'
import { computeTotals } from '@shared/money.js'
import { fromISODate } from '@shared/fy.js'
import { validateBody, validated } from '../middleware/validate.js'
import { getDb } from '../db/client.js'
import { allocateRef, claimRef, peekNextSeq } from '../lib/refno.js'
import { loadMakes } from '../lib/makes.js'
import { rememberCustomer, searchCustomers } from '../lib/customers.js'
import { findPastPrices } from '../lib/priceHistory.js'
import { draftCoveringEmail } from '../lib/draftEmail.js'
import { z } from 'zod'

export const quoteRoutes = Router()

/** The makes list, for the editor's Make column and the Ariba address. */
quoteRoutes.get('/makes', (_req, res) => {
  res.json({
    makes: loadMakes().map((m) => ({ name: m.name, manufacturerAddress: m.manufacturerAddress })),
  })
})

/**
 * Preview only — deliberately does NOT take a number (§7).
 *
 * The query is validated rather than coerced. It was reading `req.query`
 * straight through, which meant `?date=nonsense` reached `fromISODate` and came
 * back as an Invalid Date, and the financial year computed off it was garbage.
 */
const NextRefQuerySchema = z.object({
  initials: z.string().trim().min(1).max(4).default('RG'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
})

quoteRoutes.get('/next-ref', (req, res) => {
  const parsed = NextRefQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid query',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
    return
  }

  const { initials, date } = parsed.data
  res.json({ nextSeq: peekNextSeq(getDb(), date ? fromISODate(date) : new Date(), initials) })
})

/** Typeahead for the Customer field. Empty query returns the most recent. */
const CustomerSearchQuerySchema = z.object({
  q: z.string().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(25).default(8),
})

quoteRoutes.get('/customers', (req, res) => {
  const parsed = CustomerSearchQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query' })
    return
  }
  res.json({ customers: searchCustomers(parsed.data.q, parsed.data.limit) })
})

/**
 * What we last quoted for these products. One round trip for the whole
 * quotation rather than one per line.
 */
const PriceHistoryBodySchema = z.object({
  lines: z
    .array(z.object({ desc: z.string(), partCode: z.string().default('') }))
    .max(100),
  excludeQuoteId: z.string().optional(),
})

quoteRoutes.post('/price-history', validateBody(PriceHistoryBodySchema), (req, res) => {
  const { lines, excludeQuoteId } = validated(PriceHistoryBodySchema, req)
  res.json({
    matches: lines.map((line) =>
      findPastPrices({ desc: line.desc, partCode: line.partCode, excludeQuoteId }),
    ),
  })
})

quoteRoutes.post('/quote', validateBody(SaveQuoteRequestSchema), (req, res) => {
  const input = validated(SaveQuoteRequestSchema, req)
  const db = getDb()
  const now = new Date().toISOString()

  // Totals are recomputed here from the items. Whatever the browser thought
  // they were is irrelevant — this is the number that reaches the document.
  const totals = computeTotals(input.items, input.tax.mode, input.tax.rate)

  // The reference this save is attempting, kept outside the transaction because
  // that is the only thing that survives a rollback — and on a clash it is
  // exactly what the desk needs told back to them.
  let attempted = { ref: '', revision: 0 }

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
      // input.seqOverride is deliberately not consulted: a revision carries its
      // parent's reference, so there is no number here for the desk to choose.
    } else if (input.seqOverride !== undefined) {
      // The desk typed a number. It is used as typed, and the counter is carried
      // up to it so the next quotation continues past it (§7 still owns the
      // series; this only tells it where the series has got to).
      ref = claimRef(db, fromISODate(input.date), input.initials, input.seqOverride).ref
    } else {
      // §7 — allocated on save, never on page load.
      ref = allocateRef(db, fromISODate(input.date), input.initials).ref
    }

    attempted = { ref, revision }
    const id = randomUUID()

    db.prepare(
      `INSERT INTO quotes (
         id, ref, revision, date,
         customer_name, customer_address, customer_attention, customer_gstin, customer_state,
         contact, email, signatory,
         tax_mode, tax_rate,
         term_payment, term_delivery, term_prices, term_validity, term_warranty,
         sub_paise, tax_paise, total_paise,
         source_thread,
         status, created_at, updated_at
       ) VALUES (
         @id, @ref, @revision, @date,
         @customerName, @customerAddress, @customerAttention, @customerGstin, @customerState,
         @contact, @email, @signatory,
         @taxMode, @taxRate,
         @termPayment, @termDelivery, @termPrices, @termValidity, @termWarranty,
         @sub, @tax, @total,
         @sourceThread,
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
      termWarranty: input.terms.warranty,
      sub: totals.sub,
      tax: totals.tax,
      total: totals.total,
      sourceThread: input.sourceThread,
      now,
    })

    // The customer master builds itself from real use. Inside the transaction,
    // so a quotation and the customer it taught us about commit together.
    rememberCustomer(db, {
      name: input.customer.name,
      address: input.customer.address,
      attention: input.customer.attention,
      gstin: input.customer.gstin,
      state: input.customer.state,
      contact: input.contact,
      email: input.email,
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
      status: 'draft',
      createdAt: now,
    }
  })

  try {
    res.status(201).json(save())
  } catch (err) {
    if (!isRefTaken(err)) throw err

    /**
     * 409, not 400 and not 500.
     *
     * The body was valid — 045 is a perfectly well-formed number to ask for, so
     * nothing the request schema could have caught went wrong; it lost a race
     * with the state of the database, which is what 409 is for. And it is not a
     * 500: nothing is broken, the desk simply picked a number that is taken and
     * can pick another. The raw "UNIQUE constraint failed: quotes.ref,
     * quotes.revision" tells them none of that.
     */
    const taken =
      attempted.revision > 0 ? `${attempted.ref} Rev ${attempted.revision}` : attempted.ref
    res.status(409).json({
      error: `Reference ${taken} is already in use — choose a different number.`,
      ref: attempted.ref,
      revision: attempted.revision,
    })
  }
})

/**
 * The raw SQLite error behind idx_quotes_ref_revision, and only that one.
 *
 * Matched on the index's own columns rather than on SQLITE_CONSTRAINT_UNIQUE
 * alone, because the customer master's unique name index sits inside this same
 * transaction. A clash there would be a bug in our code, and it must keep
 * reaching the error handler as a 500 instead of being dressed up as a number
 * the desk can retype.
 */
function isRefTaken(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    err.message.includes('quotes.ref')
  )
}

/** Draft the covering email for a saved quotation. Drafts only; never sends. */
const DraftEmailBodySchema = z.object({ quoteId: z.string().min(1) })

quoteRoutes.post('/draft-email', validateBody(DraftEmailBodySchema), async (req, res) => {
  const { quoteId } = validated(DraftEmailBodySchema, req)
  const quote = loadQuote(quoteId)
  if (!quote) {
    res.status(404).json({ error: `No quote with id ${quoteId}` })
    return
  }

  const result = await draftCoveringEmail(quote)
  if (!result.ok) {
    res.json({ ok: false, reason: result.reason })
    return
  }
  res.json({ ok: true, ...result.data })
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

/**
 * Edit a saved quotation in place, keeping its reference.
 *
 * The download renders the STORED ROW — render.ts takes a quoteId and calls
 * loadQuote — while the preview beside the form renders the draft on screen. So
 * every edit made after a save lived in the preview alone: the desk switched a
 * Maharashtra quotation to one GST row, watched the preview follow, and
 * downloaded a PDF still carrying CGST 9% and SGST 9% because that is what the
 * record said. Saving again fixed it and burned a reference number doing so.
 * This is the missing half — the same body a save takes, written over the same
 * row, so the record catches up with the screen instead of the desk paying a
 * number for it.
 *
 * `ref`, `revision`, `status` and `created_at` are absent from the SET clause
 * on purpose: the first two are the quotation's identity, the third moves only
 * through /status, and the fourth records when this quotation came into being,
 * which an edit does not change. `updated_at` moves, because it is the only
 * column that says when the record was last made to agree with the screen.
 */
// The `{ id: string }` is not decoration: Express types a param as
// `string | string[]` once a middleware sits in front of the handler, and an id
// that might be an array is an id that cannot be looked up.
quoteRoutes.put<{ id: string }>(
  '/quotes/:id',
  validateBody(UpdateQuoteRequestSchema),
  (req, res) => {
    const input = validated(UpdateQuoteRequestSchema, req)
    const db = getDb()
    const id = req.params.id
    const now = new Date().toISOString()

    // Recomputed from the items exactly as POST does. An edit is no more entitled
    // to send its own totals than a save is.
    const totals = computeTotals(input.items, input.tax.mode, input.tax.rate)

    type Outcome =
      | { written: true }
      | { written: false; reason: 'missing' }
      | { written: false; reason: 'not-draft'; ref: string; revision: number; status: string }

    const update = db.transaction((): Outcome => {
      // Read inside the transaction, so the status the refusal is based on is the
      // status the write would have run against.
      const existing = db
        .prepare('SELECT ref, revision, status FROM quotes WHERE id = ?')
        .get(id) as { ref: string; revision: number; status: string } | undefined

      if (!existing) return { written: false, reason: 'missing' }
      if (existing.status !== 'draft') return { written: false, reason: 'not-draft', ...existing }

      db.prepare(
        `UPDATE quotes SET
           date = @date,
           customer_name = @customerName,
           customer_address = @customerAddress,
           customer_attention = @customerAttention,
           customer_gstin = @customerGstin,
           customer_state = @customerState,
           contact = @contact,
           email = @email,
           signatory = @signatory,
           tax_mode = @taxMode,
           tax_rate = @taxRate,
           term_payment = @termPayment,
           term_delivery = @termDelivery,
           term_prices = @termPrices,
           term_validity = @termValidity,
           term_warranty = @termWarranty,
           sub_paise = @sub,
           tax_paise = @tax,
           total_paise = @total,
           source_thread = @sourceThread,
           updated_at = @now
         WHERE id = @id`,
      ).run({
        id,
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
        termWarranty: input.terms.warranty,
        sub: totals.sub,
        tax: totals.tax,
        total: totals.total,
        sourceThread: input.sourceThread,
        now,
      })

      // Same call a save makes, so a detail corrected on the second look — a
      // repaired address, a GSTIN finally read off the letterhead — reaches the
      // customer master instead of dying with the edit.
      rememberCustomer(db, {
        name: input.customer.name,
        address: input.customer.address,
        attention: input.customer.attention,
        gstin: input.customer.gstin,
        state: input.customer.state,
        contact: input.contact,
        email: input.email,
      })

      /**
       * The lines are replaced wholesale, never diffed.
       *
       * The editor reorders rows and deletes them, so line 2 after an edit is
       * rarely line 2 before it. A positional diff would write one product's
       * price onto another product's row and look entirely successful doing it,
       * which is the kind of corruption nobody finds until a customer does.
       */
      db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(id)

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

      return { written: true }
    })

    const outcome = update()

    if (!outcome.written) {
      if (outcome.reason === 'missing') {
        res.status(404).json({ error: `No quote with id ${id}` })
        return
      }

      /**
       * 409, not 403 and not 405.
       *
       * Nothing is wrong with the body and nobody is being told they lack
       * permission — there is no permission in this application, the desk is five
       * people sharing one file. What refuses the write is the STATE of this row:
       * 'sent' means a document went to a customer, and rewriting the record
       * behind it leaves us unable to say what they were sent, which is the one
       * thing this application exists to be able to say. A conflict with the
       * current state of the resource is what 409 is for, and it is the code a
       * taken reference number already uses here for the same reason. 405 would
       * be a lie: PUT is allowed on this URL, just not on this row today.
       *
       * The way out is named in the sentence, because a refusal that does not say
       * what to do instead gets worked around by deleting the quotation.
       */
      const named = outcome.revision > 0 ? `${outcome.ref} Rev ${outcome.revision}` : outcome.ref
      res.status(409).json({
        error:
          `${named} is marked ${outcome.status} and can no longer be edited in place. ` +
          'Revise it instead: a revision keeps the reference and takes the next revision number.',
        ref: outcome.ref,
        revision: outcome.revision,
        status: outcome.status,
      })
      return
    }

    /**
     * The stored row, read back — not the request echoed.
     *
     * A save can afford to answer with what it was handed. This route cannot: it
     * exists because a screen and a record disagreed, and an answer assembled
     * from the request would be the screen agreeing with itself again. What comes
     * back here is what the download will render.
     */
    const stored = loadQuote(id)
    if (!stored) throw new Error(`Quote ${id} could not be read back after updating it`)
    res.json(stored)
  },
)

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

/**
 * Delete one quotation, and only that one.
 *
 * A revision is its own row sharing a reference with its siblings, so deleting
 * "Rev 2" leaves the original and Rev 1 and Rev 3 alone. Line items go with it
 * through ON DELETE CASCADE — which is why `foreign_keys` is switched on per
 * connection in db/client.ts; without that pragma SQLite would silently orphan
 * them.
 *
 * The reference number is deliberately NOT released. `ref_counters` only ever
 * moves forward, so a deleted NCS/2026-27/Quotes/RG/006 cannot be handed out
 * again to a different customer — two quotations sharing a reference is a far
 * worse problem than a gap in the sequence.
 */
quoteRoutes.delete('/quotes/:id', (req, res) => {
  const db = getDb()

  const existing = db
    .prepare('SELECT ref, revision, status FROM quotes WHERE id = ?')
    .get(req.params.id) as { ref: string; revision: number; status: string } | undefined

  if (!existing) {
    res.status(404).json({ error: `No quote with id ${req.params.id}` })
    return
  }

  db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id)

  console.log(
    `[quotes] deleted ${existing.ref}${existing.revision > 0 ? ` Rev ${existing.revision}` : ''} (was ${existing.status})`,
  )

  res.json({ ok: true, ref: existing.ref, revision: existing.revision })
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
      warranty: row.term_warranty as string,
    },
    totals: {
      sub: row.sub_paise as number,
      tax: row.tax_paise as number,
      total: row.total_paise as number,
    },
    sourceThread: row.source_thread as string,
    status: row.status as Quote['status'],
    createdAt: row.created_at as string,
  }
}
