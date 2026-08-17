import { describe, expect, it } from 'vitest'
import type { ParsedLine } from '@shared/schema.js'
import { SAMPLE_THREAD } from '@shared/sample.js'
import { parseThread } from './parser.js'
import { countNeedingReview, flagsFor, hasBlockingFlags, reconcile } from './reconcile.js'

const pairs = reconcile(parseThread(SAMPLE_THREAD))

describe('reconcile — the §11 golden fixture', () => {
  it('produces five pairs, every one matched', () => {
    expect(pairs).toHaveLength(5)
    expect(pairs.every((p) => p.request !== null && p.offer !== null)).toBe(true)
  })

  it('pairs each request with its own offer, not a near neighbour', () => {
    // The failure CORRECTION 3 exists to prevent: under §6 as written, lines 1
    // and 2 scored identically against both offers and pairing was decided by
    // iteration order.
    expect(pairs.map((p) => p.request!.desc)).toEqual([
      'Black i USB-C to USB-A 1.5 mtr',
      'Black i USB-C to USB-C 1 mtr',
      'Black i Lightning to USB A 1.5 mtr',
      'Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP',
      'Logitech Wireless Keyboard and Mouse Set #MK540',
    ])
    expect(pairs.map((p) => p.offer!.desc)).toEqual([
      'Black i USB-C to USB-A 1.5 mtr',
      'Black i USB-C to USB-C 1.5 mtr',
      'Lightning to USB A 1.5 mtr',
      'Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP',
      'Logitech Wireless Keyboard and Mouse Set #MK540',
    ])
  })

  it('raises EXACTLY the two flags §11 expects, and nothing else', () => {
    const raised = pairs.flatMap((pair, index) =>
      pair.flags.map((flag) => ({ line: index + 1, kind: flag.kind, severity: flag.severity })),
    )

    expect(raised).toEqual([
      { line: 2, kind: 'spec', severity: 'block' },
      { line: 3, kind: 'brand', severity: 'block' },
    ])
  })

  it('explains the length drift in the customer’s terms', () => {
    expect(pairs[1]!.flags[0]!.text).toBe('Customer asked 1 mtr, quote says 1.5 mtr.')
  })

  it('explains the dropped brand', () => {
    expect(pairs[2]!.flags[0]!.text).toBe('Make "Black i" dropped from the quoted description.')
  })

  it('clamps the stored score to §4’s 0..1 despite the part-code bonus', () => {
    expect(pairs.every((p) => p.score >= 0 && p.score <= 1)).toBe(true)
    expect(pairs[3]!.score).toBe(1)
  })

  it('reports two lines needing a look, and blocks the one-click path', () => {
    expect(countNeedingReview(pairs)).toBe(2)
    expect(hasBlockingFlags(pairs)).toBe(true)
  })
})

// --- every §6 flag type, each with its own minimal fixture ------------------

const line = (over: Partial<ParsedLine>): ParsedLine => ({
  id: 'x',
  raw: '',
  desc: '',
  make: '',
  partCode: '',
  qty: 1,
  rate: 100_000,
  role: 'request',
  source: 'pattern',
  ...over,
})

