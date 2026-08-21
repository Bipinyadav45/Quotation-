import { z } from 'zod'
import type { AiReadResponse, ResolvedCustomer } from '@shared/schema.js'
import { INDIAN_STATES } from '@shared/states.js'
import { config } from '../config.js'
import { askAi, type AiResult } from './ai.js'
import { findCustomerByName, searchCustomers, type CustomerRecord } from './customers.js'
import { similarity, tokenize } from './similarity.js'

/**
 * Read the customer's details out of an RFQ thread.
 *
 * The hard part is not extraction, it is knowing whose details to take: every
 * one of these threads carries Newtech's own signature block, usually several
 * times, and it is longer and tidier than the customer's. So the internal
 * domain is passed in and the model is told explicitly to skip it.
 *
 * Nothing here writes to a quotation. The result is a suggestion, shown with
 * its provenance and accepted field by field.
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

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The customer company name. "" if not stated.' },
    address: {
      type: 'string',
      description: 'The customer postal address, newline separated. "" if not stated.',
    },
    attention: {
      type: 'string',
      description: 'The person to address it to, e.g. "Mr. Mahesh Jathar". "" if not stated.',
    },
    gstin: { type: 'string', description: 'Their 15-character GSTIN. "" if not stated.' },
    state: {
      type: 'string',
      description: 'Their Indian state, spelled in full, e.g. "Karnataka". "" if not stated.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'How clearly the thread identified the customer.',
    },
  },
  required: ['name', 'address', 'attention', 'gstin', 'state', 'confidence'],
  additionalProperties: false,
} as const

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

export interface ExtractionResult {
  extracted: ExtractedCustomer
  /**
   * The matching row from the customer master, when there is one.
   *
   * A stored record beats a fresh read of an email footer every time: it was
   * confirmed by someone saving a quotation with it, and a GSTIN read out of a
   * signature is a suggestion, not a verification.
   */
  onFile: CustomerRecord | null
}

export async function extractCustomerFromThread(
  thread: string,
): Promise<AiResult<ExtractionResult>> {
  const ours = INTERNAL_EMAIL_DOMAINS.map((d) => `"@${d}"`).join(' or ')

  const system = `You read B2B email threads at an Indian IT hardware reseller and pull out the CUSTOMER's details.

The reseller is Newtech Computer Services Pvt. Ltd. Their email addresses end in
${ours}. Their signature block appears in almost every message, often several
times, and their address is 6th Floor, Solaris-II, Saki Vihar Road, Powai, Mumbai.

NEVER return Newtech's details. You want the other party — whoever is asking for a quotation.

Rules:
- Copy values exactly as written. Do not correct, expand or reformat them.
- A field you cannot find is "", never a guess. An invented address on a
  quotation is worse than a blank one someone types.
- "attention" is the individual the quotation should be addressed to, with any
  honorific, as the thread writes it.
- "state" is the Indian state, spelled in full. Infer it from the city only
  when the city is unambiguous (Bengaluru -> Karnataka, Powai -> Maharashtra).
- "gstin" is 15 characters. If you cannot see one, "".
- confidence: "high" when the thread clearly identifies one customer,
  "medium" when you had to infer, "low" when you are unsure who the customer is.`

  const result = await askAi({
    system,
    user: thread,
    outputSchema: OUTPUT_SCHEMA,
    validate: ExtractedCustomerSchema,
    effort: 'low',
  })

  if (!result.ok) return result

  const extracted = result.data
  const guard = rejectOwnDetails(extracted)

  // Prefer what we already hold, but only when it is the same company.
  // matchOnFile is where "the same company" is decided.
  const onFile = guard.name.trim() === '' ? null : matchOnFile(guard.name)

  return { ok: true, data: { extracted: guard, onFile } }
}

/**
 * How alike two names have to be before a stored record is treated as the same
 * company.
 *
 * searchCustomers is a SQL substring match with no floor of its own: a thread
 * naming "Kirloskar" fetches every Kirloskar on the list, and taking the first
 * of them put one group company's address and GSTIN onto a document addressed
 * to another — with no review panel left in front of it.
 *
 * priceHistory.ts has already argued the number, for this question in another
 * costume. Section 6's 0.42 is a PAIRING threshold: several candidates competed
 * and the best of them won. This is an IDENTITY threshold — a single stored
 * record either is this customer or is not, and nothing competes with it — so
 * it takes that file's 0.75. "Datamatics Global Services" against the stored
 * "Datamatics Global Services Limited" scores 0.857 and is kept; "Kirloskar"
 * against "Kirloskar Brothers Limited" scores 0.5 and is not.
 *
 * Erring strict is cheap and erring loose is not: a customer we fail to
 * recognise costs a re-typed GSTIN, one we recognise wrongly costs a different
 * company's GSTIN on a tax document.
 */
