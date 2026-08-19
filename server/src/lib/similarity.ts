/**
 * Product-description similarity.
 *
 * Written for §6's ask-vs-quote comparison, which has since been removed. Kept
 * because price memory needs exactly the same judgement: is the line being
 * priced now the same product as one priced before? The two mistakes it was
 * built to avoid are the two that matter there too — quoting a USB-A cable's
 * price for a USB-C one, or a 1 mtr price for a 1.5 mtr.
 *
 * The reasoning that shaped it, kept verbatim because it is what the thresholds
 * mean:
 *
 * §6 specifies "lowercased alphanumerics of length >= 2". Applied literally to
 * the §11 fixture, that rule throws away precisely the information the product
 * exists to protect:
 *
 *   "Black i USB-C to USB-A 1.5 mtr"  ->  {black, usb, to, mtr}
 *   "Black i USB-C to USB-C 1 mtr"    ->  {black, usb, to, mtr}
 *
 * `USB-C` becomes `usb` + `c`(dropped) and `1.5` becomes `1` + `5` (both
 * dropped), so a request for a 1 mtr USB-C cable and an offer of a 1.5 mtr
 * USB-A cable score an identical 1.0 against each other. The fixture's expected
 * flags still fire — they come from the separate length regex, not the score —
 * so the tests pass by luck, and the reconciler silently pairs the wrong
 * products the moment a third variant appears.
 *
 * Two additions fix it, and neither changes §6's formula, its +0.35 part-code
 * bonus, or its 0.42 threshold:
 *
 *   1. hyphenated compounds survive whole  ->  `usb-c`, `usb-a`
 *   2. a number and its unit become one token -> `1.5mtr`, `1mtr`
 *
 * The >= 2 filter and the stop list are unchanged; they simply no longer
 * discard the discriminators.
 */

/** §6's stop list, verbatim. */
const STOP_WORDS = new Set([
  'the', 'and', 'with', 'for', 'set', 'each', 'gst', 'qty', 'rs', 'port', 'ports', 'type',
])

/**
 * Unit spellings normalised to one form, so "1.5 mtr", "1.5 meter" and
 * "1.5 metre" all produce the same token.
 */
const UNIT_ALIASES: Record<string, string> = {
  mtr: 'mtr', mtrs: 'mtr', meter: 'mtr', meters: 'mtr', metre: 'mtr', metres: 'mtr', m: 'mtr',
  cm: 'cm', mm: 'mm',
  ft: 'ft', feet: 'ft', foot: 'ft',
  inch: 'in', inches: 'in', in: 'in',
  gb: 'gb', tb: 'tb', mb: 'mb', kb: 'kb',
  w: 'w', watt: 'w', watts: 'w',
  va: 'va', kva: 'kva',
}

const UNIT_PATTERN = Object.keys(UNIT_ALIASES)
  .sort((a, b) => b.length - a.length) // longest first, so "mtrs" wins over "m"
  .join('|')

const NUMBER_UNIT_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\b`, 'gi')
const HYPHENATED_RE = /\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/gi

/**
 * Turn a description into the set of tokens §6 compares.
 *
 * Order matters: number+unit compounds are lifted out before hyphen handling,
 * so a stray "1.5-mtr" cannot be mis-split, and their digits never fall through
 * to the generic word split.
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>()
  let remaining = text.toLowerCase()

  // 1. number + unit  ->  one token ("1.5mtr"). THIS is what distinguishes a
  //    1 mtr cable from a 1.5 mtr one; under §6 as written, both vanished.
  remaining = remaining.replace(NUMBER_UNIT_RE, (_match, value: string, unit: string) => {
    tokens.add(`${value}${UNIT_ALIASES[unit.toLowerCase()] ?? unit.toLowerCase()}`)
    return ' '
  })

  // 2. hyphenated compounds survive whole, AND contribute their parts. Keeping
  //    `usb` from both `usb-c` and `usb-a` is correct — they really are both
  //    USB — while the compounds keep them from being interchangeable.
  remaining = remaining.replace(HYPHENATED_RE, (_match, compound: string) => {
    addToken(tokens, compound)
    for (const part of compound.split('-')) addToken(tokens, part)
    return ' '
  })

  // 3. everything else: §6's original rule, now operating on what is left.
  for (const word of remaining.split(/[^a-z0-9]+/i)) addToken(tokens, word)

  return tokens
}

function addToken(tokens: Set<string>, raw: string): void {
  const token = raw.trim().toLowerCase()
  if (token.length < 2) return
  if (STOP_WORDS.has(token)) return
  tokens.add(token)
}

/**
 * §6's formula, unchanged:
 *
 *   similarity = 2 * |A ∩ B| / (|A| + |B|)  +  0.35 when a part code is shared
 *
 * The bonus can push the result above 1. That is deliberate for ranking — a
 * shared part code should outrank any amount of word overlap — so callers rank
 * on this raw value and clamp only when storing, since §4 types score as 0..1.
 */
export function similarity(
  a: Set<string>,
  b: Set<string>,
  sharedPartCode: boolean,
): number {
  if (a.size === 0 && b.size === 0) return sharedPartCode ? 1 : 0

  let intersection = 0
  // Iterate the smaller set; membership tests are O(1) either way.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const token of small) if (large.has(token)) intersection += 1

  const dice = (2 * intersection) / (a.size + b.size)
  return sharedPartCode ? dice + 0.35 : dice
}

/** §6 — "Accept a pairing at >= 0.42". */
export const MATCH_THRESHOLD = 0.42
