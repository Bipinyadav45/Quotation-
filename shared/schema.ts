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
   * sender's domain disagrees with the role the price/qty heuristic chose; the
   * reconcile screen marks the row so a human looks at it.
   */
  roleUncertain: z.boolean().optional(),
})
export type ParsedLine = z.infer<typeof ParsedLineSchema>

export const FlagKindSchema = z.enum([
  'spec', // a length value differs
  'brand', // brand dropped or changed
  'qty', // quantities differ
  'price', // offer carries no rate
  'missing', // requested but not quoted
  'extra', // quoted but not requested
  'code', // part code dropped
])
export type FlagKind = z.infer<typeof FlagKindSchema>

export const FlagSchema = z.object({
  kind: FlagKindSchema,
  text: z.string(),
  /**
   * §6: `block` does not prevent generating the document — it disables the
   * one-click path and requires the user to tick "reviewed" on that line.
   * The purchase desk sometimes upsizes deliberately; the app's job is to make
   * sure it was deliberate.
   */
  severity: z.enum(['warn', 'block']),
})
export type Flag = z.infer<typeof FlagSchema>

export const ReconciledPairSchema = z.object({
  request: ParsedLineSchema.nullable(),
  offer: ParsedLineSchema.nullable(),
  /** 0..1 match confidence. */
  score: z.number(),
  flags: z.array(FlagSchema),
})
export type ReconciledPair = z.infer<typeof ReconciledPairSchema>

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
  contact: z.string(),
  email: z.string(),
  signatory: z.string(),
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
  reconciliation: z.array(ReconciledPairSchema),
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
  /** Set when the LLM parse failed and we fell back to the pattern parser (§5). */
  note: z.string().optional(),
})
export type ParseResponse = z.infer<typeof ParseResponseSchema>

export const ReconcileRequestSchema = z.object({
  lines: z.array(ParsedLineSchema),
})
export type ReconcileRequest = z.infer<typeof ReconcileRequestSchema>

export const ReconcileResponseSchema = z.object({
  pairs: z.array(ReconciledPairSchema),
})
export type ReconcileResponse = z.infer<typeof ReconcileResponseSchema>

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
  contact: z.string(),
  email: z.string(),
  signatory: z.string(),
  items: z.array(QuoteItemSchema).min(1, 'A quotation needs at least one line'),
  tax: z.object({ mode: TaxModeSchema, rate: z.number().int() }),
  terms: TermsSchema,
  sourceThread: z.string(),
  reconciliation: z.array(ReconciledPairSchema),
  /** Set to clone an existing quote as the next revision, keeping its ref (§10). */
  reviseOf: z.string().optional(),
})
export type SaveQuoteRequest = z.infer<typeof SaveQuoteRequestSchema>

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
