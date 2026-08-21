import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allocateRef, claimRef, formatRef, peekNextSeq } from './refno.js'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ref_counters (
    fy TEXT NOT NULL, initials TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (fy, initials)
  )
`

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(SCHEMA)
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

describe('allocation across separate connections', () => {
  // The in-memory tests above prove the sequence is gapless within one
  // connection. This proves the UPSERT ... RETURNING is atomic against a real
  // file with two connections interleaved — which is the situation a second
  // server process, or a restart mid-save, actually creates.
  it('never hands the same number to two connections', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'refno-'))
    const file = path.join(dir, 'quotes.db')
    const july = new Date(2026, 6, 10)

    const a = new Database(file)
    a.exec(SCHEMA)
    a.pragma('journal_mode = WAL')
    const b = new Database(file)
    b.pragma('journal_mode = WAL')

    try {
      const taken: number[] = []
      for (let i = 0; i < 50; i++) {
        taken.push(allocateRef(i % 2 === 0 ? a : b, july, 'RG').seq)
      }

      expect(new Set(taken).size).toBe(50)
      expect(taken).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    } finally {
      a.close()
      b.close()
      rmSync(dir, { recursive: true, force: true })
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

describe('claimRef — the desk chooses the number', () => {
  const july = new Date(2026, 6, 10)

  it('uses the number asked for and carries the counter to it', () => {
    // The ask that started this: 042 edited to 045, so the next one is 046.
    db.prepare('INSERT INTO ref_counters (fy, initials, last_seq) VALUES (?, ?, ?)').run(
      '2026-27', 'RG', 42,
    )

    expect(claimRef(db, july, 'RG', 45).ref).toBe('NCS/2026-27/Quotes/RG/045')
    expect(peekNextSeq(db, july, 'RG')).toBe(46)
    expect(allocateRef(db, july, 'RG').ref).toBe('NCS/2026-27/Quotes/RG/046')
  })

  it('starts a series that has none yet', () => {
    expect(claimRef(db, july, 'RG', 7).ref).toBe('NCS/2026-27/Quotes/RG/007')
    expect(allocateRef(db, july, 'RG').seq).toBe(8)
  })

  it('never moves the counter backwards', () => {
    // 010 is a gap — a deleted quotation, say. Filling it must not rewind the
    // series, or the next ordinary save re-issues 011 to a second customer.
    claimRef(db, july, 'RG', 45)
    expect(claimRef(db, july, 'RG', 10).ref).toBe('NCS/2026-27/Quotes/RG/010')

    expect(peekNextSeq(db, july, 'RG')).toBe(46)
    expect(allocateRef(db, july, 'RG').seq).toBe(46)
  })

  it('claiming the number the counter already sits on leaves it there', () => {
    claimRef(db, july, 'RG', 45)
    claimRef(db, july, 'RG', 45)
    expect(peekNextSeq(db, july, 'RG')).toBe(46)
  })

  it('moves only its own series', () => {
    claimRef(db, july, 'RG', 45)
    expect(peekNextSeq(db, july, 'SK')).toBe(1)
    // A different financial year is a different series too (§7).
    expect(peekNextSeq(db, new Date(2027, 3, 1), 'RG')).toBe(1)
  })

  it('refuses a number that is not a positive whole one', () => {
    for (const bad of [0, -3, 4.5, Number.NaN]) {
      expect(() => claimRef(db, july, 'RG', bad)).toThrow(/whole number/i)
    }
    // And nothing was written on the way to refusing.
    expect(peekNextSeq(db, july, 'RG')).toBe(1)
  })

  it('refuses to claim without initials', () => {
    expect(() => claimRef(db, july, '   ', 45)).toThrow(/initials/i)
  })

  it('is atomic against a second connection, exactly as allocateRef is', () => {
    // Same situation as the interleaving test above: two connections on one
    // file. A claim that read-then-wrote could lose to the allocate landing
    // between its read and its write, and hand 101 out twice.
    const dir = mkdtempSync(path.join(tmpdir(), 'refno-claim-'))
    const file = path.join(dir, 'quotes.db')

    const a = new Database(file)
    a.exec(SCHEMA)
    a.pragma('journal_mode = WAL')
    const b = new Database(file)
    b.pragma('journal_mode = WAL')

    try {
      expect(claimRef(a, july, 'RG', 100).seq).toBe(100)
      expect(allocateRef(b, july, 'RG').seq).toBe(101)
      expect(claimRef(b, july, 'RG', 50).seq).toBe(50)
      expect(allocateRef(a, july, 'RG').seq).toBe(102)
    } finally {
      a.close()
      b.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
