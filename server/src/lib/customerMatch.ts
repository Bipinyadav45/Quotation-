import { normaliseGstin } from '@shared/states.js'
import { tokenize } from './similarity.js'
import type { CustomerRecord } from './customers.js'

/**
 * Which ledgers might a thread naming this company mean?
 *
 * THE ANSWER IS A LIST, and that is the whole point of this file. The customer
 * master is the desk's Tally sundry debtors, where sixteen ledgers are some
 * spelling of "Datamatics Global Services Limited", seventeen some spelling
 * of "Morgan Stanley", and three Azentio sites share one GSTIN. A thread that says
 * "Azentio Software Pvt Ltd" has not identified a customer — it has narrowed
 * the list to six, and a person picks from there.
 *
 * This replaces matchOnFile, which took the single best fuzzy name match above
 * 0.75 and let a draft be filled from it with no review in between. Against
 * this list that meant one group company's GSTIN, address and STATE reaching a
 * document addressed to another — and the state decides IGST vs CGST+SGST.
 *
 * With nothing auto-applied, the threshold's job changes completely. It no
 * longer has to establish "this is certainly them" before a silent write; it
 * only has to answer "might the desk mean this one?" before showing a row. So
 * it is deliberately LOOSER here than the 0.75 it replaces. Being shown a
 * seventh Azentio costs a glance. Not being shown the right one costs a
 * re-typed GSTIN, or worse, a wrong one nobody was offered the chance to fix.
 */

/**
 * Words that say what KIND of company this is, never WHICH one.
 *
 * A hand-written list, and it should stay hand-written. The obvious alternative
 * — call a word common if it appears in many ledgers — was measured against
 * this list and gets the answer backwards: "datamatics" appears in 19 of the
 * 225 rows (8.4%), which lands it above "technologies" (8.0%) on frequency
 * alone, and it is the single most identifying thing anyone could type.
 * Frequency measures how many branches a customer has, not how little a word
 * says.
 *
 * Note what is NOT here. "Global", "Staffing", "Business", "Solutions" and
 * "Technologies" look like boilerplate and are not: Datamatics Global Services,
 * Datamatics Staffing Services and Datamatics Business Solutions are three
 * different legal entities, and those words are the entire difference between
 * them. "India" likewise separates Mobileum India from Mobileum Technologies.
 * Strip them and this file starts merging companies that file separate returns.
 */
const CORPORATE_FORMS = new Set([
  'ltd', 'ltd.', 'limited', 'ltds',
  'pvt', 'pvt.', 'private', 'pv',
  'llp', 'llc', 'inc', 'inc.', 'incorporated',
  'corp', 'corp.', 'corporation', 'company', 'co', 'co.',
])

/**
 * The tokens of a company name that say WHICH company it is.
 *
 * tokenize() is §6's, borrowed unchanged — it already drops one-character
 * fragments and its own stop list, and it keeps hyphenated compounds whole,
 * which matters for the likes of "Bristlecone-India".
 */
export function identityTokens(name: string): Set<string> {
  const out = new Set<string>()
  for (const token of tokenize(name)) if (!CORPORATE_FORMS.has(token)) out.add(token)
  return out
}

/**
 * How completely a ledger accounts for the name the thread gave.
 *
 * CONTAINMENT, not Dice, and the difference is the reason this function exists.
 * Dice divides by the size of BOTH sets, so it punishes a ledger for carrying
 * the branch suffix that makes it useful — "Morgan Stanley" against "MORGAN
 * STANLEY ADVANTAGE SERVICES PVT. LTD. Bandra" scores 0.44 under Dice, below
 * even §6's pairing threshold, and the desk would be shown none of the seventeen
 * ledgers they actually want. Dividing by the QUERY alone asks the question
 * that is really being asked: is everything the thread named present in this
 * ledger's name? For all seventeen, it is.
 *
 * Dice also flatters the wrong pairs. "Foo Services Pvt Ltd" against "Bar
 * Services Pvt Ltd" scores 0.75 on raw tokens — above the old identity
 * threshold — because three of four tokens match and three of them are
 * boilerplate. On identity tokens by containment it scores 0.5 and is not
 * offered.
 */
export function nameScore(query: Set<string>, ledger: Set<string>): number {
  if (query.size === 0) return 0
  let shared = 0
  for (const token of query) if (ledger.has(token)) shared += 1
  return shared / query.size
}

/**
 * Low, on purpose — see the note at the top about what the threshold is now
 * for. 0.6 keeps "Datamatics Staffing Services" on screen when the thread said
 * "Datamatics Global Services" (2 of 3 identity tokens), which is right: they
 * are easy to confuse, so the moment to look at them is while both are visible.
 * It drops "Lumina Datamatics" (1 of 3), which shares only the parent's name.
 */
export const CANDIDATE_THRESHOLD = 0.6

export interface Candidate {
  record: CustomerRecord
  score: number
  /** Set when the thread's own GSTIN is this ledger's. The strongest signal. */
  gstinMatch: boolean
}

/**
 * Every ledger the thread might mean, best first.
 *
 * A matching GSTIN outranks any name score, because it is the one thing in an
 * email signature that is unambiguous — but it does NOT decide on its own, and
 * must not be made to: three Azentio ledgers share 27AAUCA4876F1Z4, so even an
 * exact GSTIN can leave three entities to choose between.
 */
export function rankCandidates(
  read: { name: string; gstin?: string },
  ledgers: readonly CustomerRecord[],
): Candidate[] {
  const query = identityTokens(read.name)
  const gstin = normaliseGstin(read.gstin ?? '')

  const out: Candidate[] = []
  for (const record of ledgers) {
    const gstinMatch = gstin !== '' && record.gstin.toUpperCase() === gstin
    const score = nameScore(query, identityTokens(record.name))
    if (!gstinMatch && score < CANDIDATE_THRESHOLD) continue
    out.push({ record, score, gstinMatch })
  }

  return out.sort(byRank)
}

/**
 * Deterministic to the last tiebreak. Two ledgers of the same company routinely
 * score identically on everything a matcher can see — the three Azentio sites
 * sharing a GSTIN differ only in their address — and a list that reorders
 * itself between two reads of the same thread is a list nobody trusts.
 */
function byRank(a: Candidate, b: Candidate): number {
  if (a.gstinMatch !== b.gstinMatch) return a.gstinMatch ? -1 : 1
  if (a.score !== b.score) return b.score - a.score
  if (a.record.quoteCount !== b.record.quoteCount) return b.record.quoteCount - a.record.quoteCount
  if (a.record.lastUsedAt !== b.record.lastUsedAt) {
    return a.record.lastUsedAt < b.record.lastUsedAt ? 1 : -1
  }
  return a.record.name.localeCompare(b.record.name)
}
