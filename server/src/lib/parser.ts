import type { ParsedLine, Role } from '@shared/schema.js'
import { parseRupeesToPaise } from '@shared/money.js'
import { config } from '../config.js'
import { findMake } from './makes.js'

/**
 * The deterministic thread parser (§5).
 *
 * Every regex below is §5's, verbatim. The additions are called out where they
 * appear: extra skip patterns for real-thread noise, whitespace normalisation
 * before de-duplication, and a digit-or-hyphen guard on part codes.
 */

// §5, verbatim.
const QTY_RE = /\bqty\s*[-–:.]?\s*(?:nos?\.?\s*[-–:]?\s*)?(\d{1,4})\b/i
const RATE_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i
const LENGTH_RE = /(\d+(?:\.\d+)?)\s*(?:mtr|mtrs|meter|metre|m)\b/gi
const CODE_RE = /\b#?([A-Z]{2,}[-–]?[A-Z0-9]{3,})\b/g

// §5 — "excluding USB, TYPE, GST, INR".
const CODE_EXCLUSIONS = new Set(['USB', 'TYPE', 'GST', 'INR'])

/**
 * §5's skip list, plus the noise that real threads actually carry. Without
 * these, a signature block or a legal disclaimer in an ALL-CAPS footer produces
 * phantom item lines, and a false flag in the amber strip is worse than no
 * flag — it costs the strip its meaning.
 */
const SKIP_RE =
  /^(thanks|regards|dear|hi\b|on\s|from:|sent:|to:|cc:|subject:|tel|did|cell|please call|sent from my|get outlook|mailto:|disclaimer|confidential|this email|best\b|br\b|--)/i

const ON_HEADER_RE = /^\s*On\s+.+?\bwrote:\s*$/i
const FROM_HEADER_RE = /^\s*From:\s*(.+)$/i
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

interface Block {
  /** Lowercased email address of whoever wrote this block, '' when unknown. */
  sender: string
  lines: string[]
}

/**
 * §5 — "Split the thread into blocks on `On <Day>, <Mon> <D>, <YYYY> at <time>
 * <addr> wrote:` and on `From:` headers. Note the email address in each block
 * header so we know which side wrote it."
 */
export function splitBlocks(thread: string): Block[] {
  const blocks: Block[] = []
  let current: Block = { sender: '', lines: [] }

  for (const line of thread.split(/\r?\n/)) {
    if (ON_HEADER_RE.test(line) || FROM_HEADER_RE.test(line)) {
      if (current.lines.length > 0 || current.sender) blocks.push(current)
      current = { sender: EMAIL_RE.exec(line)?.[0]?.toLowerCase() ?? '', lines: [] }
      continue
    }
    current.lines.push(line)
  }

  if (current.lines.length > 0 || current.sender) blocks.push(current)
  return blocks
}

/** §6's `spec` rule compares the FIRST length value on each side. */
export function firstLength(text: string): number | null {
  LENGTH_RE.lastIndex = 0
  const match = LENGTH_RE.exec(text)
  LENGTH_RE.lastIndex = 0
  return match?.[1] ? Number(match[1]) : null
}

/** §5's part-code rule. */
export function extractPartCode(text: string): string {
  for (const match of text.matchAll(CODE_RE)) {
    const code = match[1]
    if (!code || CODE_EXCLUSIONS.has(code)) continue
    // Addition: a real part code carries a digit or a hyphen. Without this, an
    // ALL-CAPS line ("DOCKING STATION WITH ...") yields phantom codes, and a
    // phantom code raises a `code` block flag on a line that is perfectly fine.
    if (!/[0-9]/.test(code) && !code.includes('-') && !code.includes('–')) continue
    return code
  }
  return ''
}

/** §5 — strip leading bullets/numbering and trailing `, - :` from the description. */
function cleanDescription(text: string): string {
  return text
    .replace(/^[\s*•·\-–—]+/, '')
    .replace(/^\(?\d{1,2}[.)]\s*/, '')
    .replace(/[\s,\-–—:;]+$/, '')
    .trim()
}

export interface ParseOptions {
  internalDomain?: string
}

export function parseThread(thread: string, options: ParseOptions = {}): ParsedLine[] {
  const internalDomain = (options.internalDomain ?? config.internalEmailDomain).toLowerCase()
  const lines: ParsedLine[] = []
  let counter = 0

  for (const block of splitBlocks(thread)) {
    const senderIsInternal = block.sender.endsWith(`@${internalDomain}`)
    const senderKnown = block.sender !== ''

    for (const rawLine of block.lines) {
      const raw = rawLine.trim()
      if (raw === '') continue
      if (SKIP_RE.test(raw)) continue

      const qtyMatch = QTY_RE.exec(raw)
      const rateMatch = RATE_RE.exec(raw)

      // §5 — "a line is a candidate item line if it contains a quantity OR a price".
      if (!qtyMatch && !rateMatch) continue

      const qty = qtyMatch?.[1] ? Number(qtyMatch[1]) : 0
      const rate = rateMatch?.[1] ? (parseRupeesToPaise(rateMatch[1]) ?? 0) : 0

      // §5 — "Description = the text before the Qty match". When a line carries
      // only a price, fall back to the text before the rate.
      const cutAt = qtyMatch?.index ?? rateMatch?.index ?? raw.length
      const desc = cleanDescription(raw.slice(0, cutAt))
      if (desc === '') continue

      // §5 — "a line carrying a price is an offer; a line with only a quantity
      // is a request."
      const role: Role = rate > 0 ? 'offer' : 'request'

      // §5 — "Cross-check against the block's sender ... Heuristics are a
      // starting position, not a verdict." We never override the heuristic here;
      // we mark the disagreement so the UI can surface the row.
      const roleUncertain =
        senderKnown && ((role === 'offer' && !senderIsInternal) || (role === 'request' && senderIsInternal))

      counter += 1
      lines.push({
        id: `line-${counter}`,
        raw,
        desc,
        make: findMake(raw),
        partCode: extractPartCode(raw),
        qty,
        rate,
        role,
        source: 'pattern',
        ...(roleUncertain ? { roleUncertain: true } : {}),
      })
    }
  }

  return dedupeWithinRole(lines)
}

/**
 * §5 — "De-duplicate identical raw lines within a role — threads quote
 * themselves repeatedly."
 *
 * Addition: compare on whitespace-normalised text. A quoted reply re-indents
 * the line it is quoting, so byte-identical comparison catches almost none of
 * the duplicates it is meant to.
 */
export function dedupeWithinRole(lines: ParsedLine[]): ParsedLine[] {
  const seen = new Set<string>()
  return lines.filter((line) => {
    const key = `${line.role}::${line.raw.replace(/[\s>]+/g, ' ').trim().toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
