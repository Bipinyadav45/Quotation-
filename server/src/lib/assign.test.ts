import { describe, expect, it } from 'vitest'
import { optimalAssignment } from './assign.js'

/**
 * Reference implementation: try every injective request -> offer mapping and
 * keep the best total. Correct by construction, unusable above n ≈ 8, and
 * exactly what we need to prove the Hungarian implementation right.
 */
function bruteForceBestTotal(scores: number[][]): number {
  const rows = scores.length
  const cols = scores[0]?.length ?? 0
  if (rows === 0 || cols === 0) return 0

  const used = new Array<boolean>(cols).fill(false)
  let best = Number.NEGATIVE_INFINITY

  const walk = (row: number, total: number): void => {
    if (row === rows) {
      best = Math.max(best, total)
      return
    }
    // A row may go unassigned — necessary when there are more requests than
    // offers, and harmless otherwise since all scores here are non-negative.
    walk(row + 1, total)
    for (let col = 0; col < cols; col++) {
      if (used[col]) continue
      used[col] = true
      walk(row + 1, total + scores[row]![col]!)
      used[col] = false
    }
  }

  walk(0, 0)
  return best
}

/** Deterministic PRNG so a failure is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('optimalAssignment', () => {
  it('beats greedy on the case greedy gets wrong', () => {
    // Greedy walks requests in order: req0 takes its best (offer0, 0.95),
    // leaving req1 with offer1 at 0.20 for a total of 1.15. The optimum is
    // req0->offer1 and req1->offer0, totalling 1.83.
    const scores = [
      [0.95, 0.9],
      [0.93, 0.2],
    ]
    const result = optimalAssignment(scores, 0.42)
    const total = result.reduce((acc, p) => acc + p.score, 0)
    expect(total).toBeCloseTo(1.83, 6)
    expect(result).toEqual([
      { requestIndex: 0, offerIndex: 1, score: 0.9 },
      { requestIndex: 1, offerIndex: 0, score: 0.93 },
    ])
  })

  it('matches brute force on 300 random matrices', () => {
    const rand = mulberry32(20260710)

    for (let trial = 0; trial < 300; trial++) {
      const rows = 1 + Math.floor(rand() * 6)
      const cols = 1 + Math.floor(rand() * 6)
      const scores = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => Math.round(rand() * 1000) / 1000),
      )

      // Threshold 0 so nothing is filtered and the totals are comparable.
      const total = optimalAssignment(scores, 0).reduce((acc, p) => acc + p.score, 0)
      expect(total).toBeCloseTo(bruteForceBestTotal(scores), 6)
    }
  })

  it('handles more requests than offers, and the reverse', () => {
    const wide = [[0.9, 0.8, 0.7]]
    expect(optimalAssignment(wide, 0.42)).toEqual([
      { requestIndex: 0, offerIndex: 0, score: 0.9 },
    ])

    const tall = [[0.9], [0.8], [0.7]]
    expect(optimalAssignment(tall, 0.42)).toEqual([
      { requestIndex: 0, offerIndex: 0, score: 0.9 },
    ])
  })

  it('§6 — drops pairings below the 0.42 threshold', () => {
    const scores = [
      [0.9, 0.1],
      [0.1, 0.2],
    ]
    const result = optimalAssignment(scores, 0.42)
    expect(result).toEqual([{ requestIndex: 0, offerIndex: 0, score: 0.9 }])
  })

  it('is deterministic — identical input, identical pairing, every run', () => {
    const scores = [
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
    ]
    const first = JSON.stringify(optimalAssignment(scores, 0.42))
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(optimalAssignment(scores, 0.42))).toBe(first)
    }
  })

  it('returns nothing for empty input', () => {
    expect(optimalAssignment([], 0.42)).toEqual([])
    expect(optimalAssignment([[]], 0.42)).toEqual([])
  })
})
