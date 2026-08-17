/**
 * Optimal request -> offer pairing — CORRECTION 3, second half.
 *
 * §6 says "match each request to its best unclaimed offer". Read literally that
 * is greedy: walk the requests in order and let each take whatever is still
 * free. Greedy is not optimal, and on the exact data this product handles —
 * near-identical cable variants — it is wrong in the way that matters. Given
 *
 *        offer A   offer B
 *   req1   0.95      0.90
 *   req2   0.93      0.20
 *
 * greedy gives req1->A, req2->B for a total of 1.15 and pairs req2 with a
 * product it has nothing to do with. The optimal answer is req1->B, req2->A,
 * total 1.83. A mispairing here is exactly the silent error the reconciliation
 * screen exists to surface, so it is worth solving properly.
 *
 * This is the Hungarian algorithm (Kuhn-Munkres, the O(n^3) potentials
 * formulation), which returns the assignment with the maximum total score. It
 * is deterministic: equal scores resolve by column index, which is source line
 * order. The test suite checks it against a brute-force search over every
 * permutation on random small matrices.
 */

export interface Assignment {
  requestIndex: number
  offerIndex: number
  score: number
}

/**
 * @param scores  scores[i][j] = similarity of request i to offer j
 * @param threshold  pairings scoring below this are reported as unmatched (§6)
 */
export function optimalAssignment(scores: number[][], threshold: number): Assignment[] {
  const rows = scores.length
  const cols = rows > 0 ? (scores[0]?.length ?? 0) : 0
  if (rows === 0 || cols === 0) return []

  // The algorithm below requires rows <= cols, so transpose when it is not and
  // flip the indices back on the way out.
  const transposed = rows > cols
  const matrix = transposed ? transpose(scores) : scores

  const pairs = hungarianMaximise(matrix)

  return pairs
    .map(({ row, col }) => {
      const requestIndex = transposed ? col : row
      const offerIndex = transposed ? row : col
      return { requestIndex, offerIndex, score: scores[requestIndex]![offerIndex]! }
    })
    // §6 — "below that the request is reported as not quoted", so a pairing the
    // algorithm made purely to complete the matching is dropped here.
    .filter((pair) => pair.score >= threshold)
    .sort((a, b) => a.requestIndex - b.requestIndex)
}

function transpose(m: number[][]): number[][] {
  const rows = m.length
  const cols = m[0]?.length ?? 0
  const out: number[][] = Array.from({ length: cols }, () => new Array<number>(rows).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[j]![i] = m[i]![j]!
  }
  return out
}

/**
 * Maximum-weight assignment for an n x m matrix with n <= m.
 *
 * Implemented as minimum-cost over the negated matrix. The arrays are
 * deliberately 1-indexed with a sentinel at 0, matching the canonical
 * formulation — this is dense code and staying literal to the reference is
 * worth more here than cosmetic tidiness.
 */
function hungarianMaximise(scores: number[][]): Array<{ row: number; col: number }> {
  const n = scores.length
  const m = scores[0]?.length ?? 0
  const INF = Number.POSITIVE_INFINITY

  // cost[i][j], 1-indexed. Negated so that minimising cost maximises score.
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) cost[i]![j] = -scores[i - 1]![j - 1]!
  }

  const u = new Array<number>(n + 1).fill(0) // row potentials
  const v = new Array<number>(m + 1).fill(0) // column potentials
  const p = new Array<number>(m + 1).fill(0) // p[j] = row matched to column j
  const way = new Array<number>(m + 1).fill(0) // augmenting-path back-pointers

  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(m + 1).fill(INF)
    const used = new Array<boolean>(m + 1).fill(false)

    // Grow an augmenting path from row i until it reaches a free column.
    do {
      used[j0] = true
      const i0 = p[j0]!
      let delta = INF
      let j1 = 0

      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = cost[i0]![j]! - u[i0]! - v[j]!
        if (cur < minv[j]!) {
          minv[j] = cur
          way[j] = j0
        }
        // Strict `<` means the lowest column index wins a tie, which is what
        // makes the whole thing deterministic in source order.
        if (minv[j]! < delta) {
          delta = minv[j]!
          j1 = j
        }
      }

      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!]! += delta
          v[j]! -= delta
        } else {
          minv[j]! -= delta
        }
      }

      j0 = j1
    } while (p[j0] !== 0)

    // Walk the path back, flipping matched edges.
    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0 !== 0)
  }

  const result: Array<{ row: number; col: number }> = []
  for (let j = 1; j <= m; j++) {
    if (p[j]! > 0) result.push({ row: p[j]! - 1, col: j - 1 })
  }
  return result
}
