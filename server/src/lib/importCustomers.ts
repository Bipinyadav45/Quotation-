import type BetterSqlite3 from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { INDIAN_STATES, normaliseGstin, stateForGstin } from '@shared/states.js'
import { clean, readSheet } from './xlsx.js'

/**
 * The Tally "List of Sundry Debtors with address and GSTIN" export, read into
 * the customer master.
 *
 * 002 built the master to fill itself from saved quotations, and said there
 * would never be a data-entry screen. There still isn't — this is not one. It
 * is the accounting system's own list, imported whole, and re-importable
 * whenever the desk exports a fresh copy: every row is matched on its LEDGER
 * NAME, which Tally guarantees unique, so a second import updates the rows that
 * are already there rather than making a second copy of the list.
 *
 * The one thing to understand before changing anything here: the names in this
 * list collide by design. Fourteen ledgers are some spelling of "Datamatics
 * Global Services Limited", seventeen some spelling of "Morgan Stanley", and
 * three Azentio sites share a single GSTIN. They are separate entities to bill
 * and the only thing that tells them apart is the address. Nothing in this file
 * may collapse two rows because their names match.
 */

/** The columns we need, matched by heading rather than by position. */
const COLUMNS = {
  name: ['particulars', 'name', 'ledger', 'ledger name'],
  address: ['address'],
  state: ['state'],
  country: ['country'],
  regType: ['registration type', 'registration'],
  gstin: ['gstin/uin', 'gstin', 'gstin / uin', 'gst no', 'gstin no'],
} as const

export interface DebtorRow {
  /** The Tally ledger name, verbatim. The identity of the row. */
  name: string
  address: string
  state: string
  country: string
  regType: string
  gstin: string
}

/** Something the desk should fix in Tally. Never a reason to skip a row. */
export interface ImportIssue {
  ledger: string
  message: string
}

export interface ParsedDebtors {
  debtors: DebtorRow[]
  issues: ImportIssue[]
}

/**
 * Tally joins a multi-line address into one cell with a comma, so the line
 * somebody typed ends up as "...5th Floor," and the next begins ", Light
 * Bridge". Two commas together is therefore a LINE BREAK, and it is the only
 * trace of one left: "Office No. 501 & 503, 5th Floor,, Light Bridge, Saki
 * Vihar Road,, Andheri-East, Mumbai-400072" is a three-line address, not a
 * paragraph.
 *
 * Restoring the breaks is not cosmetic. §11's address block prints one
 * paragraph per line — SAMPLE_CUSTOMER is stored exactly that way — so an
 * address imported flat prints as one long line that runs past the column, and
 * extractCustomer's lostLineStructure then spends every read repairing what
 * could have been stored correctly once.
 *
 * Some rows carry a real newline as well, where somebody made the Tally field
 * wrap. Both markers mean the same thing and both are honoured.
 */
export function addressLines(raw: string): string {
  return clean(raw)
    .split('\n')
    .flatMap((line) => line.split(/,{2,}/))
    // Tally leaves a trailing comma on the line it broke, a leading one on the
    // line after it, and a stray " ." at the end of a field somebody cleared.
    .map((line) => line.replace(/^[\s,.]+/, '').replace(/[\s,.]+$/, ''))
    .filter((line) => line !== '')
    .join('\n')
}

/** The list's own spelling of a state, or '' for one we do not recognise. */
function knownState(raw: string): string {
  const value = clean(raw).toLowerCase()
  return INDIAN_STATES.find((state) => state.toLowerCase() === value) ?? ''
}

/**
 * The ledger name as an identity key. Case and inner spacing are how a name was
 * typed, not what it is — but nothing more is folded than that. "AZENTIO
 * SOFTWARE PVT LTD (MALAD)" and "AZENTIO SOFTWARE PVT LTD (Vashi)" differ, and
 * must keep differing: they are two entities at one registration.
 */
export function ledgerKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

function headingRow(rows: string[][]): number {
  const wanted: readonly string[] = COLUMNS.name
  return rows.findIndex((row) => row.some((cell) => wanted.includes(clean(cell).toLowerCase())))
}

/**
 * Read the export.
 *
 * The heading row is found rather than assumed: this file carries the company
 * name and "All Parties under: Sundry Debtors" above it, and a future export
 * that adds or drops a title line must not silently shift every column by one.
 */
