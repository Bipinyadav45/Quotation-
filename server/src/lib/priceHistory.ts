import { getDb } from '../db/client.js'
import { similarity, tokenize } from './similarity.js'

/**
 * What did we last quote this for?
 *
 * Every rate ever quoted is already in `quote_items`; this reads it back. No
 * API call — SQL and the matcher already in the repository answer it instantly
 * and for nothing, and a price is exactly the kind of fact that should come
 * from records rather than from a model.
 *
 * It never fills a rate in. A stale price applied silently is precisely the
 * failure this application exists to catch; the desk clicks to accept one.
 */

/**
 * Identity is a stricter question than pairing, and needs a stricter test.
 *
 * §6's 0.42 is a PAIRING threshold: it decided which of several candidate
 * offers went with a request, and the best one won because they competed. Here
 * there is no competition — a single past line either gets offered as this
 * product's price or does not. At 0.42, "USB-C to USB-A 1.5 mtr" scores 0.909
 * against "USB-C to USB-C 1.5 mtr" and the wrong cable's price is offered.
 *
 * So two conditions, not one:
 *
 *   1. the VARIANT MARKERS must be identical — the hyphenated compounds and
 *      number+unit tokens that Correction 3 exists to preserve are exactly what
 *      separates usb-a from usb-c and 1mtr from 1.5mtr;
 *   2. the rest of the wording must still be close.
 *
 * A brand dropped from a description ("Lightning to USB A 1.5 mtr" for
 * "Black i Lightning to USB A 1.5 mtr") passes both, and should — it is the
 * same cable. "HP 1TB SSD" against "Dell 1TB SSD" shares a variant marker but
 * fails the wording test, and would otherwise offer one manufacturer's price
 * for another's.
 */
const PRICE_MATCH_THRESHOLD = 0.75

/**
 * The tokens that distinguish one variant of a product from another: anything
 * hyphenated (usb-c, bi-tchugp) or starting with a digit (1.5mtr, 16gb).
 */
function variantMarkers(tokens: Set<string>): string {
  return [...tokens]
    .filter((t) => t.includes('-') || /^\d/.test(t))
    .sort()
    .join('|')
}

export interface PriceMatch {
  ratePaise: number
  description: string
  partCode: string
  customerName: string
  ref: string
  revision: number
  /** YYYY-MM-DD of the quotation it came from. */
  date: string
  /** How many past lines matched this product. */
  timesQuoted: number
  /** 'part-code' is unambiguous; 'description' is a fuzzy match. */
  via: 'part-code' | 'description'
}

interface Row {
  description: string
  part_code: string
  make: string
  rate_paise: number
  customer_name: string
  ref: string
  revision: number
  date: string
  created_at: string
}

/** Most recent first, so the newest price for a product wins. */
const RECENT_ITEMS = `
  SELECT i.description, i.part_code, i.make, i.rate_paise,
         q.customer_name, q.ref, q.revision, q.date, q.created_at
    FROM quote_items i
    JOIN quotes q ON q.id = i.quote_id
   WHERE i.rate_paise > 0
`

const toMatch = (row: Row, timesQuoted: number, via: PriceMatch['via']): PriceMatch => ({
  ratePaise: row.rate_paise,
  description: row.description,
  partCode: row.part_code,
  customerName: row.customer_name,
  ref: row.ref,
  revision: row.revision,
  date: row.date,
  timesQuoted,
  via,
})

export interface LookupInput {
  desc: string
  partCode?: string
  /** When known on both sides, a different make is a different product. */
  make?: string
  /** Exclude a quotation from its own history, when revising one. */
  excludeQuoteId?: string
}

/**
 * The best few past prices for a product, newest first.
 *
 * A shared part code is unambiguous and wins outright. Otherwise the
 * description is matched with the same tokenizer the ask-vs-quote comparison
 * used, at the same threshold — so "USB-C to USB-A 1.5 mtr" does not return the
 * price of the USB-C to USB-C one.
 */
export function findPastPrices(input: LookupInput, limit = 3): PriceMatch[] {
  const db = getDb()
  const partCode = input.partCode?.trim().toUpperCase() ?? ''
  const exclude = input.excludeQuoteId ?? ''

  if (partCode !== '') {
    const rows = db
      .prepare(
        `${RECENT_ITEMS} AND upper(i.part_code) = ? AND q.id != ?
          ORDER BY q.created_at DESC`,
      )
      .all(partCode, exclude) as Row[]

    if (rows.length > 0) {
      // Distinct rates, newest first — the same product at two prices is worth
      // seeing, one product quoted eight times at one price is not.
      return distinctByRate(rows, rows.length, 'part-code').slice(0, limit)
    }
  }

  const desc = input.desc.trim()
  if (desc === '') return []

  const wanted = tokenize(desc)
  if (wanted.size === 0) return []
  const wantedMarkers = variantMarkers(wanted)
  const make = input.make?.trim().toLowerCase() ?? ''

  const rows = db
    .prepare(`${RECENT_ITEMS} AND q.id != ? ORDER BY q.created_at DESC LIMIT 500`)
    .all(exclude) as Row[]

  const scored = rows
    .map((row) => {
      const theirs = tokenize(row.description)
      return {
        row,
        markers: variantMarkers(theirs),
        score: similarity(
          wanted,
          theirs,
          partCode !== '' && row.part_code.toUpperCase() === partCode,
        ),
      }
    })
    .filter((s) => s.markers === wantedMarkers)
    .filter((s) => {
      // Two known and different manufacturers are two products, whatever the
      // wording similarity says.
      const theirMake = (s.row.make ?? '').trim().toLowerCase()
      return make === '' || theirMake === '' || theirMake === make
    })
    .filter((s) => s.score >= PRICE_MATCH_THRESHOLD)

  if (scored.length === 0) return []

  // Sort by how well it matches, then by recency — a close match from last
  // month beats a loose one from last year.
  scored.sort((a, b) => b.score - a.score || b.row.created_at.localeCompare(a.row.created_at))

  return distinctByRate(
    scored.map((s) => s.row),
    scored.length,
    'description',
  ).slice(0, limit)
}

/** One entry per distinct rate, keeping the first (best/newest) occurrence. */
function distinctByRate(rows: Row[], total: number, via: PriceMatch['via']): PriceMatch[] {
  const seen = new Set<number>()
  const out: PriceMatch[] = []
  for (const row of rows) {
    if (seen.has(row.rate_paise)) continue
    seen.add(row.rate_paise)
    out.push(toMatch(row, total, via))
  }
  return out
}
