/**
 * Money, in integer paise.
 *
 * Nothing in this file ever divides by 100 in floating point. Rupees only exist
 * as strings for display and as strings on input; every intermediate value is an
 * integer number of paise. That is what makes §7's rounding rule
 *
 *   "compute per line as qty × rate, sum to subtotal, apply tax to the subtotal,
 *    round the total to 2 decimals. Do not round intermediate lines."
 *
 * exactly reproducible: `qty * ratePaise` is an exact integer, so line amounts
 * and the subtotal are never rounded at all. The single rounding step is the
 * tax, and it rounds to whole paise.
 */

const UNITS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/**
 * "1,250.00" | "1250" | "₹ 2750" | 1250.5  ->  paise
 * Returns null when the input is not a number, so callers can show a field error
 * rather than silently quoting zero.
 */
export function parseRupeesToPaise(input: string | number): number | null {
  const cleaned = String(input).trim().replace(/[₹,\s]/g, '')
  if (cleaned === '') return null

  const m = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned)
  if (!m) return null

  const [, sign, whole = '', frac = ''] = m
  if (whole === '' && frac === '') return null

  const rupees = whole === '' ? 0 : Number(whole)
  const paise = Number(frac.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(rupees)) return null

  const total = rupees * 100 + paise
  return sign === '-' ? -total : total
}

/**
 * §7 — Indian digit grouping, always two decimals: 1,50,000.00 (never 150,000.00).
 * Grouping is applied to the rupee part as an integer, so no float ever touches it.
 */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(paise))
  const rupees = Math.floor(abs / 100)
  const remainder = abs % 100
  return `${sign}${rupees.toLocaleString('en-IN')}.${String(remainder).padStart(2, '0')}`
}

/** §7 — serial numbers and quantities zero-padded to 2 digits, matching house style. */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 0..999 -> "Nine Hundred Ninety Nine" */
function underThousand(n: number): string {
  const parts: string[] = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100

  if (hundreds > 0) parts.push(`${UNITS[hundreds]} Hundred`)
  if (rest > 0) {
    if (rest < 20) parts.push(UNITS[rest]!)
    else {
      const tens = TENS[Math.floor(rest / 10)]!
      const ones = rest % 10
      parts.push(ones > 0 ? `${tens} ${UNITS[ones]}` : tens)
    }
  }
  return parts.join(' ')
}

/** Whole number to words on the Indian system: crore, lakh, thousand, hundred. */
export function numberToIndianWords(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (n === 0) return 'Zero'
  if (n < 0) return `Minus ${numberToIndianWords(-n)}`

  let remaining = Math.trunc(n)
  const parts: string[] = []

  const crore = Math.floor(remaining / 10_000_000)
  remaining %= 10_000_000
  const lakh = Math.floor(remaining / 100_000)
  remaining %= 100_000
  const thousand = Math.floor(remaining / 1_000)
  remaining %= 1_000

  // Recurse on crore so values above 99 crore still read correctly.
  if (crore > 0) parts.push(`${numberToIndianWords(crore)} Crore`)
  if (lakh > 0) parts.push(`${underThousand(lakh)} Lakh`)
  if (thousand > 0) parts.push(`${underThousand(thousand)} Thousand`)
  if (remaining > 0) parts.push(underThousand(remaining))

  return parts.join(' ')
}

/**
 * §7 — "Rupees Thirteen Thousand Five Hundred Seventy Only".
 * Paise are included only when non-zero.
 */
export function amountInWords(paise: number): string {
  const abs = Math.abs(Math.trunc(paise))
  const rupees = Math.floor(abs / 100)
  const remainder = abs % 100

  const head = `Rupees ${numberToIndianWords(rupees)}`
  return remainder > 0
    ? `${head} and ${numberToIndianWords(remainder)} Paise Only`
    : `${head} Only`
}

// --- totals ----------------------------------------------------------------

export type TaxMode = 'IGST' | 'CGST+SGST'

export interface TaxRow {
  label: string
  paise: number
}

export interface Totals {
  sub: number
  taxRows: TaxRow[]
  tax: number
  total: number
}

/** Exact: both operands are integers. This is never rounded (§7). */
export function lineAmountPaise(qty: number, ratePaise: number): number {
  return Math.trunc(qty) * Math.trunc(ratePaise)
}

/**
 * §7 — sum the unrounded line amounts, apply tax to that subtotal, round to
 * whole paise. In CGST+SGST mode each half is computed and rounded on its own,
 * which is how the halves are printed and therefore how they must add up.
 */
export function computeTotals(
  items: ReadonlyArray<{ qty: number; rate: number }>,
  mode: TaxMode,
  ratePercent: number,
): Totals {
  const sub = items.reduce((acc, item) => acc + lineAmountPaise(item.qty, item.rate), 0)

  const taxRows: TaxRow[] =
    mode === 'CGST+SGST'
      ? (() => {
          const half = ratePercent / 2
          const each = Math.round((sub * half) / 100)
          return [
            { label: `CGST ${formatPercent(half)}%`, paise: each },
            { label: `SGST ${formatPercent(half)}%`, paise: each },
          ]
        })()
      : [
          {
            // The letterhead's own word is "GST 18%", so that is what a
            // single-row quotation says. §7 wanted "IGST" for an out-of-state
            // buyer, and that is arguably more correct — but both documents the
            // desk supplied say GST, and the instruction is to reproduce them.
            // One string, here, if that is ever revisited.
            label: `GST ${formatPercent(ratePercent)}%`,
            paise: Math.round((sub * ratePercent) / 100),
          },
        ]

  const tax = taxRows.reduce((acc, row) => acc + row.paise, 0)
  return { sub, taxRows, tax, total: sub + tax }
}

/** 18 -> "18", 9 -> "9", 2.5 -> "2.5" */
function formatPercent(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n)
}
