import { z } from 'zod'

/**
 * §4's data model, declared once.
 *
 * These schemas are the single contract in the system. They provide:
 *   - the TypeScript types, via z.infer
 *   - request validation on every Express route
 *   - the output constraint handed to Claude by the fallback parser
 *
 * Change a field here and every consumer either follows or fails the build.
 *
 * MONEY IS INTEGER PAISE. §4 types rates and totals as `number` without stating
 * a unit; we pin it to paise and enforce it with .int(), because a rate held as
 * a float eventually produces a total that is one paisa off, and a quotation
 * that is one paisa off is a quotation the customer's system rejects. The UI
 * parses "1,250.00" into 125000 on the way in and formats it back on the way
 * out — see shared/money.ts.
 */

export const RoleSchema = z.enum(['request', 'offer'])
export type Role = z.infer<typeof RoleSchema>

export const LineSourceSchema = z.enum(['pattern', 'llm', 'manual'])
export type LineSource = z.infer<typeof LineSourceSchema>

export const ParsedLineSchema = z.object({
  id: z.string(),
  /** The source line, verbatim, for audit. Never rewritten. */
  raw: z.string(),
  /** Description with qty/price stripped. */
  desc: z.string(),
  /** Brand, when one is detected. See server/src/lib/makes.ts (Correction 4). */
  make: z.string(),
  /** e.g. BI-TCHUGP, MK540 */
  partCode: z.string(),
  qty: z.number().int().nonnegative(),
  /** Unit rate in PAISE, exclusive of tax. 0 when absent. */
  rate: z.number().int().nonnegative(),
  role: RoleSchema,
  source: LineSourceSchema,
  /**
   * §5: "a priced line in a customer block should be surfaced for manual
   * reassignment rather than silently classified. Heuristics are a starting
   * position, not a verdict."
   *
   * §4 has no field for that, so this is an additive optional one. Set when the
   * sender's domain disagrees with the role the price/qty heuristic chose, so
   * the quotation screen can mark the line.
   */
  roleUncertain: z.boolean().optional(),
})
export type ParsedLine = z.infer<typeof ParsedLineSchema>

export const QuoteItemSchema = z.object({
  desc: z.string(),
  make: z.string(),
  partCode: z.string(),
  hsn: z.string().optional(),
  qty: z.number().int().nonnegative(),
  /** Unit rate in PAISE, exclusive of tax. */
  rate: z.number().int().nonnegative(),
})
export type QuoteItem = z.infer<typeof QuoteItemSchema>

export const TaxModeSchema = z.enum(['IGST', 'CGST+SGST'])
export type TaxMode = z.infer<typeof TaxModeSchema>

export const CustomerSchema = z.object({
  name: z.string(),
  address: z.string(),
  attention: z.string(),
  gstin: z.string().optional(),
  state: z.string().optional(),
})
export type Customer = z.infer<typeof CustomerSchema>

export const TermsSchema = z.object({
  payment: z.string(),
  delivery: z.string(),
  prices: z.string(),
  validity: z.string(),
  /**
   * Term 5. Unlike the four above it is routinely blank, and blank means the
   * quotation prints four terms — a "5. Warranty :" with nothing after it is
   * worse than no line at all.
   *
   * Defaulted rather than plain because it arrived after quotations were
   * already being saved: a client that has not been taught to send it is not
   * making a malformed request, it is saying no warranty was stated, and ''
   * says that. Parsed, the value is always a string, so nothing downstream has
   * to tell a blank warranty from a missing one — and the column it is stored
   * in says it the same way, for the rows written before it existed
   * (003_warranty.sql).
   */
  warranty: z.string().default(''),
})
export type Terms = z.infer<typeof TermsSchema>

