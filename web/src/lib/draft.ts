import type { ParsedLine, QuoteItem } from '@shared/schema'
import { MATCH_THRESHOLD, similarity, tokenize } from '../../../server/src/lib/similarity.js'

/**
 * Turning a parsed thread into the makings of a quotation: the lines it quotes,
 * and the terms the thread has an opinion about.
 *
 * Lifted out of App.tsx because these rules decide what a customer is billed
 * for and on what conditions: which lines are quoted at all, what quantity they
 * carry when the priced line never said one, and whether the rates include GST.
 * All of it belongs under test.
 *
 * How long the rates stand is NOT read here, and must not come back: that term
 * is Newtech's own promise, so it may only be read off Newtech's own messages,
 * and only the server has the thread split by sender. Read from the whole
 * thread, the customer's "valid for 90 days" came back as our contractual term.
 */

export const toItem = (line: ParsedLine): QuoteItem => ({
  desc: line.desc,
  make: line.make,
  partCode: line.partCode,
  /**
   * The parser reports 0 for "the thread never said" — and it has to keep
   * doing that, because attaching a quantity from a later line depends on
   * knowing the product still has none.
   *
   * A quotation cannot use 0. It prices the line at nothing, and the total
   * comes out zero. One is the only sensible assumption, and the editor says
   * how many lines it was assumed for so nobody sends a quantity nobody wrote.
   */
  qty: line.qty > 0 ? line.qty : 1,
  rate: line.rate,
})

/** The first line of a description — as much as a warning or a list can show. */
const headline = (desc: string): string => desc.split('\n')[0]!

// --- carrying a quantity over from the customer's own line -----------------

/**
 * The tokens that separate one variant of a product from another: anything
 * hyphenated (usb-c, i5-13500), starting with a digit (1.5mtr, 16gb), or a word
 * closed by digits (g11, mk540, e14, ddr5) — the shape a model number takes.
 *
 * Without that last rule "MK540" and "MK270" hold no marker between them, and
 * "440 G11" and "440 G10" hold only the 440 they share, so one product's
 * quantity walks onto another product's line. It stops at the closing digits
 * deliberately: the DGSL offer's mangled "4 G1iR" would otherwise be a marker
 * its own request cannot answer, refusing the pairing that thread depends on.
 *
 * priceHistory.ts carries the same idea in its older, narrower form — hyphen
 * and leading digit only — repeated rather than imported because that module
 * opens the database and cannot come into the browser. If a third caller ever
 * wants it, it belongs in similarity.ts beside the tokenizer that produces the
 * tokens.
 */
function variantMarkers(tokens: Set<string>): Set<string> {
  return new Set(
    [...tokens].filter((t) => t.includes('-') || /^\d/.test(t) || /^[a-z]+\d+$/.test(t)),
  )
}

/** A marker that is a number, optionally carrying its unit: 14, 14in, 1.5mtr. */
const NUMERIC_MARKER = /^(\d+(?:\.\d+)?)([a-z]*)$/

/**
 * The same number, stated with its unit on one side and without it on the
 * other. Nothing else counts as a near miss: `1mtr` against `1.5mtr` is a
 * different cable, and `8gb` against `16gb` is a different machine.
 */
function unitLeftOff(one: string, other: string): boolean {
  const a = NUMERIC_MARKER.exec(one)
  const b = NUMERIC_MARKER.exec(other)
  if (a === null || b === null) return false
  if (Number(a[1]) !== Number(b[1])) return false
  return (a[2] === '') !== (b[2] === '')
}

/**
 * Do two descriptions agree about which variant of a product they name?
 *
 * priceHistory.ts demands the two marker sets be identical, and for reading a
 * price out of last year's records that is right. Here it is too strict by
 * exactly one thing: the DGSL thread prices a "ProBook ... 14 Notebook" against
 * a request for a "ProBook 440 14 inch G11", and `14` against `14in` is a unit
 * the writer left off, not a different laptop.
 *
 * So every marker must still be answered on the other side, and the only
 * latitude is that one. It keeps out the pairing this exists to prevent: on
 * §11's thread the "USB-C to USB-C 1.5 mtr" offer's best-scoring request is the
 * USB-A one at 0.909, and `usb-a` is a marker the offer cannot answer.
 */
