import { describe, expect, it } from 'vitest'
import { wordDiff } from './diff.js'

const changed = (parts: Array<{ text: string; changed: boolean }>) =>
  parts.filter((p) => p.changed).map((p) => p.text.trim())

const rebuilt = (parts: Array<{ text: string; changed: boolean }>) =>
  parts.map((p) => p.text).join('')

describe('wordDiff', () => {
  it('marks nothing when the two sides are identical', () => {
    const d = wordDiff('Black i USB-C to USB-A 1.5 mtr', 'Black i USB-C to USB-A 1.5 mtr')
    expect(changed(d.left)).toEqual([])
    expect(changed(d.right)).toEqual([])
  })

  it('pinpoints §11 line 2 — the length that changed', () => {
    const d = wordDiff('Black i USB-C to USB-C 1 mtr', 'Black i USB-C to USB-C 1.5 mtr')
    expect(changed(d.left)).toEqual(['1'])
    expect(changed(d.right)).toEqual(['1.5'])
  })

  it('pinpoints §11 line 3 — the brand that was dropped', () => {
    const d = wordDiff('Black i Lightning to USB A 1.5 mtr', 'Lightning to USB A 1.5 mtr')
    expect(changed(d.left)).toEqual(['Black i'])
    expect(changed(d.right)).toEqual([])
  })

  it('marks a substituted brand on both sides', () => {
    const d = wordDiff('Black i keyboard', 'Logitech keyboard')
    expect(changed(d.left)).toEqual(['Black i'])
    expect(changed(d.right)).toEqual(['Logitech'])
  })

  it('ignores case and punctuation when deciding what matches', () => {
    const d = wordDiff('USB-C, 1.5 mtr', 'usb-c 1.5 mtr')
    expect(changed(d.left)).toEqual([])
    expect(changed(d.right)).toEqual([])
  })

  it('never loses or reorders a character', () => {
    const left = 'Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP'
    const right = 'USB Type C Docking Station - BI-TCHUGP'
    const d = wordDiff(left, right)
    expect(rebuilt(d.left)).toBe(left)
    expect(rebuilt(d.right)).toBe(right)
  })

  it('does not highlight the gaps between words', () => {
    const d = wordDiff('a b c', 'a c')
    expect(d.left.filter((p) => p.changed).every((p) => p.text.trim() !== '')).toBe(true)
  })

  it('handles an empty side', () => {
    const d = wordDiff('Cable 1.5 mtr', '')
    expect(changed(d.left)).toEqual(['Cable 1.5 mtr'])
    expect(d.right).toEqual([])
  })
})
