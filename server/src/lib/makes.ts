import { getDb } from '../db/client.js'

/**
 * Brand extraction — CORRECTION 4.
 *
 * §6 makes two of its eight flag rows turn on brand ("A brand present in the
 * request is absent from the offer" / "Brand differs between the two"), and the
 * §11 fixture's second expected flag is a dropped "Black i". But §5 defines
 * regexes for quantity, rate, length and part code only — there is no brand
 * rule anywhere in the spec, and "Black i" is two words whose second token is a
 * lowercase single letter, so no capitalisation heuristic will ever find it.
 *
 * The fix is a lookup table rather than a pattern. It also carries the
 * manufacturer address §7 and §11 require ("A follow-up in the real thread
 * asked for the manufacturer's address for Ariba — Black i distributes from
 * Bengaluru 560002. Treat it as a requirement, not trivia."), so one table
 * closes both gaps.
 */

export interface Make {
  name: string
  manufacturerAddress: string
  /** Whole-phrase, case-insensitive, word-bounded. */
  pattern: RegExp
}

let cache: Make[] | null = null

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function loadMakes(): Make[] {
  if (cache) return cache

  const rows = getDb()
    .prepare('SELECT name, manufacturer_address FROM makes')
    .all() as Array<{ name: string; manufacturer_address: string }>

  cache = rows
    // Longest first so "Western Digital" is preferred over a bare "Western",
    // and a two-word make is never shadowed by a one-word prefix of itself.
    .sort((a, b) => b.name.length - a.name.length)
    .map((row) => ({
      name: row.name,
      manufacturerAddress: row.manufacturer_address,
      pattern: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(row.name)}(?![A-Za-z0-9])`, 'i'),
    }))

  return cache
}

/** Call after editing the makes table so the next lookup re-reads it. */
export function invalidateMakesCache(): void {
  cache = null
}

/**
 * The first make named anywhere in the line, or '' when none is.
 * Matching is on the RAW line, not the stripped description, because a brand
 * sometimes sits after the quantity.
 */
export function findMake(text: string): string {
  for (const make of loadMakes()) {
    if (make.pattern.test(text)) return make.name
  }
  return ''
}

/** §11 — the manufacturer address Ariba and SAP need to raise a PR. */
export function manufacturerAddress(makeName: string): string {
  if (!makeName) return ''
  const found = loadMakes().find((m) => m.name.toLowerCase() === makeName.toLowerCase())
  return found?.manufacturerAddress ?? ''
}

/**
 * Used by §6's brand rules. A brand counts as "present" in a line if the line
 * names it, regardless of the `make` field — an offer that dropped the brand
 * from its description is exactly the case we are trying to catch.
 */
export function mentionsMake(text: string, makeName: string): boolean {
  if (!makeName) return true
  const found = loadMakes().find((m) => m.name.toLowerCase() === makeName.toLowerCase())
  if (!found) return false
  return found.pattern.test(text)
}