function markersAgree(a: Set<string>, b: Set<string>): boolean {
  const ours = [...a].filter((m) => !b.has(m))
  const theirs = [...b].filter((m) => !a.has(m))

  for (const marker of ours) {
    const i = theirs.findIndex((other) => unitLeftOff(marker, other))
    if (i === -1) return false
    theirs.splice(i, 1)
  }
  return theirs.length === 0
}

interface Pairing {
  line: ParsedLine
  score: number
  /** Whether the two descriptions name the same variant, not merely a near one. */
  sameVariant: boolean
}

/**
 * The request line this priced line is answering, if any.
 *
 * §6's 0.42 is a PAIRING threshold — several candidates compete and the best
 * one wins — so it is the right bar for choosing among the requests in a
 * thread. It is not an identity test, which is why the winner then has to
 * survive `markersAgree`; priceHistory.ts makes the same distinction from the
 * other side, by raising its own bar to 0.75 where nothing competes.
 *
 * Every request is ranked, including the ones with no quantity to give. A
 * rejected winner must never promote the runner-up, because the runner-up is by
 * definition the line already judged to be further away.
 */
function closestRequest(offer: ParsedLine, requests: ParsedLine[]): Pairing | null {
  const wanted = tokenize(offer.desc)
  const wantedMarkers = variantMarkers(wanted)
  const partCode = offer.partCode.trim().toUpperCase()

  let best: Pairing | null = null
  for (const request of requests) {
    const theirs = tokenize(request.desc)
    const score = similarity(
      wanted,
      theirs,
      partCode !== '' && request.partCode.trim().toUpperCase() === partCode,
    )
    if (score < MATCH_THRESHOLD) continue
    // Strictly greater, so the first of equal scorers wins: a customer lists
    // what they want in the order we price it back.
    if (best !== null && score <= best.score) continue
    best = {
      line: request,
      score,
      sameVariant: markersAgree(wantedMarkers, variantMarkers(theirs)),
    }
  }
  return best
}

/**
 * Turn the parsed thread into the lines of a quotation.
 *
 * A two-sided thread holds the same product twice — the customer's request and
 * our priced offer. Without the ask-vs-quote comparison there is nothing that
 * can tell they are one product, so listing both puts five zero-priced
 * duplicates on a five-line quotation.
 *
 * So: if anything in the thread carries a price, those are what we are quoting
 * and the rest is the conversation around them. If nothing does — an incoming
 * RFQ — then every line is wanted.
 *
 * What gets left out is never dropped quietly; it joins the "not read" list on
 * the quotation screen, because a quantity the customer stated often lives on
 * exactly those lines — and where it does, this now goes and fetches it.
 */
export function itemsFromLines(lines: ParsedLine[]): {
  items: QuoteItem[]
  setAside: string[]
  /** How many quantities the thread never stated, and we assumed as 1. */
  assumedQty: number
  /**
   * Quantities taken off a request line, and the pairings that were refused —
   * a near miss, or a request another priced line has already been given. None
   * of them may reach a customer unannounced, which is the same rule that gave
   * `assumedQty` its warning.
   */
  warnings: string[]
} {
  const priced = lines.filter((line) => line.rate > 0)
  const used = priced.length === 0 ? lines : priced
  // Nothing is priced on an incoming RFQ, so the requests ARE the quotation and
  // there is nothing to pair them against — a line would match itself at 1.0.
  const requests = priced.length === 0 ? [] : lines.filter((line) => line.role === 'request')

  const warnings: string[] = []
  let assumedQty = 0
  /**
   * Which priced line has already taken each request's quantity. The customer
   * stated that quantity once, so it can answer one line: quoting two options
   * against "25 of whichever you pick" must not put 25 on both and order 50.
   *
   * Keyed on the line itself rather than its id, because nothing promises the
   * ids in one thread are distinct. The first priced line in thread order takes
   * it, the same order `closestRequest` settles its own ties on.
   */
  const takenBy = new Map<ParsedLine, ParsedLine>()

  const items = used.map((line) => {
    const item = toItem(line)
    if (line.qty > 0) return item

    const match = closestRequest(line, requests)
    if (match !== null && match.line.qty > 0) {
      const taker = takenBy.get(match.line)
      if (!match.sameVariant) {
        warnings.push(
          `"${headline(line.desc)}" was priced without a quantity. The closest request line, ` +
            `"${headline(match.line.desc)}" (qty ${match.line.qty}), specifies a different ` +
            `variant, so its quantity has not been used. Set one before saving.`,
        )
      } else if (taker !== undefined) {
        // Refusing is the only honest answer available: nothing here can tell
        // whether the customer wants 25 of each or 25 split between the two.
        warnings.push(
          `"${headline(line.desc)}" was priced without a quantity, and the request line it ` +
            `answers, "${headline(match.line.desc)}" (qty ${match.line.qty}), has already ` +
            `given that quantity to "${headline(taker.desc)}". Two priced lines answer one ` +
            `request, so the split between them has to be set by hand before saving.`,
        )
      } else {
        takenBy.set(match.line, line)
        warnings.push(
          `"${headline(line.desc)}" was priced without a quantity, so ${match.line.qty} has ` +
            `been taken from the request line "${headline(match.line.desc)}". Check it before ` +
            `saving.`,
        )
        return { ...item, qty: match.line.qty }
      }
    }

    assumedQty += 1
    return item
  })

  return {
    items,
    setAside:
      priced.length === 0
        ? []
        : lines
            .filter((line) => line.rate === 0)
            .map((line) => `${headline(line.desc)}${line.qty > 0 ? `  (qty ${line.qty})` : ''}`),
    assumedQty,
    warnings,
  }
}

