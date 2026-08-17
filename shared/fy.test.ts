import { describe, expect, it } from 'vitest'
import { endOfMonth, financialYear, formatDateLong, fromISODate, toISODate } from './fy.js'

describe('financialYear — §7, April to March', () => {
  it('matches the sample quotation', () => {
    // The supplied Morgan Stanley quote is dated 10 July 2026 and carries
    // ref NCS/2026-27/Quotes/RG/030.
    expect(financialYear(new Date(2026, 6, 10))).toBe('2026-27')
  })

  it('rolls over on 1 April, not 1 January', () => {
    expect(financialYear(new Date(2026, 2, 31))).toBe('2025-26') // 31 March
    expect(financialYear(new Date(2026, 3, 1))).toBe('2026-27') // 1 April
    expect(financialYear(new Date(2026, 11, 31))).toBe('2026-27') // 31 December
    expect(financialYear(new Date(2027, 0, 1))).toBe('2026-27') // 1 January
    expect(financialYear(new Date(2027, 2, 31))).toBe('2026-27') // 31 March
    expect(financialYear(new Date(2027, 3, 1))).toBe('2027-28') // 1 April
  })

  it('pads the century rollover', () => {
    expect(financialYear(new Date(2099, 3, 1))).toBe('2099-00')
    expect(financialYear(new Date(2100, 3, 1))).toBe('2100-01')
  })
})

describe('formatDateLong — the house format', () => {
  it('matches the sample quotation exactly, trailing period included', () => {
    expect(formatDateLong(new Date(2026, 6, 10))).toBe('10th July 2026.')
    expect(formatDateLong(new Date(2026, 6, 31))).toBe('31st July 2026.')
  })

  it('gets the ordinal exceptions right', () => {
    expect(formatDateLong(new Date(2026, 0, 1))).toBe('1st January 2026.')
    expect(formatDateLong(new Date(2026, 0, 2))).toBe('2nd January 2026.')
    expect(formatDateLong(new Date(2026, 0, 3))).toBe('3rd January 2026.')
    expect(formatDateLong(new Date(2026, 0, 4))).toBe('4th January 2026.')
    // 11, 12, 13 are "th" despite ending in 1, 2, 3.
    expect(formatDateLong(new Date(2026, 0, 11))).toBe('11th January 2026.')
    expect(formatDateLong(new Date(2026, 0, 12))).toBe('12th January 2026.')
    expect(formatDateLong(new Date(2026, 0, 13))).toBe('13th January 2026.')
    expect(formatDateLong(new Date(2026, 0, 21))).toBe('21st January 2026.')
    expect(formatDateLong(new Date(2026, 0, 22))).toBe('22nd January 2026.')
    expect(formatDateLong(new Date(2026, 0, 23))).toBe('23rd January 2026.')
  })
})

describe('endOfMonth — §7 validity default', () => {
  it('finds the last day, including February in a leap year', () => {
    expect(formatDateLong(endOfMonth(new Date(2026, 6, 10)))).toBe('31st July 2026.')
    expect(formatDateLong(endOfMonth(new Date(2026, 1, 3)))).toBe('28th February 2026.')
    expect(formatDateLong(endOfMonth(new Date(2028, 1, 3)))).toBe('29th February 2028.')
  })
})

describe('ISO date round trip stays in local time', () => {
  it('does not drift a day across the timezone boundary', () => {
    const iso = '2026-07-10'
    const parsed = fromISODate(iso)
    expect(toISODate(parsed)).toBe(iso)
    expect(formatDateLong(parsed)).toBe('10th July 2026.')
  })
})
