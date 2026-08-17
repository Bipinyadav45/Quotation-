export interface DiffPart {
  text: string
  changed: boolean
}

/**
 * Word-level diff between what the customer asked for and what we are quoting.
 *
 * The reconciliation screen already says *that* a line drifted, in prose
 * underneath it. This is so it can also show *where* — "1 mtr" against
 * "1.5 mtr" with the digits marked, rather than leaving the reader to compare
 * two long product descriptions character by character.
 *
 * Only ever applied to rows that already carry a flag. On a clean row the
 * wording may legitimately differ, and lighting that up in amber would cost the
 * colour its meaning (§9).
 *
 * Plain LCS. Descriptions are a dozen words, so the quadratic table is free.
 */
export function wordDiff(left: string, right: string): { left: DiffPart[]; right: DiffPart[] } {
  const a = split(left)
  const b = split(right)

  // Compare case- and punctuation-insensitively so "USB-C," and "usb c" line up,
  // while the parts we render keep their original spelling.
  const ka = a.map(key)
  const kb = b.map(key)

  const lcs = longestCommonSubsequence(ka, kb)

  return {
    left: mark(a, lcs.inA),
    right: mark(b, lcs.inB),
  }
}

/** Split into words and the whitespace between them, so it can be rejoined verbatim. */
function split(text: string): string[] {
  return text.split(/(\s+)/).filter((part) => part !== '')
}

const isSpace = (token: string) => /^\s+$/.test(token)

const key = (token: string) => token.toLowerCase().replace(/[^a-z0-9.]/g, '')

function longestCommonSubsequence(
  a: string[],
  b: string[],
): { inA: boolean[]; inB: boolean[] } {
  const n = a.length
  const m = b.length

  // table[i][j] = LCS length of a[i..] and b[j..]
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const inA = new Array<boolean>(n).fill(false)
  const inB = new Array<boolean>(m).fill(false)

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      inA[i] = true
      inB[j] = true
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i++
    } else {
      j++
    }
  }

  return { inA, inB }
}

function mark(tokens: string[], common: boolean[]): DiffPart[] {
  const changed = tokens.map((token, i) => !isSpace(token) && !common[i])

  // A gap sitting between two changed words belongs to the same run, so
  // "Black i" highlights as one phrase rather than two words with a hole
  // punched between them. A gap on the boundary of a run stays unmarked, so no
  // highlight ever bleeds into unchanged text.
  tokens.forEach((token, i) => {
    if (!isSpace(token)) return
    changed[i] = Boolean(changed[i - 1]) && Boolean(changed[i + 1])
  })

  // Merge neighbours with the same state, so the DOM stays small and the
  // highlight is one continuous block per run.
  const parts: DiffPart[] = []
  tokens.forEach((token, i) => {
    const previous = parts[parts.length - 1]
    if (previous && previous.changed === changed[i]) previous.text += token
    else parts.push({ text: token, changed: changed[i]! })
  })

  return parts
}
