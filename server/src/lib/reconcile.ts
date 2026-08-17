import type { Flag, ParsedLine, ReconciledPair } from '@shared/schema.js'
import { optimalAssignment } from './assign.js'
import { mentionsMake } from './makes.js'
import { firstLength } from './parser.js'
import { MATCH_THRESHOLD, similarity, tokenize } from './tokenize.js'

/**
 * Request-vs-offer matching and drift detection (§6).
 *
 * The flag table is §6's, row for row. Matching uses §6's formula and its 0.42
 * threshold, over the Correction-3 tokenizer and an optimal assignment rather
 * than a greedy one — see tokenize.ts and assign.ts for why.
 */

const sameCode = (a: string, b: string) =>
  a !== '' && b !== '' && a.toUpperCase() === b.toUpperCase()

export function reconcile(lines: ParsedLine[]): ReconciledPair[] {
  const requests = lines.filter((l) => l.role === 'request')
  const offers = lines.filter((l) => l.role === 'offer')

  const requestTokens = requests.map((r) => tokenize(r.desc))
  const offerTokens = offers.map((o) => tokenize(o.desc))

  // scores[i][j] — request i against offer j.
  const scores: number[][] = requests.map((request, i) =>
    offers.map((offer, j) =>
      similarity(requestTokens[i]!, offerTokens[j]!, sameCode(request.partCode, offer.partCode)),
    ),
  )

  const assignments = optimalAssignment(scores, MATCH_THRESHOLD)
  const offerForRequest = new Map<number, { offerIndex: number; score: number }>()
  const claimedOffers = new Set<number>()

  for (const { requestIndex, offerIndex, score } of assignments) {
    offerForRequest.set(requestIndex, { offerIndex, score })
    claimedOffers.add(offerIndex)
  }

  const pairs: ReconciledPair[] = []

  // Requests in source order, matched or not, so the screen reads top-to-bottom
  // in the order the customer wrote them.
  requests.forEach((request, i) => {
    const match = offerForRequest.get(i)

    if (!match) {
      pairs.push({
        request,
        offer: null,
        score: 0,
        flags: [
          {
            kind: 'missing',
            text: 'Requested but not quoted.',
            severity: 'block',
          },
        ],
      })
      return
    }

    const offer = offers[match.offerIndex]!
    pairs.push({
      request,
      offer,
      // §4 types score as 0..1; the part-code bonus can exceed that, so it is
      // clamped for storage while ranking used the raw value.
      score: Math.min(1, match.score),
      flags: flagsFor(request, offer),
    })
  })

  // §6 — "Any leftover offer is reported as quoted but not requested."
  offers.forEach((offer, j) => {
    if (claimedOffers.has(j)) return
    pairs.push({
      request: null,
      offer,
      score: 0,
      flags: [
        {
          kind: 'extra',
          text: 'Quoted but not requested.',
          severity: 'warn',
        },
      ],
    })
  })

  return pairs
}

/** §6's flag table, applied to one matched pair. */
export function flagsFor(request: ParsedLine, offer: ParsedLine): Flag[] {
  const flags: Flag[] = []

  // First length value differs -> spec, block.
  const requestLength = firstLength(request.raw)
  const offerLength = firstLength(offer.raw)
  if (requestLength !== null && offerLength !== null && requestLength !== offerLength) {
    flags.push({
      kind: 'spec',
      text: `Customer asked ${formatLength(requestLength)}, quote says ${formatLength(offerLength)}.`,
      severity: 'block',
    })
  }

  // Brand absent from the offer, or different -> brand, block.
  if (request.make && !mentionsMake(offer.raw, request.make)) {
    flags.push(
      offer.make && offer.make.toLowerCase() !== request.make.toLowerCase()
        ? {
            kind: 'brand',
            text: `Customer asked for ${request.make}, quote says ${offer.make}.`,
            severity: 'block',
          }
        : {
            kind: 'brand',
            text: `Make "${request.make}" dropped from the quoted description.`,
            severity: 'block',
          },
    )
  }

  // A part code in the request is missing from the offer -> code, block.
  if (request.partCode && !offer.raw.toUpperCase().includes(request.partCode.toUpperCase())) {
    flags.push({
      kind: 'code',
      text: `Part code ${request.partCode} is missing from the quoted line.`,
      severity: 'block',
    })
  }

  // Quantities differ -> qty, warn. Only when both sides actually state one;
  // an offer that simply omits the quantity is not a disagreement about it.
  if (request.qty > 0 && offer.qty > 0 && request.qty !== offer.qty) {
    flags.push({
      kind: 'qty',
      text: `Customer asked for ${pad(request.qty)}, quote has ${pad(offer.qty)}.`,
      severity: 'warn',
    })
  }

  // Offer has no rate -> price, block.
  if (offer.rate <= 0) {
    flags.push({
      kind: 'price',
      text: 'No rate on the quoted line.',
      severity: 'block',
    })
  }

  return flags
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 1.5 -> "1.5 mtr", 1 -> "1 mtr" */
const formatLength = (n: number) => `${n} mtr`

/** §6 — `block` disables the one-click path; it never prevents generation. */
export function hasBlockingFlags(pairs: ReconciledPair[]): boolean {
  return pairs.some((pair) => pair.flags.some((flag) => flag.severity === 'block'))
}

export function countNeedingReview(pairs: ReconciledPair[]): number {
  return pairs.filter((pair) => pair.flags.length > 0).length
}