export function parseDebtors(file: Buffer): ParsedDebtors {
  const rows = readSheet(file)
  const at = headingRow(rows)
  if (at === -1) {
    throw new Error(
      'No heading row found — expected a column headed "Particulars". Export the Sundry ' +
        'Debtors list from Tally with column headings included.',
    )
  }

  const heading = rows[at]!.map((cell) => clean(cell).toLowerCase())
  const columnFor = (of: keyof typeof COLUMNS): number =>
    heading.findIndex((cell) => (COLUMNS[of] as readonly string[]).includes(cell))

  const column = {
    name: columnFor('name'),
    address: columnFor('address'),
    state: columnFor('state'),
    country: columnFor('country'),
    regType: columnFor('regType'),
    gstin: columnFor('gstin'),
  }
  if (column.gstin === -1) {
    throw new Error('No GSTIN column found — expected a column headed "GSTIN/UIN".')
  }

  const cell = (row: string[], index: number) => (index === -1 ? '' : clean(row[index] ?? ''))

  const debtors: DebtorRow[] = []
  const issues: ImportIssue[] = []
  const seen = new Set<string>()

  for (const row of rows.slice(at + 1)) {
    const name = cell(row, column.name)
    if (name === '') continue

    const country = cell(row, column.country) || 'India'
    const statedState = cell(row, column.state)
    const state = knownState(statedState)
    const rawGstin = cell(row, column.gstin)
    const gstin = normaliseGstin(rawGstin)

    /**
     * A malformed GSTIN is dropped rather than stored. It would otherwise land
     * on a document the customer's tax system reads, and extractCustomer's
     * guard drops stored GSTINs of the wrong shape anyway — keeping one only
     * moves the discovery to the day a customer rejects a quotation. The ledger
     * is named in the report instead, so it can be fixed where it is wrong.
     */
    if (rawGstin !== '' && gstin === '') {
      issues.push({
        ledger: name,
        message: `GSTIN "${rawGstin}" is not a valid 15-character GSTIN, so it was not imported.`,
      })
    }

    const registeredIn = gstin === '' ? null : stateForGstin(gstin)

    /**
     * Only worth saying for an Indian ledger: "Not Applicable" against a Hong
     * Kong address is the correct value, not a gap. Worth saying loudly when it
     * IS one, because a blank ship-to state quotes as IGST by default.
     *
     * The GSTIN's own state is named when there is one, because it turns the
     * report into an instruction — but it is NOT filled in. A GSTIN says where
     * the customer is REGISTERED and this field is where the goods SHIP, and
     * the two differ often enough that quietly equating them would be a tax
     * decision taken by an importer.
     */
    if (state === '' && country.toLowerCase() === 'india') {
      issues.push({
        ledger: name,
        message:
          `State "${statedState}" is not an Indian state we recognise, so the ship-to state ` +
          'was left blank — it decides IGST vs CGST+SGST.' +
          (registeredIn === null ? '' : ` The GSTIN is registered in ${registeredIn}.`),
      })
    }

    if (registeredIn !== null && state !== '' && registeredIn !== state) {
      issues.push({
        ledger: name,
        message: `State says ${state} but the GSTIN is registered in ${registeredIn}. One of the two is wrong in Tally.`,
      })
    }

    const key = ledgerKey(name)
    if (seen.has(key)) {
      issues.push({
        ledger: name,
        message:
          'Two ledgers share this name, so only the first was imported. Tally ledger names ' +
          'are unique — this export is not from one list.',
      })
      continue
    }
    seen.add(key)

    debtors.push({
      name,
      address: addressLines(column.address === -1 ? '' : (row[column.address] ?? '')),
      state,
      country,
      regType: cell(row, column.regType),
      gstin,
    })
  }

  return { debtors, issues }
}

export interface ImportResult {
  added: number
  updated: number
  unchanged: number
  issues: ImportIssue[]
}

/**
 * Upsert the export into the master, in one transaction.
 *
 * WHAT AN IMPORT OWNS, and what it does not. Address, state, GSTIN, country and
 * registration type are Tally's — a refreshed export overwrites them, because
 * the accounting system is where a customer's move or a new registration gets
 * recorded first. Everything the desk has learned by USING the row is left
 * alone: quote_count, last_used_at, and the salesperson's own contact and email
 * for this account. `attention` is left alone for the same reason — it is a
 * person somebody addressed a document to, and the debtors list has no opinion
 * about it.
 */
export function importDebtors(
  db: BetterSqlite3.Database,
  debtors: DebtorRow[],
  issues: ImportIssue[] = [],
): ImportResult {
  const now = new Date().toISOString()
  const result: ImportResult = { added: 0, updated: 0, unchanged: 0, issues }

  const find = db.prepare('SELECT * FROM customers WHERE ledger_key = ?')
  const insert = db.prepare(
    `INSERT INTO customers
       (id, name, address, attention, gstin, state, contact, email,
        ledger_key, source, country, reg_type, imported_at,
        quote_count, last_used_at, created_at)
     VALUES (?, ?, ?, '', ?, ?, '', '', ?, 'tally', ?, ?, ?, 0, ?, ?)`,
  )
  const update = db.prepare(
    `UPDATE customers SET
       name = ?, address = ?, gstin = ?, state = ?,
       country = ?, reg_type = ?, source = 'tally', imported_at = ?
     WHERE id = ?`,
  )
  /**
   * Nothing changed, but the row WAS in this export. Stamping it anyway is what
   * lets a ledger deleted from Tally be told from one that simply has not
   * moved — the first has an imported_at older than the last run, the second
   * does not. Nothing acts on that yet; recording it costs one UPDATE and not
   * recording it makes the question unanswerable after the fact.
   */
  const touch = db.prepare("UPDATE customers SET imported_at = ?, source = 'tally' WHERE id = ?")

  db.transaction(() => {
    for (const debtor of debtors) {
      const key = ledgerKey(debtor.name)
      const existing = find.get(key) as Record<string, unknown> | undefined

      if (!existing) {
        insert.run(
          randomUUID(),
          debtor.name,
          debtor.address,
          debtor.gstin,
          debtor.state,
          key,
          debtor.country,
          debtor.regType,
          now,
          now,
          now,
        )
        result.added++
        continue
      }

      const unchanged =
        existing.name === debtor.name &&
        existing.address === debtor.address &&
        existing.gstin === debtor.gstin &&
        existing.state === debtor.state &&
        existing.country === debtor.country &&
        existing.reg_type === debtor.regType

      if (unchanged) {
        touch.run(now, existing.id as string)
        result.unchanged++
        continue
      }

      update.run(
        debtor.name,
        debtor.address,
        debtor.gstin,
        debtor.state,
        debtor.country,
        debtor.regType,
        now,
        existing.id as string,
      )
      result.updated++
    }
  })()

  return result
}
