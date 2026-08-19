import { describe, expect, it } from 'vitest'
import type { ParsedLine } from '@shared/schema'
import { itemsFromLines } from './draft.js'

const line = (over: Partial<ParsedLine>): ParsedLine => ({
  id: 'x',
  raw: '',
  desc: 'Widget',
  make: '',
  partCode: '',
  qty: 0,
  rate: 0,
  role: 'offer',
  source: 'pattern',
  ...over,
})

describe('quantity when the thread never stated one', () => {
  it('is 1, not 0 — 0 prices the line at nothing and zeroes the total', () => {
    const { items } = itemsFromLines([line({ qty: 0, rate: 10_450_000 })])
    expect(items[0]!.qty).toBe(1)
    expect(items[0]!.qty * items[0]!.rate).toBe(10_450_000)
  })

  it('never overrides a quantity the thread did state', () => {
    const { items } = itemsFromLines([line({ qty: 25, rate: 8_300_000 })])
    expect(items[0]!.qty).toBe(25)
  })

  it('counts what it assumed, so the screen can say so', () => {
    const { assumedQty } = itemsFromLines([
      line({ qty: 0, rate: 100 }),
      line({ qty: 0, rate: 200 }),
      line({ qty: 4, rate: 300 }),
    ])
    expect(assumedQty).toBe(2)
  })

  it('assumes nothing when every line stated a quantity', () => {
    const { assumedQty } = itemsFromLines([line({ qty: 2, rate: 100 })])
    expect(assumedQty).toBe(0)
  })
})

describe('which lines become the quotation', () => {
  it('quotes the priced lines when the thread has any', () => {
    const { items } = itemsFromLines([
      line({ desc: 'Dock', qty: 0, rate: 275_000 }),
      line({ desc: 'Dock', qty: 1, rate: 0, role: 'request' }),
    ])
    // Listing both would put a zero-priced duplicate on the quotation.
    expect(items).toHaveLength(1)
    expect(items[0]!.rate).toBe(275_000)
  })

  it('lists what it set aside rather than dropping it, quantity included', () => {
    const { setAside } = itemsFromLines([
      line({ desc: 'Dock', rate: 275_000 }),
      line({ desc: 'HP Pro Tower 280 G9', qty: 25, rate: 0, role: 'request' }),
    ])
    // That quantity is often the only place the customer stated one.
    expect(setAside).toEqual(['HP Pro Tower 280 G9  (qty 25)'])
  })

  it('quotes every line when nothing in the thread carries a price', () => {
    const { items, setAside } = itemsFromLines([
      line({ desc: 'desktop', qty: 4, rate: 0, role: 'request' }),
      line({ desc: 'tft', qty: 0, rate: 0, role: 'request' }),
    ])
    expect(items.map((i) => i.desc)).toEqual(['desktop', 'tft'])
    expect(items.map((i) => i.qty)).toEqual([4, 1])
    expect(setAside).toEqual([])
  })

  it('takes only the first line of a multi-line description into the set-aside list', () => {
    const { setAside } = itemsFromLines([
      line({ desc: 'Dock', rate: 100 }),
      line({ desc: 'HP Pro Tower\ni5-13500/16GB DDR4', qty: 25, rate: 0, role: 'request' }),
    ])
    expect(setAside).toEqual(['HP Pro Tower  (qty 25)'])
  })
})