export const QuoteSchema = z.object({
  id: z.string(),
  /** NCS/2026-27/Quotes/RG/031 */
  ref: z.string(),
  /** 0 = original, 1 = "Rev 1", ... */
  revision: z.number().int().nonnegative().default(0),
  /** ISO 8601 */
  date: z.string(),
  customer: CustomerSchema,
  /**
   * WHICH ledger in the customer master this quotation was addressed to.
   *
   * `customer.name` is the text that PRINTED; this is who it was. They are not
   * the same fact, and the list is the reason: sixteen ledgers are spelled
   * some version of "Datamatics Global Services Limited" and three Azentio
   * sites share a GSTIN, so a name alone cannot say which entity was billed.
   *
   * Null for a company quoted deliberately off the list, and for any quotation
   * saved before 004 existed — inventing a ledger for those now would be a
   * guess recorded as a fact.
   */
  customerId: z.string().nullable().default(null),
  contact: z.string(),
  email: z.string(),
  signatory: z.string(),
  /**
   * The closing line's numbers — "please call us at 40668812/88".
   *
   * The salesperson's, not the company's: the desk's two people close their
   * documents with different numbers. Stored beside contact, email and
   * signatory because a quotation records what was SENT, so a number that
   * changes later must not rewrite a document already with a customer.
   *
   * Blank on every quotation saved before 005, and the renderer falls those
   * back to the initials in the reference — see salespersonByInitials.
   */
  queriesNumbers: z.string().default(''),
  items: z.array(QuoteItemSchema),
  tax: z.object({ mode: TaxModeSchema, rate: z.number().int() }),
  terms: TermsSchema,
  /** All PAISE. */
  totals: z.object({
    sub: z.number().int(),
    tax: z.number().int(),
    total: z.number().int(),
  }),
  /** §4: keep the original email, always. */
  sourceThread: z.string(),
  status: z.enum(['draft', 'sent', 'won', 'lost']).default('draft'),
  createdAt: z.string(),
})
export type Quote = z.infer<typeof QuoteSchema>

// --- API contracts ---------------------------------------------------------

export const ParseRequestSchema = z.object({
  thread: z.string().min(1, 'Paste an email thread first'),
})
export type ParseRequest = z.infer<typeof ParseRequestSchema>

export const ParseResponseSchema = z.object({
  lines: z.array(ParsedLineSchema),
  source: LineSourceSchema,
  /**
   * Lines with content that produced no product. Surfaced rather than dropped:
   * a parser that silently discards what it cannot read is how a missed
   * quantity reaches a customer.
   */
  skipped: z.array(z.string()).default([]),
  /** Judgements the desk must make that the parser cannot — e.g. a superseded price. */
  warnings: z.array(z.string()).default([]),
  /** Set when the LLM parse failed and we fell back to the pattern parser (§5). */
  note: z.string().optional(),
  /**
   * Term 4, when WE stated one in the thread. Computed on the server because
   * only the server knows who wrote each line: read in the browser over the raw
   * text, a customer's own "rates should be valid for 90 days" came back as our
   * printed contractual term. Absent means the thread said nothing and the
   * default — the end of the current month — stands.
   */
  suggestedValidity: z.string().optional(),
})
export type ParseResponse = z.infer<typeof ParseResponseSchema>

/**
 * Saving a quote. The client never sends `ref`, `revision`, `totals` or
 * `createdAt`: the reference is allocated server-side on save (§7) and the
 * totals are recomputed from the items, so a stale or tampered figure in the
 * browser can never reach a document.
 */
