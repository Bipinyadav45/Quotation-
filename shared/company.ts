/**
 * §1 — fixed company details. Printed on every quotation, never edited per quote.
 * Shared so the editor's defaults and the document renderer cannot drift apart.
 */
export const COMPANY = {
  name: 'Newtech Computer Services Pvt. Ltd.',
  /**
   * Two lines, exactly as the sent quotation breaks them. It used to be three,
   * with Powai and Mumbai split — which is how the blank letterhead has it, but
   * not how the document the customer receives does.
   */
  addressLines: [
    '6th Floor, Solaris-II, Opp L&T Gate-6,',
    'Saki Vihar Road, Powai, Mumbai - 400072.',
  ],
  tel: '022 40668888',
  cin: 'U99999MH1984PTC034412',
  /**
   * BLANK, AND DELIBERATELY SO. Nobody has supplied Newtech's own GSTIN yet,
   * and an invented tax number on a document a customer files against their
   * return is the worst outcome available here. Fill it in before the document
   * is used as a tax instrument; until then the From cell omits the line.
   */
  gstin: '',
  /** §7 — registered in Maharashtra; this decides the tax-mode default. */
  homeState: 'Maharashtra',
  /** §8 — the closing line, spelled exactly as the letterhead has it. */
  closingFor: 'For Newtech Computer Services Pvt., Ltd.',
} as const

/**
 * A GSTIN as the document PRINTS it — label and value in one string, or nothing
 * at all.
 *
 * A whole line rather than a value because docxtemplater substitutes a plain
 * string and nothing else: a literal "GSTIN: " label in the template beside a
 * value tag would print the label with an empty space after it on every
 * quotation whose customer has no GSTIN. Shared for the usual reason — the
 * document and the on-screen preview cannot phrase it differently.
 */
export function gstinLine(gstin: string | undefined): string {
  const value = gstin?.trim() ?? ''
  return value ? `GSTIN: ${value}` : ''
}

/**
 * The desk — two people, and every line of the document that names one of them
 * comes from here.
 *
 * Nothing on this list is shared between them. Initials drive the reference
 * series (§7), so one person's quotations never take a number from the other's;
 * the contact number and email in the From block are the salesperson's own, not
 * the company's; and so is the "call us at" line in the closing, which is the
 * one people assume is a company constant and is not. Both of the desk's own
 * documents are in the repository and they disagree on all four:
 *
 *   Ref: NCS/2026-27/Quotes/RG/030   022-40668809   rakhi.gupte@newtech.in
 *     ...  "please call us at 40668812/88"
 *   Ref: NCS/2026-27/Quotes/LD/34    40668803       Linda.pdmello@newtech.co.in
 *     ...  "please feel free to call us at 40668803/40668888"
 *
 * Two spellings worth not correcting: Linda's address is "Linda.pdmello" with
 * the p, on the "@newtech.co.in" domain rather than Rakhi's "@newtech.in", and
 * her surname carries a typographic apostrophe. All three are copied from the
 * quotation she sent — see Supporting Documents/. INTERNAL_EMAIL_DOMAINS in
 * extractCustomer.ts already knows both domains, which is what stops the
 * extractor reading either signature back as the customer's.
 */
export const SALESPEOPLE = [
  {
    initials: 'RG',
    name: 'Rakhi Gupte',
    phone: '022-40668809',
    email: 'rakhi.gupte@newtech.in',
    /** §8 — "If you have any queries, please call us at ...". */
    queriesNumbers: '40668812/88',
  },
  {
    initials: 'LD',
    name: 'Linda D’mello',
    phone: '40668803',
    email: 'Linda.pdmello@newtech.co.in',
    queriesNumbers: '40668803/40668888',
  },
] as const

export type Salesperson = (typeof SALESPEOPLE)[number]

export const DEFAULT_SALESPERSON: Salesperson = SALESPEOPLE[0]

/**
 * Whoever these initials belong to, or null.
 *
 * The reference carries the initials and nothing else identifies the author of
 * a quotation saved before the queries line was stored per person, so this is
 * how those documents still render the right closing.
 */
export function salespersonByInitials(initials: string): Salesperson | null {
  const wanted = initials.trim().toUpperCase()
  return SALESPEOPLE.find((s) => s.initials === wanted) ?? null
}

/** §7 — defaults, all editable on the quote. Validity is computed per quote. */
export const DEFAULT_TERMS = {
  payment: '100% Advance',
  delivery: '1-2 Weeks after PO',
  /**
   * It says all-inclusive of what the document shows — the total, carrying no
   * further freight, handling or installation — and NOT that the rates include
   * GST, which the GST row beneath them plainly contradicts. See
   * pricesTermFromLines in web/src/lib/draft.ts for why that distinction is the
   * reason this is not derived from the thread.
   *
   * It pointed at "this proforma invoice" while the document was headed that,
   * and follows the heading back now that it says Quotation again. The desk's
   * own documents write "as per the quote"; "this quotation" is the same claim
   * and names the page it is printed on.
   */
  prices: 'All-inclusive as per this quotation',
  /**
   * Term 5 prints on every document, so it needs something to say. This one
   * defers to the manufacturer rather than naming a length: the desk sells
   * many products with many warranties, and a default promising "1 Year" on a
   * machine carrying three would be wrong on the copy the customer keeps.
   *
   * It is overwritten whenever the thread states a warranty of its own, and it
   * is editable on every quotation.
   */
  warranty: 'As per OEM standard warranty',
} as const

/**
 * 18%, on every quotation, as one row reading "GST 18%".
 *
 * NOT A DEFAULT ANY MORE — a constant, at the desk's instruction. The editor
 * used to offer a rate box and a choice between IGST as one row and CGST + SGST
 * as two, defaulted from the ship-to state. Both documents the desk supplied as
 * correct print a single "GST 18%" row whatever the customer's state, so the
 * control existed only to make the document disagree with the letterhead.
 *
 * WHAT TO KNOW IF THIS EVER BECOMES A CONTROL AGAIN: for an intra-state sale —
 * Newtech and the customer both in Maharashtra, which is over half the customer
 * list — the tax is legally CGST 9% + SGST 9%, and a tax INVOICE has to show
 * the two halves separately. The total is identical either way, and this
 * document is a quotation rather than an invoice, which is why one row is fine
 * here. computeTotals in shared/money.ts still knows how to split it, and every
 * quotation stores the mode it was saved with, so nothing needs rebuilding —
 * put the dropdown back and it works.
 */
export const GST_RATE_PERCENT = 18