// --- term 3: whether the rates have GST still to come ----------------------

/**
 * Term 3 when the thread priced its lines with GST still to come. The default
 * in shared/company.ts says the opposite, and the opposite is what most of
 * these threads mean: every priced line of §11's fixture, of the HP thread and
 * of the DGSL chain ends "+ gst each".
 */
export const PRICES_GST_EXTRA = 'Exclusive of GST'

/** The ways a thread says the rate has GST still to come. */
const GST_EXTRA = [
  /\+\s*gst\b/i,
  /\bplus\s+gst\b/i,
  /\bextra\s+gst\b/i,
  /\bgst\s+(?:@\s*\d+(?:\.\d+)?\s*%\s*)?(?:will\s+be\s+|shall\s+be\s+|is\s+)?extra\b/i,
  /\b(?:excluding|exclusive\s+of|excl\.?)\s+gst\b/i,
  /\bex\.?\s*gst\b/i,
]

/**
 * What term 3 should say, or null when the thread never said.
 *
 * Only the priced lines are read. A customer writing "quote us ex-GST" is an
 * instruction about a quotation not yet written; what governs this one is how
 * the rates on it were actually stated.
 *
 * NOT WIRED UP, DELIBERATELY, and the reason is worth stating before anyone
 * "finishes" it. The document already prints Sub Total, then a GST row, then a
 * Total Amount that includes that row — so the rates in the Rate column plainly
 * exclude GST and the total plainly includes it. "All-inclusive as per the
 * quote" is not a claim about the rates at all; it is the promise that the
 * total carries no further freight, installation or handling charge. Replacing
 * it with "Exclusive of GST" would sit directly above a Total Amount that
 * demonstrably includes GST, which is less accurate, not more.
 *
 * It is kept, with its tests, because the DESK may want the wording anyway, and
 * because working out this argument twice would be a waste. Wiring it is one
 * line in App.tsx's newDraft: `prices: pricesTermFromLines(lines) ?? DEFAULT_TERMS.prices`.
 */
export function pricesTermFromLines(lines: ParsedLine[]): string | null {
  const saysExtra = lines
    .filter((line) => line.rate > 0)
    .some((line) => GST_EXTRA.some((pattern) => pattern.test(line.raw)))
  return saysExtra ? PRICES_GST_EXTRA : null
}

// --- term 5: the warranty, hoisted out of the line descriptions ------------

/**
 * The desk writes the warranty inside the line it belongs to — "Warranty: 1
 * Year" under a refurbished drive, ", 3 Years Warranty" at the end of the DGSL
 * desktop's specification — and the document now prints it as term 5 instead.
 *
 * Inside a description it is one product's promise; as a term it is the whole
 * quotation's. That is a change to what Newtech has committed to, which is why
 * it happens here and under test rather than inside a render function.
 *
 * HOISTED, never copied: the text leaves the descriptions it came from, or the
 * same sentence prints twice on one page.
 *
 * Only the SPECIFICATION of a description is eligible. The first line is the
 * product name and is never read — shared/description.ts draws that line, and
 * the DGSL chain shows what hangs on it: "3 Years NBD and 3 Years ADP - Rs.
 * 7,000 + gst each additional" is a priced line of its own, a warranty
 * extension the customer is being BILLED for. Lifted into a term it would lose
 * its name, and 7,000 would stay on the quotation with nothing beside it.
 *
 * That boundary is re-stated here rather than taken from splitDescription
 * because that function trims what it returns, and a description with no
 * warranty in it has to come back byte for byte.
 */