export const SaveQuoteRequestSchema = z.object({
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  /** Drives the reference series, e.g. "RG". */
  initials: z.string().min(1, 'Initials are needed to allocate a reference'),
  customer: CustomerSchema,
  /**
   * The ledger the desk SELECTED, when they selected one.
   *
   * This is the field that makes "pick the company" a rule rather than a screen
   * that can be walked past. The server refuses a save whose customer name
   * matches ledgers on file unless one of them is named here — see
   * requireCustomerChoice in routes/quote.ts. Sending it IS the act of
   * choosing, which is why it is not merely a hint.
   *
   * Omitted means no ledger was picked, and that is only allowed when the name
   * matches nothing on file: a company being quoted before Tally has it.
   */
  customerId: z.string().optional(),
  /**
   * "None of these — this company is not on my list."
   *
   * The deliberate escape hatch from the rule above, and it has to be explicit
   * rather than inferred from a blank customerId, because those two situations
   * look identical on the wire and mean opposite things: one is a desk that has
   * not answered the question yet, the other is a desk that has answered it.
   * Quoting a company before Tally has it is ordinary and must stay possible;
   * doing it BY ACCIDENT, because a chooser was scrolled past, is the thing
   * being prevented.
   *
   * Ignored when customerId is present — a chosen ledger is not off the list.
   */
  customerOffList: z.boolean().optional(),
  contact: z.string(),
  email: z.string(),
  signatory: z.string(),
  /**
   * The closing line's numbers — "please call us at 40668812/88".
   *
   * The salesperson's, not the company's: the desk's two people close their
   * documents with different numbers. Stored beside contact, email and
   * signatory because a quotation records what was SENT, so a number that
   * changes later must not rewrite a document already with a customer.
   *
   * Blank on every quotation saved before 005, and the renderer falls those
   * back to the initials in the reference — see salespersonByInitials.
   */
  queriesNumbers: z.string().default(''),
  items: z.array(QuoteItemSchema).min(1, 'A quotation needs at least one line'),
  tax: z.object({ mode: TaxModeSchema, rate: z.number().int() }),
  terms: TermsSchema,
  sourceThread: z.string(),
  /** Set to clone an existing quote as the next revision, keeping its ref (§10). */
  reviseOf: z.string().optional(),
  /**
   * The sequence number the desk chose for this quotation — the 045 of
   * NCS/2026-27/Quotes/RG/045.
   *
   * OMITTING IT MEANS "allocate the next one in the series", which is what
   * every existing caller does and must keep doing: the reference stays the
   * server's to hand out on save (§7) unless the desk deliberately says
   * otherwise. Sent, it is both the number used and the number the counter is
   * carried up to, so the save after it continues from 046 rather than handing
   * back what was just typed.
   *
   * Ignored on a revision. A revision inherits its parent's reference (§10), so
   * there is no number left to choose.
   */
  seqOverride: z.number().int().positive('A reference number starts at 001').optional(),
})
export type SaveQuoteRequest = z.infer<typeof SaveQuoteRequestSchema>

/**
 * A field that belongs to a save and cannot belong to an update.
 *
 * Typed as "must be absent" rather than left out of the schema, because a key
 * merely left out is a key silently thrown away — and an update that accepted
 * new initials, kept the old reference and said nothing would be the very
 * divergence between the screen and the record that PUT exists to end. Present
 * with a value, it is a 400 carrying this sentence; absent, it costs nothing.
 */
const notOnAnUpdate = (message: string) => z.undefined({ invalid_type_error: message })

/**
 * Editing a quotation that is already saved, in place (PUT /api/quotes/:id).
 *
 * The same body a save takes, minus everything that decides a reference.
 * `ref` and `revision` are the quotation's identity — they are printed on a
 * document that may already be with a customer — so an update must not be able
 * to reach them: `initials` chooses the series, `seqOverride` chooses the
 * number, and `reviseOf` takes a different reference altogether.
 *
 * Built by overriding those three on SaveQuoteRequestSchema rather than by
 * restating the fields, so a field added to a save is a field an edit can
 * change on the same day rather than one the two schemas quietly disagree
 * about.
 *
 * `totals` is not mentioned here for the same reason it is not mentioned on a
 * save: it is recomputed from the items server-side, so a figure the browser
 * sends is ignored rather than trusted.
 */
export const UpdateQuoteRequestSchema = SaveQuoteRequestSchema.extend({
  initials: notOnAnUpdate(
    'initials cannot change on an edit: they are part of the reference this quotation ' +
      'already carries. Save it as a new quotation to use another series.',
  ),
  seqOverride: notOnAnUpdate(
    'The reference number cannot change on an edit. Save it as a new quotation to ' +
      'choose another number.',
  ),
  reviseOf: notOnAnUpdate(
    'An edit rewrites this draft in place. To keep the version already saved, POST ' +
      '/api/quote with reviseOf and take the next revision number instead.',
  ),
})
export type UpdateQuoteRequest = z.infer<typeof UpdateQuoteRequestSchema>

/**
 * The five customer fields a read can put on a draft.
 *
 * All five are present and all five are strings: a field the read could not
 * determine is blank, and the blank is named in `customerMissing` rather than
 * left out of the object for the client to guess about.
 */
