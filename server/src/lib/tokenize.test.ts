import { describe, expect, it } from 'vitest'
import { MATCH_THRESHOLD, similarity, tokenize } from './tokenize.js'

/**
 * CORRECTION 3's regression suite.
 *
 * The first two tests are the ones that would have caught the flaw in §6 as
 * written: under the literal rule, both assertions fail because `USB-A` and
 * `USB-C` collapse to the same token set, and so do `1 mtr` and `1.5 mtr`.
 */

const R1 = 'Black i USB-C to USB-A 1.5 mtr'
const R2 = 'Black i USB-C to USB-C 1 mtr'
const O1 = 'Black i USB-C to USB-A 1.5 mtr'
const O2 = 'Black i USB-C to USB-C 1.5 mtr'
const R3 = 'Black i Lightning to USB A 1.5 mtr'
const O3 = 'Lightning to USB A 1.5 mtr'

describe('tokenize — the discriminators §6 discarded', () => {
  it('keeps the connector type: USB-A and USB-C are not the same token set', () => {
    const a = tokenize(R1)
    const b = tokenize(O2)
    expect(a.has('usb-a')).toBe(true)
    expect(b.has('usb-a')).toBe(false)
    expect(b.has('usb-c')).toBe(true)
    expect([...a].sort()).not.toEqual([...b].sort())
  })

  it('keeps the length: 1 mtr and 1.5 mtr are not the same token set', () => {
    const short = tokenize(R2)
    const long = tokenize(O2)
    expect(short.has('1mtr')).toBe(true)
    expect(long.has('1.5mtr')).toBe(true)
    expect([...short].sort()).not.toEqual([...long].sort())
  })

  it('still shares the parts of a hyphenated compound', () => {
    // Both really are USB, so `usb` should be common ground; only the compound
    // discriminates.
    expect(tokenize('USB-A cable').has('usb')).toBe(true)
    expect(tokenize('USB-C cable').has('usb')).toBe(true)
  })

  it('normalises unit spellings', () => {
    expect(tokenize('1.5 mtr').has('1.5mtr')).toBe(true)
    expect(tokenize('1.5 metre').has('1.5mtr')).toBe(true)
    expect(tokenize('1.5 meters').has('1.5mtr')).toBe(true)
    expect(tokenize('1.5m').has('1.5mtr')).toBe(true)
  })

  it('keeps §6 stop list and the length>=2 filter', () => {
    const tokens = tokenize('Logitech Wireless Keyboard and Mouse Set #MK540')
    expect(tokens.has('and')).toBe(false)
    expect(tokens.has('set')).toBe(false)
    expect(tokens.has('mk540')).toBe(true)
    expect(tokens.has('logitech')).toBe(true)
  })

  it('drops single characters, which is why "Black i" contributes only "black"', () => {
    const tokens = tokenize('Black i USB Type C Docking Station')
    expect(tokens.has('black')).toBe(true)
    expect(tokens.has('i')).toBe(false)
    expect(tokens.has('c')).toBe(false)
    expect(tokens.has('type')).toBe(false) // stop word
    expect(tokens.has('docking')).toBe(true)
  })
})

describe('similarity — the pairing preferences that matter', () => {
  const score = (a: string, b: string, code = false) =>
    similarity(tokenize(a), tokenize(b), code)

  it('an exact match beats a near match', () => {
    expect(score(R1, O1)).toBeCloseTo(1.0, 6)
    expect(score(R1, O2)).toBeCloseTo(10 / 11, 6)
    expect(score(R1, O1)).toBeGreaterThan(score(R1, O2))
  })

  it('the 1 mtr request prefers the 1.5 mtr USB-C offer over the USB-A one', () => {
    // Both offers are wrong about the length, but only one is right about the
    // connector. Under §6 as written these were both exactly 1.0.
    expect(score(R2, O2)).toBeCloseTo(0.8, 6)
    expect(score(R2, O1)).toBeCloseTo(8 / 11, 6)
    expect(score(R2, O2)).toBeGreaterThan(score(R2, O1))
  })

  it('the Lightning request prefers the Lightning offer', () => {
    expect(score(R3, O3)).toBeCloseTo(8 / 9, 6)
    expect(score(R3, O3)).toBeGreaterThan(score(R3, O1))
  })

  it('every fixture pairing clears §6 threshold with its own offer', () => {
    expect(score(R1, O1)).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
    expect(score(R2, O2)).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
    expect(score(R3, O3)).toBeGreaterThanOrEqual(MATCH_THRESHOLD)
  })

  it('applies §6 +0.35 part-code bonus', () => {
    const withoutBonus = score('Docking Station BI-TCHUGP', 'Docking Station BI-TCHUGP')
    const withBonus = score('Docking Station BI-TCHUGP', 'Docking Station BI-TCHUGP', true)
    expect(withBonus - withoutBonus).toBeCloseTo(0.35, 6)
  })

  it('scores unrelated products below the threshold', () => {
    expect(score(R1, 'Logitech Wireless Keyboard and Mouse Set')).toBeLessThan(MATCH_THRESHOLD)
  })
})
