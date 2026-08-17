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

/** Read the next number without taking it — for showing a preview only. */
export function peekNextSeq(db: BetterSqlite3.Database, date: Date, initials: string): number {
  const row = db
    .prepare('SELECT last_seq FROM ref_counters WHERE fy = ? AND initials = ?')
    .get(financialYear(date), initials.trim().toUpperCase()) as { last_seq: number } | undefined
  return (row?.last_seq ?? 0) + 1
}