export const ResolvedCustomerSchema = z.object({
  name: z.string(),
  address: z.string(),
  attention: z.string(),
  gstin: z.string(),
  state: z.string(),
})
export type ResolvedCustomer = z.infer<typeof ResolvedCustomerSchema>

/**
 * One ledger of the customer master — the desk's Tally sundry debtors, plus
 * whatever quoting off that list has added. See server/src/lib/customers.ts.
 *
 * `id` is the identity. The NAME is not, and nothing may treat it as one: the
 * real list holds sixteen ledgers spelled some version of "Datamatics Global
 * Services Limited", and three Azentio sites that share a name AND a GSTIN and
 * differ only in their address.
 */
export const CustomerRecordSchema = CustomerSchema.extend({
  id: z.string(),
  gstin: z.string(),
  state: z.string(),
  /** Our contact and email as used for this customer. */
  contact: z.string(),
  email: z.string(),
  /**
   * Non-India for the five ledgers that are, and the reason `state` is blank on
   * them: "ship-to state" has no meaning for a Hong Kong address and must not
   * be guessed into one, because it decides the tax split.
   */
  country: z.string().default('India'),
  /** Tally's own: 'Regular', 'Regular - SEZ', 'Unregistered/Consumer'. */
  regType: z.string().default(''),
  /** 'tally' — from the debtors export. 'quote' — learned from a save. */
  source: z.enum(['tally', 'quote']).default('quote'),
  quoteCount: z.number().int(),
  lastUsedAt: z.string(),
})
export type CustomerRecord = z.infer<typeof CustomerRecordSchema>

/**
 * A ledger the thread might have meant, offered for a person to choose between.
 *
 * The reason this type exists at all: reading "Azentio Software Pvt Ltd" out of
 * an email does not identify a customer, it narrows the list to six. What the
 * chooser needs beyond the record itself is why it is on screen — `gstinMatch`
 * earns a row the top of the list — and the desk needs the ADDRESS visible,
 * because for the three Azentio sites it is the only thing that differs.
 */
export const CustomerCandidateSchema = z.object({
  record: CustomerRecordSchema,
  /** 0..1 — how much of the name the thread gave this ledger accounts for. */
  score: z.number(),
  /** The thread's own GSTIN is this ledger's. Never decisive on its own. */
  gstinMatch: z.boolean(),
  /**
   * Exactly what the draft becomes if this candidate is chosen — the ledger
   * merged with the thread, per field, by the precedence in
   * extractCustomer.mergeWithLedger.
   *
   * Computed for every candidate up front rather than for the one that wins,
   * which is worth a paragraph because it looks like waste. It is not: it makes
   * choosing instant and offline, it keeps ONE implementation of a precedence
   * that has real subtleties in it — the thread's Kind attention beats the
   * ledger's, a flattened stored address gets repaired — and the alternative
   * was a second round trip that re-read the thread, or shipping the raw
   * extraction to the browser so it could merge there. At a dozen candidates of
   * pure string work, this is the cheap option as well as the clear one.
   */
  customer: ResolvedCustomerSchema,
  /** Fields where the thread disagrees with THIS ledger. Never a blank. */
  conflicts: z.array(z.string()).default([]),
  /** Said about this ledger only — a disagreement, or an address repaired. */
  note: z.string().optional(),
})
export type CustomerCandidate = z.infer<typeof CustomerCandidateSchema>

export const CustomerSearchResponseSchema = z.object({
  customers: z.array(CustomerRecordSchema),
})

/** What we last quoted a product for. Never applied without a click. */
export const PriceMatchSchema = z.object({
  ratePaise: z.number().int(),
  description: z.string(),
  partCode: z.string(),
  customerName: z.string(),
  ref: z.string(),
  revision: z.number().int(),
  date: z.string(),
  timesQuoted: z.number().int(),
  via: z.enum(['part-code', 'description']),
})
export type PriceMatch = z.infer<typeof PriceMatchSchema>

