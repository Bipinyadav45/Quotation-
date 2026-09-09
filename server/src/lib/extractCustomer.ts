import { z } from 'zod'
import type { AiReadResponse, CustomerCandidate, ResolvedCustomer } from '@shared/schema.js'
import { INDIAN_STATES, normaliseGstin } from '@shared/states.js'
import { config } from '../config.js'
import { allCustomers, type CustomerRecord } from './customers.js'
import { rankCandidates, type Candidate } from './customerMatch.js'

/**
 * Read the customer's details out of an RFQ thread, and work out which ledgers
 * on the customer master it could mean.
 *
 * The hard part is not extraction, it is knowing whose details to take: every
 * one of these threads carries Newtech's own signature block, usually several
 * times, and it is longer and tidier than the customer's. So the internal
 * domain is passed in and the model is told explicitly to skip it.
 *
 * Nothing here writes to a quotation, and — since the desk's Tally list came
 * in — nothing here even DECIDES a customer. A thread naming "Morgan Stanley"
 * matches seventeen ledgers across ten GSTINs and three states. What comes back
 * is the shortlist and, for each entry, exactly what the draft would become if
 * a person picked it. A person then picks it.
 */

/**
 * Deliberately no phone or email.
 *
 * The "Contact Number" and "Email" on the quotation are OURS — the
 * salesperson's, in the From block. The customer's own are nowhere on the
 * document, so extracting them would only create a field with two meanings and
 * an obvious way to put the customer's number on our letterhead.
 */
