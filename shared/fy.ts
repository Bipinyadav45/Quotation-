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

function ordinal(day: number): string {
  // 11th, 12th and 13th are the exceptions that break the mod-10 rule.
  if (day >= 11 && day <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}

/**
 * The house format, taken verbatim from the sample quotation: "10th July 2026."
 * The trailing period is part of it — both the Date line and the Validity term
 * carry one.
 */
export function formatDateLong(date: Date): string {
  return `${ordinal(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}.`
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
