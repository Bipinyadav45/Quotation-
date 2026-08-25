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
 *
 * Two more, found by reading the pattern rather than the mail:
 *
 *   - `\d{1,4}` with no comma meant "Qty- 1,000" matched the "1" and stopped.
 *     Not a miss — a silent order-of-magnitude error, on the one number this
 *     application exists to get right. And "Qty- 10000" matched nothing at all.
 *   - The unit form had no left guard, so "12,500 nos" matched at the "500",
 *     reading the wrong half of the number. Hence the lookbehind.
 *
 * Digits are captured with their commas and stripped by `readCount` below,
 * which is also where an absurd value is rejected rather than quoted.
 */
const QTY_RE = /\b(?:qty|quantity)\s*[-–:.]?\s*(?:nos?\.?\s*[-–:]?\s*)?(\d[\d,]*)(?![\d,])/i

/**
 * The other way a quantity arrives: a bare number and a counting unit, with no
 * "Qty" anywhere — "Pls quote 4 nos desktop", "2 pcs monitor".
 *
 * The unit is required. Without it "16 gb ram", "512 ssd" and "win 11 prof"
 * would all read as quantities, and a specification would silently become a
 * count on a customer's quotation.
 */
const QTY_UNIT_RE = /(?<![\d,.])(\d[\d,]*)\s*(?:nos?|pcs?|pieces?|units?|sets?)\b\.?/i

/**
 * What "Qty- 04nos." leaves behind once the quantity is matched: "nos.". A unit
 * remnant is not a product, so it has to be stripped before deciding whether
 * there is a description after the quantity at all.
 */
const LEADING_UNIT_RE = /^\s*(?:nos?|pcs?|pieces?|units?|sets?)\b\.?[\s.,:;-]*/i
/**
 * §5 requires a currency marker BEFORE the number. Indian quotes routinely put
 * it after, or use no word at all:
 *
 *   1250 INR          Rate 1250/-        @ 1250 each        1,04,500/- each
 *
 * Every one of those missed, and a missed rate is not a blank cell — it flips
 * the line from an offer to a request, so the desk's own priced line comes back
 * flagged as something the customer asked for and nobody quoted.
 *
 * Tried in order, first match wins. A bare number is deliberately NOT a rate:
 * without a marker there is no way to tell 25 the price from 25 the quantity,
 * and inventing a price is far worse than missing one.
 */
const RATE_PATTERNS: RegExp[] = [
  // Rs. 1,250   INR 1250   ₹1250
  /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
  // 1250 INR   1250 Rs.
  /([\d,]+(?:\.\d{1,2})?)\s*(?:inr|rs\.?|₹)(?![a-z])/i,
  // Rate 1250   Price: 1,250   Cost - 1250
  /\b(?:rate|price|cost|amount)\s*[-–:@]?\s*([\d,]+(?:\.\d{1,2})?)/i,
  // 1,04,500/-   1250 /-
  /([\d,]+(?:\.\d{1,2})?)\s*\/-/,
  // @ 1250 each — but not "@ 5 nos", which is a quantity
  /@\s*([\d,]+(?:\.\d{1,2})?)(?!\s*(?:nos?|pcs?|pieces?|units?|sets?)\b)/i,
]

/** First rate marker on the line, or null. */
function matchRate(text: string): RegExpExecArray | null {
  for (const pattern of RATE_PATTERNS) {
    const found = pattern.exec(text)
    if (found) return found
  }
  return null
}
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

/**
 * A mail client's own furniture and the attachment list. "…- 06 Nos.docx" reads
 * as a quantity of six, so a filename becomes a product unless it is skipped
 * before the quantity rules ever see it.
 */
const CHROME_RE =
  /^(?:fwd:|re:|contact photo|details plain text|attachments?\b|-{3,}\s*original message|date:|from\s|sent\s)/i
const ATTACHMENT_RE = /\.(?:docx?|xlsx?|pptx?|pdf|jpe?g|png|gif|zip|rar|csv|msg|eml)\b\s*$/i
const FILESIZE_RE = /^\(?~?\s*[\d.,]+\s*(?:bytes|kb|mb|gb)\s*\)?$/i

/**
 * A totals row, not a product. "Total - Rs. 1,11,500 + gst each" carries a
 * price and so passes every candidate test §5 has — and then prints on the
 * quotation as a line item called "Total", at the price of the whole order.
 */
const SUMMARY_ROW_RE =
  /^(?:sub\s*total|grand\s*total|net\s*total|total|amount|gst|tax|vat|discount|freight|packing|round\s*off|less)\b/i

/**
 * A sign-off. Everything after one, within the same block, is signature — the
 * company name, the sender's name, the phone list. Those lines are not read as
 * products and never should be, so they must not be reported as "not read"
 * either: a warning that is entirely false is a warning the desk learns to
 * scroll past, and then the one line that mattered scrolls past with it.
 */