const NAME_MATCH_THRESHOLD = 0.75

/**
 * The record already on file for this customer, or null.
 *
 * Exact name first — that arm was never the risky one, and it is untouched.
 * Only when it misses are the typeahead's candidates scored, and several are
 * fetched rather than one because searchCustomers ranks by prefix and recency,
 * neither of which is likeness. Nothing near enough is null rather than a best
 * effort: the thread's own values then stand, which is what the customer
 * actually wrote.
 */
function matchOnFile(name: string): CustomerRecord | null {
  const exact = findCustomerByName(name)
  if (exact) return exact

  const wanted = tokenize(name)
  if (wanted.size === 0) return null

  let best: { record: CustomerRecord; score: number } | null = null
  for (const candidate of searchCustomers(name, 5)) {
    // No part codes in a company name, so there is no shared-code bonus to claim.
    const score = similarity(wanted, tokenize(candidate.name), false)
    if (best === null || score > best.score) best = { record: candidate, score }
  }

  return best !== null && best.score >= NAME_MATCH_THRESHOLD ? best.record : null
}

/**
 * Last line of defence. The prompt says not to return Newtech's details; this
 * makes sure a slip cannot put our own address on a quotation addressed to us.
 */
function rejectOwnDetails(c: ExtractedCustomer): ExtractedCustomer {
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

/** Attention alone reads the thread first — see the comment in the loop below. */
const ATTENTION_ORDER: readonly Source[] = ['thread', 'on-file']

export interface CustomerResolution {
  /**
   * Never null here. `customer: null` is the ROUTE's signal that the read
   * itself failed; a read that succeeded and found nothing comes back with all
   * five fields blank and every label in customerMissing. AiReadResponseSchema
   * says why the two have to stay distinguishable.
   */
  customer: ResolvedCustomer
  customerConfidence: AiReadResponse['customerConfidence']
  customerFrom: AiReadResponse['customerFrom']
  customerMissing: string[]
  /**
   * The fields where the source that LOST held a different, non-empty value —
   * a disagreement between the thread and the file, never a blank. Plain
   * strings rather than a type read off AiReadResponse because the shared
   * schema has no such field yet, and a value being overruled in silence
   * should not have to wait on a schema edit to stop being silent.
   */
  customerConflicts: string[]
  customerNote?: string
}

/**
 * A GSTIN is 15 characters: a two-digit state code, the holder's ten-character
 * PAN, an entity number, a fixed "Z", and a check character.
 */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/

/**
 * Nobody reviews these on a panel before they land on a document any more, so a
 * freshly read GSTIN has to earn its place.
 *
 * Case and stray spacing are normalised rather than rejected — a GSTIN is an
 * identifier, not prose, and "27 aabcu9603r1zm" is the same number badly typed.
 * Anything that is not the right shape is dropped whole: half a GSTIN on a tax
 * document is worse than a blank someone fills in.
 */
function cleanGstin(raw: string): string {
  const value = raw.replace(/\s+/g, '').toUpperCase()
  return value.length === 15 && GSTIN_SHAPE.test(value) ? value : ''
}

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

/**
 * Merge a fresh read with whatever is already on file into the block a draft is
 * filled from.
 *
 * Per field, never record-wise: a stored address beside a freshly read GSTIN is
 * an ordinary outcome, and taking either record whole would throw the other
 * half away. An empty value never wins, from either side — an absence is not a
 * statement that the field is empty.
 */
export function resolveCustomer(
  extracted: ExtractedCustomer,
  onFile: CustomerRecord | null,
): CustomerResolution {
  const thread: ResolvedCustomer = {
    name: extracted.name.trim(),
    address: extracted.address.trim(),
    attention: extracted.attention.trim(),
    gstin: cleanGstin(extracted.gstin),
    state: cleanState(extracted.state),
  }

  /**
   * The same two guards over the stored side, and for a stronger reason than
   * over the thread's: on-file WINS for both of these fields, so an unchecked
   * stored value is the one that reaches the document. A GSTIN typed into a
   * quotation months ago was confirmed by somebody saving it, which is not the
   * same as having been read. cleanGstin normalises rather than rejects, so a
   * well-formed stored value comes back exactly as it was stored.
   */
  const stored: ResolvedCustomer = {
    name: onFile?.name.trim() ?? '',
    address: onFile?.address.trim() ?? '',
    attention: onFile?.attention.trim() ?? '',
    gstin: cleanGstin(onFile?.gstin ?? ''),
    state: cleanState(onFile?.state ?? ''),
  }

  const customer: ResolvedCustomer = { name: '', address: '', attention: '', gstin: '', state: '' }
  const customerMissing: string[] = []
  const conflicts: Record<Source, string[]> = { thread: [], 'on-file': [] }
  const used = new Set<Source>()

  for (const field of FIELDS) {
    /**
     * ATTENTION INVERTS THE PRECEDENCE, on purpose.
     *
     * ExtractionResult above says a stored record beats a fresh read, and for
     * the other four fields it does. Not for this one: the stored attention is
     * whoever the LAST document was addressed to and can be months stale, while
     * the thread is whoever is asking now. So the thread wins here and the file
     * is only the fallback for when the thread names nobody. This is the
     * instruction, not an oversight.
     */
    const order = field === 'attention' ? ATTENTION_ORDER : DEFAULT_ORDER
    const valueFrom = (source: Source) => (source === 'thread' ? thread : stored)[field]

    const winner = order.find((source) => valueFrom(source) !== '')
    if (!winner) {
      customerMissing.push(FIELD_LABELS[field])
      continue
    }

    customer[field] = valueFrom(winner)
    used.add(winner)

    /**
     * ...and what the winner overruled. A customer who has moved office has
     * the new address in the thread and last year's on file; the stored one
     * wins, and the desk hears which fields it beat here rather than from the
     * customer. Only a non-empty loser counts — an absence disagrees with
     * nothing.
     */
    for (const loser of order) {
      if (loser === winner) continue
      const beaten = valueFrom(loser)
      if (beaten !== '' && !sameValue(beaten, customer[field])) {
        conflicts[loser].push(FIELD_LABELS[field])
      }
    }
  }

  /**
   * Where the surviving values actually came from. Nothing surviving at all
   * only happens when there was no record to draw on, so the thread is the
   * honest answer: it is the read that came back empty.
   */
  const customerFrom =
    used.has('thread') && used.has('on-file')
      ? 'both'
      : used.has('on-file')
        ? 'on-file'
        : 'thread'

  /**
   * A guard dropping a value is not an error — the read worked, one field of it
   * did not survive — but it is not silent either. Without this the blank looks
   * like a thread that never mentioned the field. A dropped STORED value is
   * announced for the same reason and needs it more: nobody has the customer
   * list open while a quotation is being made, so a bad value sitting in it is
   * only ever noticed here.
   */
  const dropped: Record<Source, string[]> = { thread: [], 'on-file': [] }
  if (extracted.gstin.trim() !== '' && thread.gstin === '') dropped.thread.push('GSTIN')
  if (extracted.state.trim() !== '' && thread.state === '') dropped.thread.push('ship-to state')
  if ((onFile?.gstin.trim() ?? '') !== '' && stored.gstin === '') {
    dropped['on-file'].push('GSTIN')
  }
  if ((onFile?.state.trim() ?? '') !== '' && stored.state === '') {
    dropped['on-file'].push('ship-to state')
  }

  /**
   * At most four sentences and usually none: either guard having dropped
   * something, either source having been overruled. customerConflicts carries
   * the same disagreements as labels, for a screen that would rather mark the
   * fields than print a sentence.
   */
  const notes = [
    droppedNote(dropped.thread, 'thread'),
    droppedNote(dropped['on-file'], 'on-file'),
    conflictNote(conflicts.thread, 'thread'),
    conflictNote(conflicts['on-file'], 'on-file'),
  ].filter((note): note is string => note !== undefined)

  return {
    customer,
    // The model's own confidence, unchanged. It grades how clearly the thread
    // identified a customer; raising it because a record happened to be found
    // would be us inventing a number nobody measured.
    customerConfidence: extracted.confidence,
    customerFrom,
    customerMissing,
    customerConflicts: [...conflicts.thread, ...conflicts['on-file']],
    customerNote: notes.length > 0 ? notes.join(' ') : undefined,
  }
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
