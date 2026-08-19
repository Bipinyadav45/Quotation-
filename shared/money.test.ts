import { describe, expect, it } from 'vitest'
import {
  amountInWords,
  computeTotals,
  formatPaise,
  lineAmountPaise,
  numberToIndianWords,
  parseRupeesToPaise,
} from './money.js'

describe('parseRupeesToPaise', () => {
  it('parses the rate formats that appear in real threads', () => {
    expect(parseRupeesToPaise('550')).toBe(55_000)
    expect(parseRupeesToPaise('1,250')).toBe(125_000)
    expect(parseRupeesToPaise('1,250.00')).toBe(125_000)
    expect(parseRupeesToPaise('2750')).toBe(275_000)
    expect(parseRupeesToPaise('3,450')).toBe(345_000)
    expect(parseRupeesToPaise('₹ 1,250.50')).toBe(125_050)
    expect(parseRupeesToPaise('1250.5')).toBe(125_050)
  })

  it('returns null rather than quoting zero for junk', () => {
    expect(parseRupeesToPaise('')).toBeNull()
    expect(parseRupeesToPaise('abc')).toBeNull()
    expect(parseRupeesToPaise('12.345')).toBeNull()
  })
})

describe('formatPaise — §7 Indian digit grouping', () => {
  it('groups the Indian way, never the western way', () => {
    expect(formatPaise(15_000_000)).toBe('1,50,000.00')
    expect(formatPaise(15_000_000)).not.toBe('150,000.00')
  })

  it('always shows two decimals', () => {
    expect(formatPaise(0)).toBe('0.00')
    expect(formatPaise(110_000)).toBe('1,100.00')
    expect(formatPaise(1_357_000)).toBe('13,570.00')
    expect(formatPaise(5)).toBe('0.05')
    expect(formatPaise(-110_000)).toBe('-1,100.00')
  })

  it('is exact at values where float division would drift', () => {
    // 0.1 + 0.2 !== 0.3 is why this module never divides in floating point.
    expect(formatPaise(10 + 20)).toBe('0.30')
    expect(formatPaise(999_999_999)).toBe('99,99,999.99')
  })
})

describe('numberToIndianWords — crore and lakh boundaries', () => {
  it('handles the boundaries', () => {
    expect(numberToIndianWords(0)).toBe('Zero')
    expect(numberToIndianWords(99)).toBe('Ninety Nine')
    expect(numberToIndianWords(100)).toBe('One Hundred')
    expect(numberToIndianWords(1_000)).toBe('One Thousand')
    expect(numberToIndianWords(99_999)).toBe('Ninety Nine Thousand Nine Hundred Ninety Nine')
    expect(numberToIndianWords(100_000)).toBe('One Lakh')
    expect(numberToIndianWords(150_000)).toBe('One Lakh Fifty Thousand')
    expect(numberToIndianWords(9_999_999)).toBe(
      'Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine',
    )
    expect(numberToIndianWords(10_000_000)).toBe('One Crore')
    expect(numberToIndianWords(12_345_678)).toBe(
      'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight',
    )
  })

  it('recurses past ninety-nine crore', () => {
    expect(numberToIndianWords(1_000_000_000)).toBe('One Hundred Crore')
  })
})

describe('amountInWords', () => {
  it('produces §11 expected wording', () => {
    expect(amountInWords(1_357_000)).toBe('Rupees Thirteen Thousand Five Hundred Seventy Only')
  })

  it('§7 — includes paise only when non-zero', () => {
    expect(amountInWords(110_000)).toBe('Rupees One Thousand One Hundred Only')
    expect(amountInWords(110_050)).toBe('Rupees One Thousand One Hundred and Fifty Paise Only')
  })
})

describe('computeTotals — §7 rounding rule', () => {
  const items = [
    { qty: 2, rate: 55_000 },
    { qty: 2, rate: 85_000 },
    { qty: 2, rate: 125_000 },
    { qty: 1, rate: 275_000 },
    { qty: 1, rate: 345_000 },
  ]

  it('reproduces the §11 expected totals exactly', () => {
    const totals = computeTotals(items, 'IGST', 18)
    expect(formatPaise(totals.sub)).toBe('11,500.00')
    expect(formatPaise(totals.tax)).toBe('2,070.00')
    expect(formatPaise(totals.total)).toBe('13,570.00')
    // The letterhead says "GST 18%"; that is the word the document uses.
    expect(totals.taxRows).toEqual([{ label: 'GST 18%', paise: 207_000 }])
  })

  it('splits into two rows for an in-state customer', () => {
    const totals = computeTotals(items, 'CGST+SGST', 18)
    expect(totals.taxRows.map((r) => r.label)).toEqual(['CGST 9%', 'SGST 9%'])
    expect(totals.tax).toBe(207_000)
    expect(formatPaise(totals.total)).toBe('13,570.00')
  })

  it('does not round intermediate lines', () => {
    // 3 x 33.33 = 99.99 exactly. A per-line round would give 100.00.
    const totals = computeTotals([{ qty: 3, rate: 3_333 }], 'IGST', 18)
    expect(totals.sub).toBe(9_999)
    expect(formatPaise(totals.sub)).toBe('99.99')
  })

  it('line amounts stay exact across many lines', () => {
    const many = Array.from({ length: 1000 }, () => ({ qty: 3, rate: 3_333 }))
    const totals = computeTotals(many, 'IGST', 18)
    expect(totals.sub).toBe(1000 * lineAmountPaise(3, 3_333))
  })
})
