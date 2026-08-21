import type BetterSqlite3 from 'better-sqlite3'
import { financialYear } from '@shared/fy.js'

/**
 * Reference number allocation (§7).
 *
 *   NCS/<FY>/Quotes/<initials>/<seq>     e.g. NCS/2026-27/Quotes/RG/031
 *
 * "Sequence is per financial year, allocated by the server on save, zero-padded
 * to 3. Never allocate on page load; a page opened and abandoned must not burn
 * a number."
 *
 * The allocation is a single atomic UPSERT ... RETURNING, so two saves landing
 * at the same instant cannot take the same number — the second one sees the
 * first one's write. There is no read-then-write window to lose.
 */

export interface AllocatedRef {
  ref: string
  fy: string
  initials: string
  seq: number
}

export function formatRef(fy: string, initials: string, seq: number): string {
  return `NCS/${fy}/Quotes/${initials.toUpperCase()}/${String(seq).padStart(3, '0')}`
}

export function allocateRef(
  db: BetterSqlite3.Database,
  date: Date,
  initials: string,
): AllocatedRef {
  const fy = financialYear(date)
  const who = initials.trim().toUpperCase()
  if (who === '') throw new Error('Cannot allocate a reference without the salesperson’s initials')

  const row = db
    .prepare(
      `INSERT INTO ref_counters (fy, initials, last_seq)
       VALUES (?, ?, 1)
       ON CONFLICT (fy, initials) DO UPDATE SET last_seq = last_seq + 1
       RETURNING last_seq`,
    )
    .get(fy, who) as { last_seq: number }

  return { ref: formatRef(fy, who, row.last_seq), fy, initials: who, seq: row.last_seq }
}

/**
 * Take the number the desk chose instead of the next one in the series.
 *
 * "If the current document is 042 and I edited and change the doc to 045, then
 * the next doc which I create should start from 046" — so the counter is
 * dragged up to the chosen number in the same breath as the number is used.
 *
 * max(last_seq, excluded.last_seq) is what makes that a drag and never a reset.
 * A number BELOW the counter — filling a gap left by a deleted quotation — must
 * leave the counter where it is, or the next ordinary save hands out a
 * reference some existing document is already carrying.
 *
 * One statement, for the reason allocateRef is one statement: a read-then-write
 * would open a window in which a concurrent save takes the number this one is
 * about to claim.
 *
 * The reference returned is the number ASKED FOR, which is not always where the
 * counter ends up — claiming 010 while the counter sits at 045 gives .../010
 * and leaves the counter at 045.
 */
export function claimRef(
  db: BetterSqlite3.Database,
  date: Date,
  initials: string,
  seq: number,
): AllocatedRef {
  const fy = financialYear(date)
  const who = initials.trim().toUpperCase()
  if (who === '') throw new Error('Cannot allocate a reference without the salesperson’s initials')
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`A reference number must be a whole number from 1 upwards, not ${seq}`)
  }

  db.prepare(
    `INSERT INTO ref_counters (fy, initials, last_seq)
     VALUES (?, ?, ?)
     ON CONFLICT (fy, initials) DO UPDATE SET last_seq = max(last_seq, excluded.last_seq)`,
  ).run(fy, who, seq)

  return { ref: formatRef(fy, who, seq), fy, initials: who, seq }
}

/** Read the next number without taking it — for showing a preview only. */
export function peekNextSeq(db: BetterSqlite3.Database, date: Date, initials: string): number {
  const row = db
    .prepare('SELECT last_seq FROM ref_counters WHERE fy = ? AND initials = ?')
    .get(financialYear(date), initials.trim().toUpperCase()) as { last_seq: number } | undefined
  return (row?.last_seq ?? 0) + 1
}
