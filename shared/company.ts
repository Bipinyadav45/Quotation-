/**
 * §1 — fixed company details. Printed on every quotation, never edited per quote.
 * Shared so the editor's defaults and the document renderer cannot drift apart.
 */
export const COMPANY = {
  name: 'Newtech Computer Services Pvt. Ltd.',
  addressLines: [
    '6th Floor, Solaris-II, Opp L&T Gate-6,',
    'Saki Vihar Road, Powai,',
    'Mumbai- 400072.',
  ],
  tel: '022 40668888',
  cin: 'U99999MH1984PTC034412',
  /** §7 — registered in Maharashtra; this decides the tax-mode default. */
  homeState: 'Maharashtra',
  /** §8 — the closing line, spelled exactly as the letterhead has it. */
  closingFor: 'For Newtech Computer Services Pvt., Ltd.',
  /** §8 — "If you have any queries, please call us at 40668812/88." */
  queriesNumbers: '40668812/88',
} as const

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
  prices: 'All-inclusive as per the quote',
} as const

export const GST_RATE_PERCENT = 18