export const ExtractedCustomerSchema = z.object({
  name: z.string(),
  address: z.string(),
  attention: z.string(),
  gstin: z.string(),
  state: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type ExtractedCustomer = z.infer<typeof ExtractedCustomerSchema>

/**
 * Newtech's own mail domains, all of them.
 *
 * config.internalEmailDomain holds one value because §5's role heuristic only
 * ever needed one, but the same people write from "@newtech.co.in" as often as
 * from "@newtech.in", and a signature the model does not recognise as ours is a
 * signature it can hand back as the customer's. The set is stated once and both
 * the prompt and rejectOwnDetails read it, so widening it again is one edit
 * here rather than a second spelling buried in a regex.
 *
 * The filter drops a blank INTERNAL_EMAIL_DOMAIN — "@" alone would match every
 * address in the thread — and a configured value that duplicates an alias.
 */
const ALIAS_DOMAINS = ['newtech.co.in']

export const INTERNAL_EMAIL_DOMAINS: readonly string[] = [
  config.internalEmailDomain,
  ...ALIAS_DOMAINS,
].filter((domain, index, all) => domain !== '' && all.indexOf(domain) === index)

/**
 * Every ledger this thread could mean, best first.
 *
 * THIS REPLACED matchOnFile, and the difference is the point of the change.
 * matchOnFile scored the typeahead's first five hits, took the single best
 * above 0.75, and handed it back as "the record already on file for this
 * customer" — from which a draft was filled with no review in between. Its own
 * comment argued the threshold carefully and was right about everything except
 * the shape of the answer: against a list holding seventeen Morgan Stanley
 * ledgers, there IS no single best record, and the top-scoring one differs from
 * the runner-up by an address, a GSTIN and a state that decides the tax split.
 *
 * Scored over the whole master rather than the typeahead's first five, because
 * that ranking is by prefix and recency and neither is likeness — the right
 * ledger was routinely not among the five that got scored.
 */
export function candidatesOnFile(extracted: {
  name: string
  gstin?: string
}): Candidate[] {
  if (extracted.name.trim() === '') return []
  return rankCandidates(extracted, allCustomers())
}

/**
 * Last line of defence. The prompt says not to return Newtech's details; this
 * makes sure a slip cannot put our own address on a quotation addressed to us.
 */
export function rejectOwnDetails(c: ExtractedCustomer): ExtractedCustomer {
  const haystack = [c.name, c.address, c.attention].join('\n').toLowerCase()
  const looksInternal =
    /newtech/i.test(c.name) ||
    haystack.includes('saki vihar') ||
    INTERNAL_EMAIL_DOMAINS.some((domain) => haystack.includes(`@${domain}`))

  if (!looksInternal) return c
  return { name: '', address: '', attention: '', gstin: '', state: '', confidence: 'low' }
}

// --- Turning a read into something a draft can be filled from ---------------

const FIELDS = ['name', 'address', 'attention', 'gstin', 'state'] as const

/**
 * The labels the screens already use, so a field named as missing reads as the
 * field the user is looking at rather than as a property name.
 */
const FIELD_LABELS: Record<(typeof FIELDS)[number], string> = {
  name: 'Customer',
  address: 'Address',
  attention: 'Kind attention',
  gstin: 'GSTIN',
  state: 'Ship-to state',
}

type Source = 'thread' | 'on-file'

const DEFAULT_ORDER: readonly Source[] = ['on-file', 'thread']

/**
 * Thread-first. Attention always reads this way; the address does only when the
 * stored copy turns out to be the same address with its lines run together.
 * Both reasons are argued at the top of the loop below.
 */
const THREAD_FIRST: readonly Source[] = ['thread', 'on-file']

export interface CustomerResolution {
  /**
   * Never null here. `customer: null` is the ROUTE's signal that the read
   * itself failed; a read that succeeded and found nothing comes back with all
   * five fields blank and every label in customerMissing. AiReadResponseSchema
   * says why the two have to stay distinguishable.
   *
   * ALL FIVE ARE ALSO BLANK when customerCandidates is non-empty, and that is
   * not a failure of any kind — it is the read having narrowed the master to a
   * shortlist that only a person can choose from.
   */
  customer: ResolvedCustomer
  customerConfidence: AiReadResponse['customerConfidence']
  customerFrom: AiReadResponse['customerFrom']
  customerMissing: string[]
  /**
   * The fields where the source that LOST held a different, non-empty value —
   * a disagreement between the thread and the file, never a blank.
   */
  customerConflicts: string[]
  customerNote?: string
  customerCandidates: CustomerCandidate[]
}

/**
 * Nobody reviews these on a panel before they land on a document, so a freshly
 * read GSTIN has to earn its place.
 *
 * Case and stray spacing are normalised rather than rejected — a GSTIN is an
 * identifier, not prose, and "27 aabcu9603r1zm" is the same number badly typed.
 * Anything that is not the right shape is dropped whole: half a GSTIN on a tax
 * document is worse than a blank someone fills in. The shape itself now lives
 * in shared/states.ts, because the debtors import applies the same rule to the
 * same values arriving from Tally.
 */
const cleanGstin = normaliseGstin

/**
 * The ship-to state decides the tax mode (shared/states.ts), so a freshly read
 * one has to be a state we recognise. The list's own spelling is returned, not
 * the thread's: taxModeForState and the editor's dropdown both match on it, and
 * "karnataka" read out of a signature must not arrive as an option that nothing
 * selects.
 */
function cleanState(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value === '') return ''
  return INDIAN_STATES.find((state) => state.toLowerCase() === value) ?? ''
}

/** The thread's own five values, guarded. */
function fromThread(extracted: ExtractedCustomer): ResolvedCustomer {
  return {
    name: extracted.name.trim(),
    address: extracted.address.trim(),
    attention: extracted.attention.trim(),
    gstin: cleanGstin(extracted.gstin),
    state: cleanState(extracted.state),
  }
}

/**
 * What the draft becomes if this ledger is the one.
 *
 * Per field, never record-wise: a ledger's address beside the thread's
 * attention is the ordinary outcome, and taking either side whole would throw
 * the other's half away. An empty value never wins, from either side — an
 * absence is not a statement that the field is blank.
 *
 * Computed for EVERY candidate at read time rather than for the one that gets
 * picked, which is what makes picking instant and keeps this precedence in one
 * place. It is pure string work over at most a dozen rows.
 */
export function mergeWithLedger(
  extracted: ExtractedCustomer,
  onFile: CustomerRecord,
): { customer: ResolvedCustomer; conflicts: string[]; note?: string } {
  const thread = fromThread(extracted)

  /**
   * The same two guards over the stored side, and for a stronger reason than
   * over the thread's: on-file WINS for both of these fields, so an unchecked
   * stored value is the one that reaches the document. cleanGstin normalises
   * rather than rejects, so a well-formed stored value comes back as stored.
   */
  const stored: ResolvedCustomer = {
    name: onFile.name.trim(),
    address: onFile.address.trim(),
    attention: onFile.attention.trim(),
    gstin: cleanGstin(onFile.gstin),
    state: cleanState(onFile.state),
  }

  const customer: ResolvedCustomer = { name: '', address: '', attention: '', gstin: '', state: '' }
  const conflicts: Record<Source, string[]> = { thread: [], 'on-file': [] }

  /**
   * The one case where a fresh read is allowed to beat the stored address.
   * Computed once because both the precedence below and the note at the end
   * turn on it, and they must not be able to disagree.
   */
  const repairedAddress = lostLineStructure(stored.address, thread.address)

  for (const field of FIELDS) {
    /**
     * ATTENTION INVERTS THE PRECEDENCE, on purpose.
     *
     * A ledger beats a fresh read for the other four fields, and for this one
     * it must not: the stored attention is whoever the LAST document was
     * addressed to and can be months stale, while the thread is whoever is
     * asking now. So the thread wins here and the ledger is only the fallback
     * for when the thread names nobody. This is the instruction, not an
     * oversight.
     *
     * ADDRESS INVERTS IT TOO, but only for the single case lostLineStructure
     * recognises: the same address, stored with its line breaks lost. That is a
     * repair and not a change of mind. It fires far less than it used to — the
     * debtors import rebuilds Tally's flattened addresses on the way in — but a
     * row the master taught itself from an old save can still be in that state.
     */
    const order =
      field === 'attention' || (field === 'address' && repairedAddress)
        ? THREAD_FIRST
        : DEFAULT_ORDER
    const valueFrom = (source: Source) => (source === 'thread' ? thread : stored)[field]

    /**
     * NAME IS THE LEDGER'S, always — it is the one field selecting a customer
     * actually decides. The thread's spelling of it is not a competing claim
     * about who they are, and letting it win would put "Azentio" on a document
     * whose GSTIN, address and state all came from AZENTIO SOFTWARE PVT LTD
     * (MALAD). It is still editable on the draft.
     */
    const winner =
      field === 'name' && stored.name !== ''
        ? ('on-file' as Source)
        : order.find((source) => valueFrom(source) !== '')
    if (!winner) continue

    customer[field] = valueFrom(winner)

    /**
     * A repaired address is not a disagreement. The stored copy it displaced
     * says the same thing badly, so flagging it would send the desk off to
     * compare two addresses that match. It gets its own note instead.
     */
    if (field === 'address' && repairedAddress) continue

    /**
     * ...and what the winner overruled. A customer who has moved office has the
     * new address in the thread and last year's on file; the ledger wins, and
     * the desk hears which fields it beat here rather than from the customer.
     * Only a non-empty loser counts — an absence disagrees with nothing.
     *
     * The name is exempt: every branch ledger is spelled differently from how a
     * thread writes the company, so flagging it would fire on nearly every
     * quotation and teach the desk to stop reading these.
     */
    if (field === 'name') continue

    for (const loser of order) {
      if (loser === winner) continue
      const beaten = valueFrom(loser)
      if (beaten !== '' && !sameValue(beaten, customer[field])) {
        conflicts[loser].push(FIELD_LABELS[field])
      }
    }
  }

  /**
   * A guard dropping a STORED value is not an error — the ledger is fine, one
   * field of it is not — but it must not be silent either. Without this the
   * blank reads as a customer who simply has no GSTIN, and nobody has the
   * customer list open while a quotation is being made: this is the only place
   * anyone finds out that a row needs fixing.
   *
   * Rarer than it was, because the debtors import refuses to store a malformed
   * GSTIN in the first place and names the ledger in its report. Not gone: a
   * row the master taught itself from an old save can still hold one.
   */
  const dropped: string[] = []
  if (onFile.gstin.trim() !== '' && stored.gstin === '') dropped.push('GSTIN')
  if (onFile.state.trim() !== '' && stored.state === '') dropped.push('ship-to state')

  const notes = [
    droppedNote(dropped, 'on-file'),
    conflictNote(conflicts.thread, 'thread'),
    conflictNote(conflicts['on-file'], 'on-file'),
    repairedAddress ? REPAIRED_ADDRESS_NOTE : undefined,
  ].filter((note): note is string => note !== undefined)

  return {
    customer,
    conflicts: [...conflicts.thread, ...conflicts['on-file']],
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  }
}

/**
 * Turn a read into what the screens work from.
 *
 * TWO OUTCOMES, and which one you get depends entirely on whether the master
 * holds anything this thread could mean:
 *
 *   candidates found — NOTHING is filled in. The shortlist comes back, each
 *     entry carrying the block the draft would take if it were chosen, and the
 *     desk chooses. This is the rule the whole change exists for: a name is not
 *     an identity on a list where seventeen ledgers answer to "Morgan Stanley".
 *
 *   nothing found — the thread's own guarded values fill the draft, exactly as
 *     before. There is nothing to choose between, so there is nothing to ask
 *     about; this is a company being quoted before Tally has it, which is
 *     ordinary and must stay frictionless.
 */
export function resolveCustomer(
  extracted: ExtractedCustomer,
  candidates: readonly Candidate[],
): CustomerResolution {
  const thread = fromThread(extracted)

  const dropped: string[] = []
  if (extracted.gstin.trim() !== '' && thread.gstin === '') dropped.push('GSTIN')
  if (extracted.state.trim() !== '' && thread.state === '') dropped.push('ship-to state')
  const droppedThread = droppedNote(dropped, 'thread')

  if (candidates.length > 0) {
    const offered: CustomerCandidate[] = candidates.map((candidate) => {
      const merged = mergeWithLedger(extracted, candidate.record)
      return {
        record: toRecordDto(candidate.record),
        score: candidate.score,
        gstinMatch: candidate.gstinMatch,
        ...merged,
      }
    })

    return {
      /**
       * THE NAME SURVIVES; the other four do not.
       *
       * The four that decide what prints and what tax applies — address,
       * attention, GSTIN, ship-to state — stay blank because they differ
       * between the candidates and choosing one is the whole question. The name
       * does not have that problem: it is simply what the thread said, it is
       * what the chooser has to ask its question with ("5 customers could be
       * Morgan Stanley"), and it is what a desk who answers "none of these"
       * should find already in the box rather than having to retype.
       *
       * It is not an identity and cannot be mistaken for one: a save carrying
       * it without a chosen ledger is refused by requireCustomerChoice.
       */
      customer: { name: thread.name, address: '', attention: '', gstin: '', state: '' },
      customerConfidence: extracted.confidence,
      customerFrom: 'on-file',
      // Nothing is missing. It is unchosen, which is a different thing, and
      // listing five fields as absent would read as a failed read.
      customerMissing: [],
      customerConflicts: [],
      customerNote: [chooseNote(offered, extracted.name), droppedThread]
        .filter((n): n is string => n !== undefined)
        .join(' '),
      customerCandidates: offered,
    }
  }

  const customerMissing = FIELDS.filter((field) => thread[field] === '').map(
    (field) => FIELD_LABELS[field],
  )

  return {
    customer: thread,
    // The model's own confidence, unchanged. It grades how clearly the thread
    // identified a customer; raising it because a record happened to be found
    // would be us inventing a number nobody measured.
    customerConfidence: extracted.confidence,
    customerFrom: 'thread',
    customerMissing,
    customerConflicts: [],
    ...(droppedThread !== undefined ? { customerNote: droppedThread } : {}),
    customerCandidates: [],
  }
}

/** The wire shape of a ledger. Kept beside the merge so the two cannot drift. */
function toRecordDto(record: CustomerRecord): CustomerCandidate['record'] {
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    attention: record.attention,
    gstin: record.gstin,
    state: record.state,
    contact: record.contact,
    email: record.email,
    country: record.country,
    regType: record.regType,
    source: record.source,
    quoteCount: record.quoteCount,
    lastUsedAt: record.lastUsedAt,
  }
}