/**
 * Customer details Claude read out of a thread. A suggestion: shown with its
 * provenance, accepted field by field, never written anywhere on its own.
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
 * What the one AI button answers with: the line items and the customer, read in
 * a single pass and already resolved against the customer master, so the draft
 * can be filled from it without a review panel in between.
 *
 * INVARIANT — `customer === null` means the customer READ FAILED. A read that
 * SUCCEEDED but found nothing returns an all-blank customer with every label in
 * `customerMissing`. Those are different situations and the UI must be able to
 * tell them apart: the first is worth pressing again, the second is a thread
 * that never named the customer and wants typing, not retrying.
 *
 * Either half may fail on its own without the other being affected, and neither
 * failure is an error: the route always answers 200 with this shape.
 */
export const AiReadResponseSchema = ParseResponseSchema.extend({
  customer: ResolvedCustomerSchema.nullable(),
  customerConfidence: z.enum(['high', 'medium', 'low']),
  /** Where the surviving values came from, not where they were looked for. */
  customerFrom: z.enum(['thread', 'on-file', 'both']),
  /** Human labels for the fields blank in BOTH the thread and the customer master. */
  customerMissing: z.array(z.string()).default([]),
  /**
   * Labels for fields where the thread held a DIFFERENT non-empty value and
   * lost to the customer master.
   *
   * `customerFrom` records where the winners came from but never what was
   * overruled, so a customer who has moved office got last year's address on
   * their quotation and nobody was told. This is the channel that says
   * so — and it is deliberately narrow: a disagreement is worth a sentence,
   * "we used your customer list again" on every repeat quotation is not.
   */
  customerConflicts: z.array(z.string()).default([]),
  /** Why the read failed, or why a value was dropped. Absent when there is nothing to say. */
  customerNote: z.string().optional(),
  /**
   * The ledgers this thread might mean, best first — and the reason the five
   * fields above may come back blank on a read that worked perfectly.
   *
   * WHEN THIS IS NON-EMPTY, NOTHING WAS FILLED IN. That is the rule, and it is
   * the whole point: a thread naming "Morgan Stanley" matches seventeen ledgers
   * across ten GSTINs and three states, so filling the draft from the
   * best-scoring one is picking a company's tax registration by coin toss. The
   * desk picks; until they do, the customer block stays empty and the save is
   * refused.
   *
   * Empty means there was nothing to choose between — the master holds no
   * ledger this thread could plausibly mean — and only then do the thread's own
   * values land on the draft, which is the ordinary case for a company being
   * quoted before Tally has it.
   */
  customerCandidates: z.array(CustomerCandidateSchema).default([]),
})
export type AiReadResponse = z.infer<typeof AiReadResponseSchema>

/** One row of the History table (§9 screen 5). */
export const QuoteSummarySchema = z.object({
  id: z.string(),
  ref: z.string(),
  revision: z.number().int(),
  date: z.string(),
  customerName: z.string(),
  total: z.number().int(),
  status: z.enum(['draft', 'sent', 'won', 'lost']),
  createdAt: z.string(),
})
export type QuoteSummary = z.infer<typeof QuoteSummarySchema>

export const UpdateStatusRequestSchema = z.object({
  status: z.enum(['draft', 'sent', 'won', 'lost']),
})

/**
 * What the LLM fallback parser is constrained to return. Deliberately narrower
 * than ParsedLine — `id` and `source` are assigned by us, never by the model.
 */
export const LlmParsedLineSchema = z.object({
  /** The source line, copied verbatim. */
  raw: z.string(),
  /** The product, with the quantity and price removed. */
  desc: z.string(),
  /** Brand if one is named, otherwise an empty string. */
  make: z.string(),
  /** Part or model code if one is present, otherwise an empty string. */
  partCode: z.string(),
  qty: z.number().int().nonnegative(),
  /**
   * The unit rate exactly as written in the line ("1,250" / "550.00"), or an
   * empty string when the line carries no price.
   *
   * Deliberately NOT paise: converting rupees to paise is arithmetic, and
   * asking a language model to do arithmetic it does not need to do only
   * creates a way for the number on a customer's quotation to be wrong. The
   * server converts it with the same parser the deterministic path uses.
   */
  rateText: z.string(),
  role: RoleSchema,
})
export const LlmParseResultSchema = z.object({
  lines: z.array(LlmParsedLineSchema),
})
export type LlmParseResult = z.infer<typeof LlmParseResultSchema>
