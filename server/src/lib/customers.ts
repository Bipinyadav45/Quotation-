import type BetterSqlite3 from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'

/**
 * The customer master.
 *
 * It has no data-entry screen and does not need one: `rememberCustomer` runs
 * inside the save transaction, so the table fills itself from real use. The
 * second quotation to a customer offers back everything the first one typed —
 * which matters most for the GSTIN, the one field on the document that is
 * both long and unforgiving.
 */

export interface CustomerRecord {
  id: string
  name: string
  address: string
  attention: string
  gstin: string
  state: string
  contact: string
  email: string
  quoteCount: number
  lastUsedAt: string
}

const ROW_TO_RECORD = (row: Record<string, unknown>): CustomerRecord => ({
  id: row.id as string,
  name: row.name as string,
  address: row.address as string,
  attention: row.attention as string,
  gstin: row.gstin as string,
  state: row.state as string,
  contact: row.contact as string,
  email: row.email as string,
  quoteCount: row.quote_count as number,
  lastUsedAt: row.last_used_at as string,
})

/**
 * Typeahead. Names that start with the query rank above names that merely
 * contain it, and within each the most recently quoted comes first — the desk
 * is far more likely to be quoting whoever they quoted last week.
 */
export function searchCustomers(query: string, limit = 8): CustomerRecord[] {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return (
      getDb()
        .prepare('SELECT * FROM customers ORDER BY last_used_at DESC LIMIT ?')
        .all(limit) as Array<Record<string, unknown>>
    ).map(ROW_TO_RECORD)
  }

  /**
   * A customer called "L&T 100%" must not turn into a wildcard. The escape
   * character is "!" rather than a backslash on purpose: this SQL lives in a
   * template literal, where `''` is not a backslash at all — the backslash
   * escapes the quote and SQLite receives an empty ESCAPE clause.
   */
  const escaped = q.replace(/[!%_]/g, (c) => `!${c}`)
  const like = `%${escaped}%`
  const starts = `${escaped}%`

  return (
    getDb()
      .prepare(
        `SELECT * FROM customers
          WHERE lower(name) LIKE ? ESCAPE '!'
       ORDER BY CASE WHEN lower(name) LIKE ? ESCAPE '!' THEN 0 ELSE 1 END,
                last_used_at DESC
          LIMIT ?`,
      )
      .all(like, starts, limit) as Array<Record<string, unknown>>
  ).map(ROW_TO_RECORD)
}

export function findCustomerByName(name: string): CustomerRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM customers WHERE lower(name) = lower(?)')
    .get(name.trim()) as Record<string, unknown> | undefined
  return row ? ROW_TO_RECORD(row) : null
}

export interface RememberInput {
  name: string
  address?: string
  attention?: string
  gstin?: string
  state?: string
  contact?: string
  email?: string
}

/**
 * Record a customer as part of saving a quotation.
 *
 * Empty fields never overwrite stored ones. A quotation that omits the GSTIN
 * must not erase the GSTIN we already hold — the whole point of the table is
 * that it accumulates, and a blank is an absence of information rather than a
 * statement that the value is blank.
 *
 * Takes the transaction's own db handle so it commits or rolls back with the
 * quotation, never separately.
 */
export function rememberCustomer(db: BetterSqlite3.Database, input: RememberInput): void {
  const name = input.name.trim()
  if (name === '') return

  const now = new Date().toISOString()
  const existing = db
    .prepare('SELECT id FROM customers WHERE lower(name) = lower(?)')
    .get(name) as { id: string } | undefined

  if (!existing) {
    db.prepare(
      `INSERT INTO customers
         (id, name, address, attention, gstin, state, contact, email,
          quote_count, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      randomUUID(),
      name,
      input.address?.trim() ?? '',
      input.attention?.trim() ?? '',
      input.gstin?.trim() ?? '',
      input.state?.trim() ?? '',
      input.contact?.trim() ?? '',
      input.email?.trim() ?? '',
      now,
      now,
    )
    return
  }

  // COALESCE(NULLIF(?, ''), column) — take the new value only when it says
  // something.
  db.prepare(
    `UPDATE customers SET
       name         = ?,
       address      = COALESCE(NULLIF(?, ''), address),
       attention    = COALESCE(NULLIF(?, ''), attention),
       gstin        = COALESCE(NULLIF(?, ''), gstin),
       state        = COALESCE(NULLIF(?, ''), state),
       contact      = COALESCE(NULLIF(?, ''), contact),
       email        = COALESCE(NULLIF(?, ''), email),
       quote_count  = quote_count + 1,
       last_used_at = ?
     WHERE id = ?`,
  ).run(
    name,
    input.address?.trim() ?? '',
    input.attention?.trim() ?? '',
    input.gstin?.trim() ?? '',
    input.state?.trim() ?? '',
    input.contact?.trim() ?? '',
    input.email?.trim() ?? '',
    now,
    existing.id,
  )
}