describe('§6 flag table — one fixture per row', () => {
  it('spec / block — first length value differs', () => {
    const flags = flagsFor(
      line({ raw: 'Cable 1 mtr', desc: 'Cable 1 mtr' }),
      line({ raw: 'Cable 1.5 mtr', desc: 'Cable 1.5 mtr', role: 'offer' }),
    )
    expect(flags).toEqual([
      { kind: 'spec', text: 'Customer asked 1 mtr, quote says 1.5 mtr.', severity: 'block' },
    ])
  })

  it('brand / block — a brand in the request is absent from the offer', () => {
    const flags = flagsFor(
      line({ raw: 'Black i Lightning cable', desc: 'Black i Lightning cable', make: 'Black i' }),
      line({ raw: 'Lightning cable', desc: 'Lightning cable', role: 'offer' }),
    )
    expect(flags).toEqual([
      {
        kind: 'brand',
        text: 'Make "Black i" dropped from the quoted description.',
        severity: 'block',
      },
    ])
  })

  it('brand / block — brand differs between the two', () => {
    const flags = flagsFor(
      line({ raw: 'Black i keyboard', desc: 'Black i keyboard', make: 'Black i' }),
      line({ raw: 'Logitech keyboard', desc: 'Logitech keyboard', make: 'Logitech', role: 'offer' }),
    )
    expect(flags).toEqual([
      {
        kind: 'brand',
        text: 'Customer asked for Black i, quote says Logitech.',
        severity: 'block',
      },
    ])
  })

  it('code / block — a part code in the request is missing from the offer', () => {
    const flags = flagsFor(
      line({ raw: 'Docking Station BI-TCHUGP', desc: 'Docking Station', partCode: 'BI-TCHUGP' }),
      line({ raw: 'Docking Station', desc: 'Docking Station', role: 'offer' }),
    )
    expect(flags).toEqual([
      {
        kind: 'code',
        text: 'Part code BI-TCHUGP is missing from the quoted line.',
        severity: 'block',
      },
    ])
  })

  it('qty / warn — quantities differ', () => {
    const flags = flagsFor(
      line({ raw: 'Cable', desc: 'Cable', qty: 2 }),
      line({ raw: 'Cable', desc: 'Cable', qty: 1, role: 'offer' }),
    )
    expect(flags).toEqual([
      { kind: 'qty', text: 'Customer asked for 02, quote has 01.', severity: 'warn' },
    ])
  })

  it('qty — an offer that simply omits the quantity is not a disagreement', () => {
    const flags = flagsFor(
      line({ raw: 'Cable', desc: 'Cable', qty: 2 }),
      line({ raw: 'Cable', desc: 'Cable', qty: 0, role: 'offer' }),
    )
    expect(flags.some((f) => f.kind === 'qty')).toBe(false)
  })

  it('price / block — offer has no rate', () => {
    const flags = flagsFor(
      line({ raw: 'Cable', desc: 'Cable' }),
      line({ raw: 'Cable', desc: 'Cable', rate: 0, role: 'offer' }),
    )
    expect(flags).toEqual([{ kind: 'price', text: 'No rate on the quoted line.', severity: 'block' }])
  })

  it('missing / block — requested line has no matching offer', () => {
    const result = reconcile([
      line({ id: 'r1', raw: 'Blue widget 3 mtr', desc: 'Blue widget 3 mtr', rate: 0 }),
      line({
        id: 'o1',
        raw: 'Completely unrelated keyboard',
        desc: 'Completely unrelated keyboard',
        role: 'offer',
      }),
    ])
    const missing = result.find((p) => p.request !== null && p.offer === null)
    expect(missing?.flags).toEqual([
      { kind: 'missing', text: 'Requested but not quoted.', severity: 'block' },
    ])
  })

  it('extra / warn — offer has no matching request', () => {
    const result = reconcile([
      line({ id: 'r1', raw: 'Blue widget 3 mtr', desc: 'Blue widget 3 mtr', rate: 0 }),
      line({
        id: 'o1',
        raw: 'Completely unrelated keyboard',
        desc: 'Completely unrelated keyboard',
        role: 'offer',
      }),
    ])
    const extra = result.find((p) => p.request === null && p.offer !== null)
    expect(extra?.flags).toEqual([
      { kind: 'extra', text: 'Quoted but not requested.', severity: 'warn' },
    ])
  })

  it('raises several flags on one line when several things drifted', () => {
    const flags = flagsFor(
      line({
        raw: 'Black i cable 1 mtr BI-TCHUGP',
        desc: 'Black i cable 1 mtr',
        make: 'Black i',
        partCode: 'BI-TCHUGP',
        qty: 2,
      }),
      line({ raw: 'cable 1.5 mtr', desc: 'cable 1.5 mtr', qty: 1, rate: 0, role: 'offer' }),
    )
    expect(flags.map((f) => f.kind).sort()).toEqual(['brand', 'code', 'price', 'qty', 'spec'])
  })

  it('a clean pair raises nothing', () => {
    const flags = flagsFor(
      line({ raw: 'Black i cable 1.5 mtr', desc: 'Black i cable 1.5 mtr', make: 'Black i', qty: 2 }),
      line({
        raw: 'Black i cable 1.5 mtr',
        desc: 'Black i cable 1.5 mtr',
        make: 'Black i',
        qty: 2,
        role: 'offer',
      }),
    )
    expect(flags).toEqual([])
  })
})

describe('reconcile — degenerate inputs', () => {
  it('handles an empty thread', () => {
    expect(reconcile([])).toEqual([])
  })

  it('handles requests with no offers at all', () => {
    const result = reconcile([line({ id: 'r1', raw: 'Cable', desc: 'Cable', rate: 0 })])
    expect(result).toHaveLength(1)
    expect(result[0]!.flags[0]!.kind).toBe('missing')
  })

  it('handles offers with no requests at all', () => {
    const result = reconcile([line({ id: 'o1', raw: 'Cable', desc: 'Cable', role: 'offer' })])
    expect(result).toHaveLength(1)
    expect(result[0]!.flags[0]!.kind).toBe('extra')
  })
})
