import type { ParsedLine, QuoteItem } from '@shared/schema'
import { MATCH_THRESHOLD, similarity, tokenize } from '../../../server/src/lib/similarity.js'

/**
 * Turning a parsed thread into the makings of a quotation: the lines it quotes,
 * and the one term the thread has an opinion about.
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

// --- the one term the thread has an opinion about --------------------------

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

