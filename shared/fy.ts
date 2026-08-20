/**
 * Financial year and the house date format.
 *
 * §7 — the financial year runs April to March, so 10 July 2026 falls in
 * "2026-27" and 31 March 2026 falls in "2025-26". The reference number carries
 * it: NCS/2026-27/Quotes/RG/031.
 */

/** Date -> "2026-27" */
export function financialYear(date: Date): string {
  const year = date.getFullYear()
  // getMonth() is 0-based, so March is 2 and April is 3.
  const startYear = date.getMonth() >= 3 ? year : year - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * A number's ordinal suffix inside a longer string: the "th" of "6th Floor".
 *
 * The lookbehind requires a digit in front, so it cannot fire on an ordinary
 * word ending in "st". Exported because the quotation RAISES these — both the
 * Word template and the on-screen preview need to find them, and finding them
 * two different ways is how the two drift apart.
 */
export const ORDINAL_SUFFIX_RE = /(?<=\d)(st|nd|rd|th)\b/gi

/** "st" | "nd" | "rd" | "th" — the suffix alone, without the number. */
function ordinalSuffix(day: number): string {
  // 11th, 12th and 13th are the exceptions that break the mod-10 rule.
  if (day >= 11 && day <= 13) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

/**
 * The house date in three pieces, because the quotation SUPERSCRIPTS the
 * ordinal — it reads "23^rd June 2026.", not "23rd June 2026." — and Word can
 * only raise a run, not part of one. So the document needs the suffix handed to
 * it separately rather than buried in the middle of a formatted string.
 */
export interface DateParts {
  /** "23" */
  day: string
  /** "rd" — the part that is raised */
  ordinal: string
  /** " June 2026." — including the leading space and the trailing period */
  rest: string
}

export function formatDateParts(date: Date): DateParts {
  return {
    day: String(date.getDate()),
    ordinal: ordinalSuffix(date.getDate()),
    rest: ` ${MONTHS[date.getMonth()]} ${date.getFullYear()}.`,
  }
}

/**
 * The house format, taken verbatim from the sample quotation: "10th July 2026."
 * The trailing period is part of it — both the Date line and the Validity term
 * carry one.
 *
 * Built by joining the parts rather than formatting separately, so the plain
 * string and the superscripted one can never disagree about a date.
 */
export function formatDateLong(date: Date): string {
  const { day, ordinal, rest } = formatDateParts(date)
  return `${day}${ordinal}${rest}`
}

/** §7 — validity defaults to the end of the current month. */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

/** Local-time YYYY-MM-DD, for <input type="date"> and the quotes.date column. */
export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse a YYYY-MM-DD as a LOCAL date. `new Date("2026-07-10")` is UTC and drifts. */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}