/**
 * Says how many and WHY it cannot decide, rather than "please select a
 * customer". The desk is about to be shown several rows that look nearly
 * identical, and the sentence's job is to tell them what actually separates
 * those rows before they start reading.
 */
function chooseNote(candidates: CustomerCandidate[], readName: string): string {
  const named = readName.trim() === '' ? 'this thread' : `"${readName.trim()}"`

  if (candidates.length === 1) {
    return `One customer on your list looks like ${named}. Check it is the right one and choose it — nothing has been filled in yet.`
  }

  const registrations = new Set(candidates.map((c) => c.record.gstin).filter((g) => g !== ''))
  const states = new Set(candidates.map((c) => c.record.state).filter((s) => s !== ''))

  const differ =
    registrations.size > 1 && states.size > 1
      ? ' They have different GSTINs and different ship-to states, so the tax split depends on which one you pick.'
      : registrations.size > 1
        ? ' They have different GSTINs.'
        : ' They share a GSTIN, so the address is what separates them.'

  return `${candidates.length} customers on your list could be ${named}.${differ} Choose one — nothing has been filled in yet.`
}

/**
 * Two values disagree when they SAY different things. Case and spacing are how
 * a value was typed rather than what it says, and a note that fires on
 * "Kharadi, Pune" against "kharadi,  pune" is noise — which is what teaches
 * people to stop reading the notes.
 */