const SIGNOFF_RE = /^(?:thanks|thank you|regards|best regards|warm regards|br\b|--|__)/i

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

/**
 * A captured quantity, comma grouping removed. Returns 0 — "not stated" — for
 * anything that cannot be a real order quantity, so a phone number or a part
 * code fragment cannot arrive on a quotation as a count.
 */
function readCount(captured: string | undefined): number {
  if (!captured) return 0
  const n = Number(captured.replace(/,/g, ''))
  if (!Number.isSafeInteger(n) || n <= 0 || n > 999_999) return 0
  return n
}

/**
 * §6's `spec` rule compares the FIRST length value on each side.
 *
 * The bare "m" alternative made "Rs. 550 m" read as 550 metres, which raises a
 * `spec` flag against a line whose only crime is being priced in rupees. A
 * number carrying a currency marker is money, never a measurement.
 */
const MONEY_BEFORE_RE = /(?:rs\.?|inr|₹)\s*[\d,]*$/i

export function firstLength(text: string): number | null {
  LENGTH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LENGTH_RE.exec(text)) !== null) {
    if (MONEY_BEFORE_RE.test(text.slice(0, match.index))) continue
    LENGTH_RE.lastIndex = 0
    return match[1] ? Number(match[1]) : null
  }
  LENGTH_RE.lastIndex = 0
  return null
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
  return (
    text
      .replace(/^[\s*•·\-–—]+/, '')
      /**
       * A list marker, NOT the whole number in front of a decimal point.
       *
       * The space is what tells them apart, and it used to be optional: `\s*`
       * matched nothing, so "1.6 TB SAS 12G Drive" was read as a list item and
       * came out "6 TB SAS 12G Drive" — a different drive, on a document a
       * customer pays against. Every real list writes "1) " or "2. " with a
       * space; nobody writes "1.6" meaning item one.
       */
      .replace(/^\(?\d{1,2}[.)]\s+/, '')
      .replace(/[\s,\-–—:;]+$/, '')
      .trim()
  )
}

/**
 * "Pls quote", "Kindly send", "We need" — the words an RFQ opens with. §5 takes
 * the description from the text BEFORE the quantity, which on a line like
 * "Pls quote 4 nos desktop..." describes the instruction rather than the
 * product. When the text before the quantity is only a preamble, the product is
 * whatever follows it.
 */
const PREAMBLE_RE =
  /^(?:we|i)?\s*(?:pls|plz|please|kindly)?\s*(?:quote|quotation|send|share|provide|need|require|want|arrange)\b[\s:,-]*$/i

/**
 * A line that asks for a product but names neither a quantity nor a price —
 * "Quote tft separately". §5 does not treat it as a candidate at all, so a
 * product the customer asked for silently vanished. Only an explicit quoting
 * verb counts: "Please find details below" must not become a product called
 * "find details below".
 */
const BARE_REQUEST_RE = /^(?:pls|plz|please|kindly)?\s*(?:quotation for|quotation|quote)\b[\s:,-]*(.+)$/i

/**
 * "Kindly quote for the below:" names no product — it points at the list under
 * it, which the parser reads line by line on its own. Taken at face value it
 * put a line reading "for the below", quantity 1, on the quotation, above the
 * three real products it was introducing.
 */
const POINTS_ELSEWHERE_RE =
  /^(?:for\s+|as\s+per\s+|as\s+|kindly\s+|pls\s+|please\s+)*(?:the\s+)?(?:below|following|attached|under\s*mentioned|undermentioned|items?|products?|list|requirements?|enquiry|rates?|prices?|best\s+(?:rates?|prices?|offer))\b[\s.:,-]*$/i

/** Instructions that trail a product name: "tft separately", "monitor also". */
const TRAILING_INSTRUCTION_RE =
  /[\s,]*\b(?:separately|seperately|also|as well|too|please|pls|asap|urgently)\b[\s.,!]*$/i

/** "tft separately" -> "tft". The adverb is an instruction, not the product. */
function stripTrailingInstruction(text: string): string {
  let out = text
  // Repeat: "monitor also please" carries two.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(TRAILING_INSTRUCTION_RE, '').trim()
    if (next === out) break
    out = next
  }
  return cleanDescription(out)
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

/**
 * Lines that are noise by construction and must never be reported as "not
 * read": a signature, a link, a divider. Reporting them would bury the one
 * line that actually matters under a wall of footer.
 */
