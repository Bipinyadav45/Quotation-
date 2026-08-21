import { splitBlocks } from './parser.js'

/**
 * Term 4 — how long the price stands — read off the thread.
 *
 * WHY THIS LIVES ON THE SERVER. It used to run in the browser over the raw
 * pasted text, with no idea who wrote each line, and that made it dangerous in
 * a way that is easy to miss: a customer's own boilerplate — "Kindly quote your
 * best rates. Rates should be valid for 90 days from date of quote." — came
 * back as NEWTECH's printed contractual term. The desk offers five days, the
 * document promises ninety, and nothing on screen says where the sentence came
 * from. Here the thread is already split by sender, so only what WE wrote can
 * become what we commit to.
 *
 * The sibling rule in web/src/lib/draft.ts had the same trap and avoided it by
 * reading only priced lines; its docstring is worth reading. This is the same
 * lesson applied one field over.
 */

/** A statement about how long the price stands. */
const VALIDITY = [
  /^valid(?:ity)?\s*[:-]?\s*(?:till|until|upto|up\s+to|for|through)\b/i,
  /^stocks?\s+last\b/i,
  /^subject\s+to\s+(?:stock|availability)\b/i,
  /^till\s+stocks?\s+last\b/i,
]

/**
 * A line carrying a rate is a product line, whatever else it also says. "HP 280
 * G9 MT Desktop - Rs. 87,250 + gst each ( Very limited stocks)" is the HP
 * thread's, and putting it in the Validity cell would quote the machine twice.
 */
const CARRIES_A_RATE = [/\b(?:rs\.?|inr|₹)\s*\d/i, /\d\s*\/-/, /@\s*\d/]

/** Leading quote markers and bullets from a forwarded reply. */
const LINE_FURNITURE = /^[>\s*•-]+/

/** The label, where the thread wrote one — the term already has its own. */
const VALIDITY_LABEL = /^validity\s*[:-]\s*/i

/** "Price valid for 2 days" — the noun is the term's subject, not its text. */
const PRICE_NOUN = /^(?:the\s+)?(?:prices?|rates?|offers?|quotes?|quotations?)\s+(?=valid)/i

/**
 * The Validity cell is one line of a terms table. A paragraph that merely
 * contains the word — a disclaimer, a pasted policy — is not a validity
 * statement, and dropping it in would push the table off the page.
 */
const LONGEST_TERM = 120

/**
 * The statement a line makes about validity, or null if it makes none.
 *
 * Every pattern is anchored at the start of the line, and that anchoring is the
 * point rather than a detail. Merely CONTAINING the word is what let
 * "We cannot hold this price. Validity: only till 12th July, after that it will
 * be revised." and "Our competitor Redington offered validity till 31st Aug."
 * through — both of which say the opposite of a term, and both of which would
 * have been printed whole.
 */
function statedValidity(rawLine: string): string | null {
  const line = rawLine.replace(LINE_FURNITURE, '').trim()
  if (line === '' || line.length > LONGEST_TERM) return null
  if (CARRIES_A_RATE.some((pattern) => pattern.test(line))) return null

  // "Validity: 5 days from date of offer." — the label is ours to supply.
  const labelled = VALIDITY_LABEL.test(line)
  const body = labelled ? line.replace(VALIDITY_LABEL, '').trim() : line.replace(PRICE_NOUN, '').trim()
  if (body === '') return null

  // A labelled line has already declared itself. An unlabelled one has to open
  // with the statement to count as one.
  if (!labelled && !VALIDITY.some((pattern) => pattern.test(body))) return null

  const cased = body.charAt(0).toUpperCase() + body.slice(1)
  // The house format carries a full stop on this term; see the §11 document.
  return cased.endsWith('.') ? cased : `${cased}.`
}

/**
 * What term 4 should say, or null when WE stated no validity.
 *
 * Only blocks whose sender is one of ours are read. A block with no recognised
 * sender is not read either — an unattributed line is exactly the case that
 * cannot be trusted, and defaulting to the end of the month is the safe answer.
 *
 * The first match wins because these threads run newest message first, and a
 * validity from a superseded message is the one not to use. That ordering is a
 * convention, not a guarantee — a chain pasted oldest-first would yield the
 * older statement — which is why the caller warns whenever this returns
 * anything at all. A contractual term inferred by software is not allowed to
 * reach a customer unannounced.
 */
export function validityFromThread(
  thread: string,
  internalDomains: readonly string[],
): string | null {
  for (const block of splitBlocks(thread)) {
    if (block.sender === '') continue
    if (!internalDomains.some((domain) => block.sender.endsWith(`@${domain}`))) continue

    for (const line of block.lines) {
      const stated = statedValidity(line)
      if (stated !== null) return stated
    }
  }
  return null
}