/**
 * The two shapes the threads write, and only those two: the label first
 * ("Warranty: 1 Year", "Warranty - 3 Years"), or the length first with the word
 * at the end (", 3 Years Warranty").
 *
 * The second is anchored on the duration deliberately. Matching whatever merely
 * ENDS in the word would swallow "Win 11 Pro. 3 Years Warranty" entire — the
 * specification and the warranty in one clause — and delete a specification in
 * order to move a warranty. A sentence shaped like that stays where it is and
 * is reported as a line that stated nothing: it costs the desk a warning, and
 * costs the customer nothing.
 *
 * A bare "Warranty" with no length after it states nothing, and is left alone
 * for the same reason the parser leaves a quantity it cannot read at 0.
 */
/**
 * The label the desk writes in front of the promise — and the same label the
 * document prints for itself above the value. Spelled once here so the test
 * for it and the removal of it cannot drift apart.
 */
const WARRANTY_LABEL = /^\s*warrant(?:y|ies)\b\s*[:=–—-]?\s*/i
const WARRANTY_LABELLED = new RegExp(`${WARRANTY_LABEL.source}\\S`, 'i')
/** The same word written after the length instead of before it: ", 3 Years Warranty". */
const WARRANTY_WORD_SUFFIX = /[\s,]*[:=–—-]?\s*\bwarrant(?:y|ies)\b[\s.]*$/i
const WARRANTY_TRAILING = /^\s*\d+\s*(?:years?|yrs?|months?|mos?)\b.*\bwarrant(?:y|ies)\b/i

const isWarrantyStatement = (clause: string): boolean =>
  WARRANTY_LABELLED.test(clause) || WARRANTY_TRAILING.test(clause)

/**
 * The promise, less the word the document already prints above it.
 *
 * Term 5 renders as "5. Warranty : <value>", so a clause carried across whole
 * comes out "Warranty : Warranty: 1 Year" — the label once from the thread and
 * once from the template. What the desk wrote about the LENGTH is still what is
 * printed; only the label the document supplies for itself comes off.
 */
const warrantyValue = (clause: string): string =>
  clause
    .trim()
    .replace(/[.,;:\s]+$/, '')
    .replace(WARRANTY_LABEL, '')
    .replace(WARRANTY_WORD_SUFFIX, '')
    .trim()

/**
 * One specification line with its warranty clauses taken out.
 *
 * Split on commas because that is how these specifications are punctuated, and
 * NOT on full stops as well: "Win 11 Pro., 3 Years Warranty" would break at the
 * "Pro." and hand back the specification in pieces. Every clause keeps its own
 * spacing, so the ones that stay are the bytes that were already there.
 */
function stripSpecLine(line: string): { text: string; found: string[] } {
  const found: string[] = []
  const kept = line.split(',').filter((clause) => {
    if (!isWarrantyStatement(clause)) return true
    // The wording the desk chose, less the punctuation that belonged to the
    // sentence around it rather than to the promise.
    const value = warrantyValue(clause)
    // All label and no length promises nothing. Leave it in the description
    // rather than open term 5 with nothing to put after the colon.
    if (value === '') return true
    found.push(value)
    return false
  })
  if (found.length === 0) return { text: line, found }

  // Joining the survivors takes the removed clause's comma with it, so all that
  // can be left over is a separator at one end: "…, Win 11 Pro., 3 Years
  // Warranty." comes back as "…, Win 11 Pro." — no trailing comma, and the full
  // stop that belongs to "Win 11 Pro." still on it. Nothing else is tidied. The
  // DGSL specification's own ", ," was in the thread before this ran, and
  // rewriting a specification is not what hoisting a warranty is allowed to do.
  return {
    text: kept
      .join(',')
      .replace(/^[\s,]+/, '')
      .replace(/[\s,]+$/, ''),
    found,
  }
}

