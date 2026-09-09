/**
 * §7 — "Newtech is registered in Maharashtra. Ship-to in Maharashtra ->
 * CGST 9% + SGST 9% as two rows. Any other state -> IGST 18% as one row."
 *
 * The ship-to state therefore decides the tax mode, which is why it is a fixed
 * list rather than a free-text field: a typo in "Maharashtra" would silently
 * flip a quotation onto the wrong tax treatment.
 */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const

export const HOME_STATE = 'Maharashtra'

export type TaxMode = 'IGST' | 'CGST+SGST'

/** The default the editor starts from. Always overridable (§7). */
export function taxModeForState(state: string | undefined): TaxMode {
  return state?.trim().toLowerCase() === HOME_STATE.toLowerCase() ? 'CGST+SGST' : 'IGST'
}

/**
 * The first two digits of a GSTIN are the state the holder is registered in.
 *
 * Here because the debtors import cross-checks one against the other: a ledger
 * whose State column says Karnataka and whose GSTIN starts 27 has one of the
 * two wrong, and which is wrong decides whether the quotation carries IGST or a
 * CGST/SGST pair. The importer reports the disagreement rather than picking a
 * winner — only the desk knows which field Tally has right.
 *
 * Codes 25 and 26 both map to the merged union territory; 97 ("Other
 * Territory") and 96/99 (foreign, OIDAR) have no entry, which is the correct
 * answer for them rather than a missing one.
 */
const GSTIN_STATE_CODES: Readonly<Record<string, (typeof INDIAN_STATES)[number]>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Dadra and Nagar Haveli and Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
}

/** The state a GSTIN is registered in, or null if it names no state we know. */
export function stateForGstin(gstin: string): string | null {
  return GSTIN_STATE_CODES[gstin.trim().slice(0, 2)] ?? null
}

/**
 * A GSTIN is 15 characters: a two-digit state code, the holder's ten-character
 * PAN, an entity number, a fixed "Z", and a check character.
 *
 * Stated once here now that three places test it — the extractor's guard on a
 * freshly read value, the debtors import, and the editor. Case and spacing are
 * normalised rather than rejected: a GSTIN is an identifier, not prose, and
 * "27 aabcu9603r1zm" is the same number badly typed.
 */
export const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/

/** The GSTIN normalised, or '' if it is not one. Never half of one. */
export function normaliseGstin(raw: string): string {
  const value = raw.replace(/\s+/g, '').toUpperCase()
  return value.length === 15 && GSTIN_SHAPE.test(value) ? value : ''
}
