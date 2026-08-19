import type { ParsedLine, QuoteItem } from '@shared/schema'

/**
 * Turning a parsed thread into the lines of a quotation.
 *
 * Lifted out of App.tsx because these two rules decide what a customer is
 * billed for: which lines are quoted at all, and what quantity they carry when
 * the thread never said. Both belong under test.
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
 * exactly those lines.
 */
export function itemsFromLines(lines: ParsedLine[]): {
  items: QuoteItem[]
  setAside: string[]
  /** How many quantities the thread never stated, and we assumed as 1. */
  assumedQty: number
} {
  const priced = lines.filter((line) => line.rate > 0)
  const used = priced.length === 0 ? lines : priced

  return {
    items: used.map(toItem),
    setAside:
      priced.length === 0
        ? []
        : lines
            .filter((line) => line.rate === 0)
            .map(
              (line) =>
                `${line.desc.split('\n')[0]}${line.qty > 0 ? `  (qty ${line.qty})` : ''}`,
            ),
    assumedQty: used.filter((line) => line.qty === 0).length,
  }
}
