import type BetterSqlite3 from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'
import { ledgerKey } from './importCustomers.js'

/**
 * The customer master.
 *
 * It began as a table that filled itself from saved quotations. It still does
 * that — a company quoted for the first time is recorded on save — but it is
 * now seeded from the desk's Tally sundry debtors list, which is the accounting
 * system's own account of who Newtech bills. `npm run import:customers` loads
 * it and can be re-run on a fresh export.
 *
 * A CUSTOMER IS A LEDGER, NOT A NAME. This is the thing to hold on to. 002
 * declared identity to be the name and put a UNIQUE index on it; against the
 * real list that is wrong in a way that puts one company's GSTIN on another
 * company's quotation, because the list holds sixteen Datamatics ledgers,
 * seventeen Morgan Stanleys, and three Azentio sites sharing one registration.
 * 004 removed that index. Identity here is the row's `id`, and every path that
 * writes a quotation now carries it.
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
  /** Non-India for the five ledgers that are, and the reason `state` is blank. */
  country: string
  /** Tally's own: 'Regular', 'Regular - SEZ', 'Unregistered/Consumer'. */
  regType: string
  /** 'tally' — from the debtors export. 'quote' — learned from a save. */
  source: 'tally' | 'quote'
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
  country: (row.country as string) ?? 'India',
  regType: (row.reg_type as string) ?? '',
  source: (row.source as CustomerRecord['source']) ?? 'quote',
  quoteCount: row.quote_count as number,
  lastUsedAt: row.last_used_at as string,
})

/**
 * Every ledger, most recently quoted first.
 *
 * Read whole and filtered in JavaScript rather than searched in SQL, which is
 * the right shape at this size and says so out loud: the desk's list is 225
 * rows and reads in under a millisecond, while the matching that has to happen
 * over it — identity tokens, containment scoring, corporate-form stripping —
 * cannot be expressed in a LIKE clause and was actively harmed by trying. The
 * old query ranked by prefix and recency, neither of which is likeness.
 */
export function allCustomers(): CustomerRecord[] {
  return (
    getDb()
      .prepare('SELECT * FROM customers ORDER BY last_used_at DESC')
      .all() as Array<Record<string, unknown>>
  ).map(ROW_TO_RECORD)
}

export function findCustomerById(id: string): CustomerRecord | null {
  const row = getDb().prepare('SELECT * FROM customers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? ROW_TO_RECORD(row) : null
}

/**
 * The typeahead.
 *
 * Searches the ADDRESS as well as the name, because for three of these ledgers
 * the address is the only thing that differs — Azentio Ghansoli, Malad and
 * Vashi share a name and a GSTIN — and because "powai" is a reasonable thing to
 * type when you know where a customer sits but not how Tally spells them. The
 * GSTIN is searched too, for when it is pasted out of a mail.
 *
 * Ranking is explicit rather than emergent, so the list does not reshuffle
 * between keystrokes: a name that IS the query beats one that starts with it,
 * which beats one that merely contains it, which beats a hit found in the
 * address. Within a rank, whoever has been quoted more comes first.
 */
export function searchCustomers(query: string, limit = 8): CustomerRecord[] {
  const q = query.trim().toLowerCase()
  const all = allCustomers()
  if (q === '') return all.slice(0, limit)

  const scored: Array<{ record: CustomerRecord; rank: number }> = []
  for (const record of all) {
    const name = record.name.toLowerCase()
    let rank = 0
    if (name === q) rank = 5
    else if (name.startsWith(q)) rank = 4
    else if (name.includes(q)) rank = 3
    // Four characters before the GSTIN counts: "27" would otherwise match
    // every Maharashtra ledger on the list.
    else if (q.length >= 4 && record.gstin.toLowerCase().includes(q)) rank = 2
    else if (q.length >= 3 && record.address.toLowerCase().includes(q)) rank = 1

    if (rank > 0) scored.push({ record, rank })
  }

  return scored
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.record.quoteCount - a.record.quoteCount ||
        (a.record.lastUsedAt < b.record.lastUsedAt ? 1 : -1) ||
        a.record.name.localeCompare(b.record.name),
    )
    .slice(0, limit)
    .map((s) => s.record)
}

/**
 * The ledger with exactly this name, or null.
 *
 * Kept because a name typed identically to a ledger IS that ledger, and because
 * rememberCustomer needs it to avoid making a second row for a name saved
 * twice. It is NOT an identity lookup for the AI path any more, and nothing
 * should reintroduce it as one — `rankCandidates` answers that question, and
 * answers it with a list.
 */
export function findCustomerByName(name: string): CustomerRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM customers WHERE ledger_key = ?')
    .get(ledgerKey(name)) as Record<string, unknown> | undefined
  return row ? ROW_TO_RECORD(row) : null
}

export interface RememberInput {
  /**
   * The ledger this quotation was addressed to, when one was picked.
   *
   * Present means the desk SELECTED this customer, and the row it names is the
   * one updated — no name matching happens at all. That is what makes it safe
   * to correct a spelling on a quotation without silently forking a new ledger
   * or, worse, overwriting a different branch that happens to be spelled the
   * way you just typed.
   */
  id?: string
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

  /**
   * By id when the desk picked one, by ledger name only when they did not.
   *
   * The fallback is for a company quoted deliberately off the list — there is
   * no ledger to point at, and matching the name is all that is left. It is
   * safe HERE, unlike in the AI path, because this name was typed by the person
   * saving rather than read out of an email: an exact match on a name somebody
   * typed is a choice, not a guess.
   */
  const existing = (
    input.id !== undefined
      ? db.prepare('SELECT id FROM customers WHERE id = ?').get(input.id)
      : db.prepare('SELECT id FROM customers WHERE ledger_key = ?').get(ledgerKey(name))
  ) as { id: string } | undefined

  if (!existing) {
    db.prepare(
      `INSERT INTO customers
         (id, name, address, attention, gstin, state, contact, email,
          ledger_key, source, country, reg_type, imported_at,
          quote_count, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'quote', 'India', '', '', 1, ?, ?)`,
    ).run(
      randomUUID(),
      name,
      input.address?.trim() ?? '',
      input.attention?.trim() ?? '',
      input.gstin?.trim() ?? '',
      input.state?.trim() ?? '',
      input.contact?.trim() ?? '',
      input.email?.trim() ?? '',
      ledgerKey(name),
      now,
      now,
    )
    return
  }

  /**
   * The ledger_key follows the name, so renaming an off-list customer stays one
   * row. It is left alone for a row that came from Tally: that key is what a
   * re-import matches on, and moving it would make the next export insert a
   * duplicate rather than update this row.
   */
  // COALESCE(NULLIF(?, ''), column) — take the new value only when it says
  // something.
  db.prepare(
    `UPDATE customers SET
       name         = ?,
       ledger_key   = CASE WHEN source = 'tally' THEN ledger_key ELSE ? END,
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
    ledgerKey(name),
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
