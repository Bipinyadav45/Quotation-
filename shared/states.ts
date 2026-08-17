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