/** Every warranty a description states, and the description without them. */
function stripDescription(desc: string): { desc: string; found: string[] } {
  const [name = '', ...spec] = desc.split('\n')
  const found: string[] = []
  const kept: string[] = []

  for (const line of spec) {
    const stripped = stripSpecLine(line)
    found.push(...stripped.found)
    // A line that was nothing but a warranty statement leaves nothing behind
    // but the gap it used to fill.
    if (stripped.found.length > 0 && stripped.text === '') continue
    kept.push(stripped.text)
  }

  if (found.length === 0) return { desc, found }
  const rest = kept.join('\n')
  // A product name on its own is a complete description — §5 parses plenty of
  // lines that never carried a specification at all.
  return { desc: rest.trim() === '' ? name : `${name}\n${rest}`, found }
}

/**
 * Two warranties are the same warranty when only their case, spacing,
 * punctuation and the spelling of the unit differ: "3 Years Warranty" and
 * "Warranty: 3 yrs" are one promise written twice. The word itself tells the
 * two apart from nothing — every one of these contains it — so it comes out
 * before the comparison, and what is left is the length of the promise.
 *
 * Normalising is for COMPARING. What gets printed is one of the originals: the
 * term the customer reads is the desk's own sentence, not this.
 */
function normaliseWarranty(warranty: string): string {
  return warranty
    .toLowerCase()
    .replace(/\bwarrant(?:y|ies)\b/g, ' ')
    .replace(/\b(?:years?|yrs?)\b/g, 'yr')
    .replace(/\b(?:months?|mos?)\b/g, 'mo')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface HoistedWarranty {
  /**
   * What term 5 should say, or null when no line stated one and when the lines
   * cannot agree on one. Null prints no term at all: a blank "5. Warranty :" on
   * a customer's document is worse than four terms.
   */
  warranty: string | null
  /** The items, with a hoisted warranty gone from the descriptions it came from. */
  items: QuoteItem[]
  /**
   * A warranty stated on one line and printed over the whole document is a
   * claim wider than the one that was made, so it never lands silently — the
   * same rule the carried quantity follows.
   */
  warnings: string[]
}

/**
 * Term 5, and the items it was taken out of.
 *
 * Hoisting is only honest when the document speaks with one voice. Two lines
 * stating different warranties cannot both be term 5, so nothing moves, every
 * description keeps the warranty that is true of it, and the desk is told.
 * Lines that state none are not a disagreement — one term is how the desk
 * writes these — so the hoist stands and the warning says how many lines
 * actually said it.
 */
export function hoistWarranty(items: QuoteItem[]): HoistedWarranty {
  const stripped = items.map((item) => stripDescription(item.desc))

  /** Distinct by normalised form, kept in the words and on the line it was first written on. */
  const distinct = new Map<string, { wording: string; on: string }>()
  stripped.forEach(({ found }, i) => {
    for (const warranty of found) {
      const key = normaliseWarranty(warranty)
      if (!distinct.has(key)) {
        distinct.set(key, { wording: warranty, on: headline(items[i]!.desc) })
      }
    }
  })

  if (distinct.size === 0) return { warranty: null, items, warnings: [] }

  if (distinct.size > 1) {
    const named = [...distinct.values()].map((d) => `"${d.wording}" on "${d.on}"`).join(', ')
    return {
      warranty: null,
      items,
      warnings: [
        `The lines state different warranties — ${named} — so no single term can stand for ` +
          `them all. They have been left in the descriptions, where each of them is true. ` +
          `Write term 5 by hand if this quotation needs one.`,
      ],
    }
  }

  const { wording } = [...distinct.values()][0]!
  const silent = stripped.filter(({ found }) => found.length === 0).length
  const stated = items.length - silent

  return {
    warranty: wording,
    items: items.map((item, i) =>
      stripped[i]!.found.length > 0 ? { ...item, desc: stripped[i]!.desc } : item,
    ),
    warnings:
      silent === 0
        ? []
        : [
            `${stated} of the ${items.length} lines state${stated === 1 ? 's' : ''} a warranty ` +
              `("${wording}"), and it is now term 5 over all ${items.length}. The other ` +
              `${silent} line${silent === 1 ? '' : 's'} never made that promise — check term 5 ` +
              `is meant to cover ${silent === 1 ? 'it' : 'them'} before saving.`,
          ],
  }
}
