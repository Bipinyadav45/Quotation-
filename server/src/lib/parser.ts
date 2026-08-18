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
/**
 * §5's quantity pattern, with two corrections found against a real thread.
 *
 * §5 ends it with `\b`, which cannot match between "4" and "n" — so
 * "Qty- 04nos." did not match AT ALL, and the product came through with no
 * quantity. `(?!\d)` says the same thing that `\b` was meant to say (the number
 * is complete) without demanding that a non-word character follow it.
 *
 * "Quantity" is also accepted alongside "Qty"; both appear in the desk's mail.
 */
const QTY_RE = /\b(?:qty|quantity)\s*[-–:.]?\s*(?:nos?\.?\s*[-–:]?\s*)?(\d{1,4})(?!\d)/i
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

/**
 * Does this line read like a continuation of the product above it?
 *
 * Deliberately narrow. A false positive prints a closing remark inside a
 * product description on a customer-facing quotation, which is worse than
 * losing a specification the user can retype — so it needs a concrete signal:
 * a number with a hardware unit, or a hardware word.
 */
export function looksLikeSpecification(text: string): boolean {
  if (text.length > 300) return false
  const UNIT = /\b\d+\s*(?:gb|tb|mb|ghz|mhz|kva|watt|watts|inch|mtr|mm|cm)\b/i
  const WORD =
    /\b(?:ram|ssd|hdd|nvme|emmc|warranty|core|i[3579]|ryzen|processor|graphics|display|resolution|wi-?fi|bluetooth|ethernet|windows|onboard|dos|ups)\b/i
  return UNIT.test(text) || WORD.test(text)
}

/**
 * Fold a specification line into the product above it. The description is what
 * gets quoted, so the spec belongs there — the customer is buying that
 * configuration, not just "HP 280 G9 MT Desktop".
 */
function appendSpecification(item: ParsedLine, raw: string): void {
  const spec = cleanDescription(raw).replace(/\s+/g, ' ').trim()
  if (spec === '') return

  item.desc = `${item.desc}\n${spec}`
  item.raw = `${item.raw}\n${raw}`
  // A model code or brand often lives in the specification rather than the
  // product line, so both are worth another look now there is more to read.
  if (item.partCode === '') item.partCode = extractPartCode(item.raw)
  if (item.make === '') item.make = findMake(item.raw)
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

    /**
     * §5 assumes one line per item. Real threads from the desk do not: the
     * product, its specification and its quantity routinely arrive on three
     * separate lines. These two carry an item across those lines — `lastItem`
     * for the whole block, `adjacent` only while nothing has interrupted.
     */
    let lastItem: ParsedLine | null = null
    let adjacent = false

    for (const rawLine of block.lines) {
      const raw = rawLine.trim()
      if (raw === '' || SKIP_RE.test(raw)) {
        // A blank or a signature ends a specification, but not the product —
        // the quantity often sits a blank line below it.
        adjacent = false
        continue
      }

      const qtyMatch = QTY_RE.exec(raw)
      const rateMatch = RATE_RE.exec(raw)

      // §5 — "a line is a candidate item line if it contains a quantity OR a price".
      if (!qtyMatch && !rateMatch) {
        // A specification continuing the line above it, e.g.
        // "Core i5-14400, 16 GB RAM, 512GB SSD, ...". It has to be the very
        // next line and it has to read like a specification, or a closing
        // remark would end up printed as part of the product.
        if (adjacent && lastItem && looksLikeSpecification(raw)) {
          appendSpecification(lastItem, raw)
        } else {
          adjacent = false
        }
        continue
      }

      const qty = qtyMatch?.[1] ? Number(qtyMatch[1]) : 0
      const rate = rateMatch?.[1] ? (parseRupeesToPaise(rateMatch[1]) ?? 0) : 0

      // §5 — "Description = the text before the Qty match". When a line carries
      // only a price, fall back to the text before the rate.
      const cutAt = qtyMatch?.index ?? rateMatch?.index ?? raw.length
      const desc = cleanDescription(raw.slice(0, cutAt))

      if (desc === '') {
        // A quantity on its own, e.g. "Qty- 04nos." under the product it
        // belongs to. Only fills a gap: a product that already stated its own
        // quantity is never overwritten by a later stray line.
        if (qty > 0 && lastItem && lastItem.qty === 0) {
          lastItem.qty = qty
          lastItem.raw = `${lastItem.raw}\n${raw}`
        }
        adjacent = false
        continue
      }

      // §5 — "a line carrying a price is an offer; a line with only a quantity
      // is a request."
      const role: Role = rate > 0 ? 'offer' : 'request'

      // §5 — "Cross-check against the block's sender ... Heuristics are a
      // starting position, not a verdict." We never override the heuristic here;
      // we mark the disagreement so the UI can surface the row.
      const roleUncertain =
        senderKnown && ((role === 'offer' && !senderIsInternal) || (role === 'request' && senderIsInternal))

      counter += 1
      const item: ParsedLine = {
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
      }
      lines.push(item)
      lastItem = item
      adjacent = true
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