function sameValue(a: string, b: string): boolean {
  const flatten = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
  return flatten(a) === flatten(b)
}

/**
 * Whether the stored address is the SAME address as the fresh read, with its
 * line structure lost.
 *
 * A record corrupted at some point in the past — "Plot 66, Sec 44Gurugram,
 * Haryana - 122001", two lines run together with nothing between them — wins
 * on-file precedence and then prints that way on every future quotation for
 * that customer, because each save hands the broken value back. Precedence is
 * right in general: a stored address was confirmed by somebody saving a
 * quotation with it. It is wrong here, because these two are not competing
 * claims about where the customer is. They are one claim, and one copy of it is
 * legible.
 *
 * Sameness is judged with ALL whitespace removed and case folded, which is the
 * narrowest test that can call these two strings the same: two genuinely
 * different addresses do not survive it, not even ones sharing most of their
 * text, so on-file still wins everywhere it should. The line count then fixes
 * the direction, so a stored address that HAS its breaks can never lose to a
 * flattened read of the same one.
 */
function lostLineStructure(stored: string, fresh: string): boolean {
  if (stored === '' || fresh === '') return false

  const squash = (value: string) => value.replace(/\s+/g, '').toLowerCase()
  if (squash(stored) !== squash(fresh)) return false

  return printedLines(fresh) > printedLines(stored)
}