function isObviousNoise(text: string): boolean {
  if (text.length < 3) return false || text.length === 0
  if (/^\[?<?https?:\/\//i.test(text)) return true
  if (/^\[(?:cid|image):/i.test(text)) return true
  if (/^[^A-Za-z0-9]+$/.test(text)) return true // "--", "___", ">>>"
  if (/^\+?\d[\d\s()+-]{6,}$/.test(text)) return true // a bare phone number
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(text)) return true // a bare address
  return false
}

export interface ParseOptions {
  internalDomain?: string
}

export interface ParseResult {
  lines: ParsedLine[]
  /**
   * Things the desk must decide, which the parser cannot. Chief among them:
   * a forwarded chain often carries several revisions of the same quotation,
   * and the newer ones are frequently pasted tables the patterns cannot read.
   * Returning the oldest price with no comment is the worst possible answer.
   */
  warnings: string[]
  /**
   * Lines with real content that produced no product.
   *
   * The parser silently discarding what it does not understand is how a missed
   * quantity and a missed product both reached a customer-facing screen. These
   * are surfaced so a human sees what the parser could not read, instead of
   * finding out from the customer.
   */
  skipped: string[]
}

/** §5's parser. Returns products only; see parseThreadDetailed for what it could not read. */
export function parseThread(thread: string, options: ParseOptions = {}): ParsedLine[] {
  return parseThreadDetailed(thread, options).lines
}

export function parseThreadDetailed(thread: string, options: ParseOptions = {}): ParseResult {
  const internalDomain = (options.internalDomain ?? config.internalEmailDomain).toLowerCase()
  const lines: ParsedLine[] = []
  const skipped: string[] = []
  const warnings: string[] = []
  let counter = 0

  const blocks = splitBlocks(thread)
  /** Index of the message each price came from — 0 is the newest. */
  const pricedBlocks = new Set<number>()
  let blockIndex = -1

  for (const block of blocks) {
    blockIndex += 1
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
    let inSignature = false

    /**
     * Lines directly above the current one that were not products in their own
     * right. A wrapped description puts the product name here and the quantity
     * three lines later:
     *
     *   HP Pro Tower 280 G9 PCI Desktop PC
     *   i5-13500/16GB DDR4/512GB SSD/Wi-Fi/MII/Win11Pro/3
     *   Yrs Onsite Without Monitor ---- 25 nos....
     *
     * §5 reads only the last line, so the product came out called "Yrs Onsite
     * Without Monitor" and its name was thrown away.
     */
    let pending: string[] = []

    /** Nothing claimed these; report them rather than drop them. */
    const flushPending = () => {
      for (const line of pending) {
        if (!inSignature && !isObviousNoise(line)) skipped.push(line)
      }
      pending = []
    }

    for (const rawLine of block.lines) {
      const raw = rawLine.trim()
      if (SIGNOFF_RE.test(raw)) inSignature = true

      // Client furniture and attachments are dismissed before the quantity
      // rules run, or "…HP 280 G9 - 25 Nos.docx" becomes a product.
      if (CHROME_RE.test(raw) || ATTACHMENT_RE.test(raw) || FILESIZE_RE.test(raw)) {
        flushPending()
        adjacent = false
        continue
      }

      if (raw === '' || SKIP_RE.test(raw)) {
        // A blank or a signature ends a specification, but not the product —
        // the quantity often sits a blank line below it.
        flushPending()
        adjacent = false
        continue
      }

      // Either "Qty- 04" or a bare "4 nos". The keyword form wins when both are
      // present, since it is the explicit one.
      const qtyMatch = QTY_RE.exec(raw) ?? QTY_UNIT_RE.exec(raw)
      const rateMatch = matchRate(raw)

      // §5 — "a line is a candidate item line if it contains a quantity OR a price".
      if (!qtyMatch && !rateMatch) {
        // A specification continuing the line above it, e.g.
        // "Core i5-14400, 16 GB RAM, 512GB SSD, ...". It has to be the very
        // next line and it has to read like a specification, or a closing
        // remark would end up printed as part of the product.
        if (adjacent && lastItem && looksLikeSpecification(raw)) {
          appendSpecification(lastItem, raw)
          continue
        }

        // "Quote tft separately" — a product asked for with neither quantity
        // nor price. §5 discards it, which loses a line the customer asked for.
        const asked = BARE_REQUEST_RE.exec(raw)?.[1]
        const cleaned = asked ? stripTrailingInstruction(cleanDescription(asked)) : ''
        // A request that points at a list rather than naming a product is not a
        // product. The list itself is read line by line just below.
        const askedFor = POINTS_ELSEWHERE_RE.test(cleaned) ? '' : cleaned
        if (askedFor === '') {
          // Nothing matched yet. Hold it: the next line may be the quantity
          // belonging to a description that wrapped. Only three, so a long
          // stretch of prose cannot end up glued to a product.
          if (pending.length >= 3) {
            const oldest = pending.shift()!
            if (!inSignature && !isObviousNoise(oldest)) skipped.push(oldest)
          }
          pending.push(raw)
          adjacent = false
          continue
        }

        flushPending()
        counter += 1
        const requested: ParsedLine = {
          id: `line-${counter}`,
          raw,
          desc: askedFor,
          make: findMake(raw),
          partCode: extractPartCode(raw),
          qty: 0,
          rate: 0,
          role: 'request',
          source: 'pattern',
          ...(senderKnown && senderIsInternal ? { roleUncertain: true } : {}),
        }
        lines.push(requested)
        lastItem = requested
        adjacent = true
        continue
      }

      const qty = readCount(qtyMatch?.[1])
      const rate = rateMatch?.[1] ? (parseRupeesToPaise(rateMatch[1]) ?? 0) : 0

      // §5 — "Description = the text before the Qty match". When a line carries
      // only a price, fall back to the text before the rate.
      const cutAt = qtyMatch?.index ?? rateMatch?.index ?? raw.length
      let desc = cleanDescription(raw.slice(0, cutAt))

      // ...but when the text before the quantity is only an instruction —
      // "Pls quote 4 nos desktop with 16 gb ram" — the product is what follows
      // it, and §5's rule would describe the instruction instead.
      //
      // The unit remnant has to come off first. Without that, "Qty- 04nos."
      // reads as a product called "nos." rather than a quantity belonging to
      // the line above it.
      if (qtyMatch && (desc === '' || PREAMBLE_RE.test(desc))) {
        const after = cleanDescription(
          raw.slice(qtyMatch.index + qtyMatch[0].length).replace(LEADING_UNIT_RE, ''),
        )
        if (after !== '') desc = stripTrailingInstruction(after)
        else desc = ''
      }

      if (desc === '') {
        // A quantity on its own, e.g. "Qty- 04nos." under the product it
        // belongs to. Only fills a gap: a product that already stated its own
        // quantity is never overwritten by a later stray line.
        if (qty > 0 && lastItem && lastItem.qty === 0) {
          lastItem.qty = qty
          lastItem.raw = `${lastItem.raw}\n${raw}`
        }
        flushPending()
        adjacent = false
        continue
      }

      // "Total - Rs. 1,11,500 + gst each" carries a price and so satisfies every
      // candidate test §5 has. It is the sum of the lines above it, and printing
      // it as a product puts the whole order on the quotation a second time.
      if (SUMMARY_ROW_RE.test(desc)) {
        flushPending()
        adjacent = false
        continue
      }

      /**
       * A description that wrapped: the quantity landed on its last line, so
       * `desc` is a fragment and the product name is sitting in `pending`.
       *
       * The signal is a brand. If a line above names one and this line does
       * not, the product name is above. Concrete enough not to glue arbitrary
       * prose onto a product, which would print on a customer's quotation.
       */
      let carried: string[] = []
      if (pending.length > 0 && findMake(raw) === '' && pending.some((l) => findMake(l) !== '')) {
        const from = pending.findIndex((l) => findMake(l) !== '')
        carried = pending.slice(from)
        for (const dropped of pending.slice(0, from)) {
          if (!inSignature && !isObviousNoise(dropped)) skipped.push(dropped)
        }
        pending = []
        desc = [...carried.map((l) => cleanDescription(l)), desc].filter(Boolean).join('\n')
      } else {
        flushPending()
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
      const fullText = carried.length > 0 ? `${carried.join('\n')}\n${raw}` : raw
      const item: ParsedLine = {
        id: `line-${counter}`,
        raw: fullText,
        desc,
        make: findMake(fullText),
        partCode: extractPartCode(fullText),
        qty,
        rate,
        role,
        source: 'pattern',
        ...(roleUncertain ? { roleUncertain: true } : {}),
      }
      lines.push(item)
      if (rate > 0) pricedBlocks.add(blockIndex)
      lastItem = item
      adjacent = true
    }

    flushPending()
  }

  /**
   * A forwarded chain runs newest-first, so a price found in message 3 means
   * two more recent messages said something this parser could not read — very
   * often a revised price pasted as a table. Quoting a superseded rate is
   * exactly the silent error this product exists to prevent, so say it out loud
   * rather than return the old number as though it were current.
   */
  const newestPricedBlock = pricedBlocks.size > 0 ? Math.min(...pricedBlocks) : -1
  if (newestPricedBlock > 0) {
    warnings.push(
      `Prices were read from message ${newestPricedBlock + 1} of ${blocks.length} in this thread. ` +
        `${newestPricedBlock} more recent message${newestPricedBlock === 1 ? '' : 's'} produced no price — ` +
        `if any of them revised it, these rates are out of date. Prices pasted as a table cannot be read; ` +
        `check the newest message, or try "Read it with AI instead".`,
    )
  }

  return { lines: dedupeWithinRole(lines), skipped, warnings }
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
