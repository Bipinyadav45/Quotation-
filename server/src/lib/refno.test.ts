import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allocateRef, formatRef, peekNextSeq } from './refno.js'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE ref_counters (
      fy TEXT NOT NULL, initials TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (fy, initials)
    )
  `)
})

afterEach(() => db.close())

describe('formatRef — §7', () => {
  it('matches the house format and zero-pads to 3', () => {
    expect(formatRef('2026-27', 'RG', 31)).toBe('NCS/2026-27/Quotes/RG/031')
    expect(formatRef('2026-27', 'rg', 1)).toBe('NCS/2026-27/Quotes/RG/001')
    expect(formatRef('2026-27', 'RG', 999)).toBe('NCS/2026-27/Quotes/RG/999')
    // Past 999 it keeps counting rather than wrapping to 000.
    expect(formatRef('2026-27', 'RG', 1000)).toBe('NCS/2026-27/Quotes/RG/1000')
  })
})

describe('allocateRef', () => {
  const july = new Date(2026, 6, 10)

  it('continues the series the supplied sample belongs to', () => {
    // The real quote is .../RG/030, so the next allocation is 031.
    db.prepare('INSERT INTO ref_counters (fy, initials, last_seq) VALUES (?, ?, ?)').run(
      '2026-27', 'RG', 30,
    )
    expect(allocateRef(db, july, 'RG').ref).toBe('NCS/2026-27/Quotes/RG/031')
  })

  it('counts per salesperson, not globally', () => {
    expect(allocateRef(db, july, 'RG').seq).toBe(1)
    expect(allocateRef(db, july, 'SK').seq).toBe(1)
    expect(allocateRef(db, july, 'RG').seq).toBe(2)
  })

  it('§7 — restarts the sequence in a new financial year', () => {
    expect(allocateRef(db, new Date(2026, 6, 10), 'RG').ref).toBe('NCS/2026-27/Quotes/RG/001')
    expect(allocateRef(db, new Date(2027, 2, 31), 'RG').ref).toBe('NCS/2026-27/Quotes/RG/002')
    // 1 April starts a fresh series.
    expect(allocateRef(db, new Date(2027, 3, 1), 'RG').ref).toBe('NCS/2027-28/Quotes/RG/001')
  })

  it('refuses to allocate without initials', () => {
    expect(() => allocateRef(db, july, '   ')).toThrow(/initials/i)
  })

  it('allocates 200 references with no duplicates and no gaps', () => {
    const refs = Array.from({ length: 200 }, () => allocateRef(db, july, 'RG'))
    expect(new Set(refs.map((r) => r.ref)).size).toBe(200)
    expect(refs.map((r) => r.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1))
  })

  it('interleaved salespeople keep independent, gapless series', () => {
    const seqs: Record<string, number[]> = { RG: [], SK: [], AM: [] }
    for (let i = 0; i < 60; i++) {
      const who = (['RG', 'SK', 'AM'] as const)[i % 3]!
      seqs[who]!.push(allocateRef(db, july, who).seq)
    }
    for (const who of Object.keys(seqs)) {
      expect(seqs[who]).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    }
  })
})

describe('peekNextSeq', () => {
  it('does not burn a number — a page opened and abandoned costs nothing', () => {
    const july = new Date(2026, 6, 10)
    expect(peekNextSeq(db, july, 'RG')).toBe(1)
    expect(peekNextSeq(db, july, 'RG')).toBe(1)
    expect(peekNextSeq(db, july, 'RG')).toBe(1)
    // Only an actual save takes one.
    expect(allocateRef(db, july, 'RG').seq).toBe(1)
    expect(peekNextSeq(db, july, 'RG')).toBe(2)
  })
})