/**
 * Lines that would PRINT. A run of blank lines is spacing rather than
 * structure, and counting it would let a stored address lose to a fresh one
 * that says the same thing in the same shape with padding round it.
 */
function printedLines(value: string): number {
  return value.split('\n').filter((line) => line.trim() !== '').length
}

/**
 * Names the field the way the screens do, and says the address itself did not
 * change — otherwise this reads as a third source of addresses rather than as
 * the same one straightened out.
 */
const REPAIRED_ADDRESS_NOTE =
  'The Address on your customer list has lost its line breaks; the same address, read from the thread, was used.'

function droppedNote(dropped: string[], source: Source): string | undefined {
  if (dropped.length === 0) return undefined

  const where = source === 'thread' ? 'read from the thread' : 'on your customer list'
  if (dropped.length === 1) {
    return `The ${dropped[0]} ${where} does not look valid, so it was not used.`
  }
  return `The ${dropped.join(' and ')} ${where} do not look valid, so they were not used.`
}

/**
 * Names the overruled fields rather than counting them: "a different Address"
 * is something the desk can check in ten seconds, "some details differ" sends
 * them looking through five.
 */
function conflictNote(labels: string[], losing: Source): string | undefined {
  if (labels.length === 0) return undefined

  const list = labels.join(' and ')
  const kept = labels.length > 1 ? 'the ones' : 'the one'
  const wasUsed = labels.length > 1 ? 'were used' : 'was used'

  return losing === 'thread'
    ? `The thread gives a different ${list}; ${kept} on your customer list ${wasUsed}.`
    : `Your customer list gives a different ${list}; ${kept} from the thread ${wasUsed}.`
}
