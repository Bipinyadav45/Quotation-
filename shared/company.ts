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
  /** §8 — "If you have any queries, please call us at 40668812/88." */
  queriesNumbers: '40668812/88',
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
 * The desk. Initials drive the reference series (§7), and the contact number
 * and email printed in the header are the salesperson's, not the company's —
 * the sample quotation carries Rakhi Gupte's direct line and address.
 */
export const SALESPEOPLE = [
  {
    initials: 'RG',
    name: 'Rakhi Gupte',
    phone: '022-40668809',
    email: 'rakhi.gupte@newtech.in',
  },
] as const

export type Salesperson = (typeof SALESPEOPLE)[number]

export const DEFAULT_SALESPERSON: Salesperson = SALESPEOPLE[0]

/** §7 — defaults, all editable on the quote. Validity is computed per quote. */
export const DEFAULT_TERMS = {
  payment: '100% Advance',
  delivery: '1-2 Weeks after PO',
  /**
   * "as per the quote" on a document headed Proforma Invoice pointed at
   * something that no longer exists. It says all-inclusive of what the document
   * shows — the total, carrying no further freight, handling or installation —
   * and NOT that the rates include GST, which the GST row beneath them plainly
   * contradicts. See pricesTermFromLines in web/src/lib/draft.ts for why that
   * distinction is the reason this is not derived from the thread.
   */
  prices: 'All-inclusive as per this proforma invoice',
} as const

export const GST_RATE_PERCENT = 18
