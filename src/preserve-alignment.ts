import { PreservationError } from './preserve-error'

const MATCHING_BUDGET = 1_000_000

export const SIMILARITY_BUDGET = 4_000_000

interface Anchor {
  b: number
  a: number
}

// Unchanged blocks are anchored first, so a long document with many scattered
// edits is matched as many short gaps rather than one wide span.
export function correspondence(
  before: string[],
  after: string[],
): Array<number | undefined> {
  const result: Array<number | undefined> = new Array(after.length)
  const work = { budget: MATCHING_BUDGET, similarity: SIMILARITY_BUDGET }
  const spans = [{ b: 0, a: 0, bEnd: before.length, aEnd: after.length }]
  for (let span = spans.pop(); span; span = spans.pop()) {
    let { b, a, bEnd, aEnd } = span
    while (b < bEnd && a < aEnd && before[b] === after[a]) result[a++] = b++
    while (b < bEnd && a < aEnd && before[bEnd - 1] === after[aEnd - 1])
      result[--aEnd] = --bEnd
    if (b === bEnd || a === aEnd) continue
    work.budget -= bEnd - b + (aEnd - a)
    if (work.budget < 0) throw tooManyBlocks()
    const anchors = uniqueAnchors(before, after, b, bEnd, a, aEnd)
    if (!anchors.length) {
      align(before, after, b, bEnd, a, aEnd, result, work)
      continue
    }
    for (const anchor of anchors) {
      result[anchor.a] = anchor.b
      spans.push({ b, a, bEnd: anchor.b, aEnd: anchor.a })
      b = anchor.b + 1
      a = anchor.a + 1
    }
    spans.push({ b, a, bEnd, aEnd })
  }
  return result
}

export function tooManyBlocks(): PreservationError {
  return new PreservationError(
    'The edit changes too many blocks to preserve safely',
  )
}

// Blocks that occur exactly once on each side, in the longest subsequence whose
// order the two sides share. A repeated block is never an anchor: which copy it
// belongs to is not known until its neighbours are placed.
function uniqueAnchors(
  before: string[],
  after: string[],
  b: number,
  bEnd: number,
  a: number,
  aEnd: number,
): Anchor[] {
  const once = (list: string[], from: number, to: number) => {
    const at = new Map<string, number>()
    for (let i = from; i < to; i++) at.set(list[i]!, at.has(list[i]!) ? -1 : i)
    return at
  }
  const beforeAt = once(before, b, bEnd)
  const afterAt = once(after, a, aEnd)
  const pairs: Anchor[] = []
  for (let i = a; i < aEnd; i++) {
    const match = beforeAt.get(after[i]!)
    if (match != null && match >= 0 && afterAt.get(after[i]!) === i)
      pairs.push({ b: match, a: i })
  }
  // Patience sorting: tails[k] ends the best increasing subsequence of length k + 1.
  const tails: number[] = []
  const previous: number[] = new Array(pairs.length)
  for (const [index, pair] of pairs.entries()) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (pairs[tails[middle]!]!.b < pair.b) low = middle + 1
      else high = middle
    }
    previous[index] = low ? tails[low - 1]! : -1
    tails[low] = index
  }
  const anchors: Anchor[] = []
  let at = tails.length ? tails[tails.length - 1]! : -1
  while (at >= 0) {
    anchors.push(pairs[at]!)
    at = previous[at]!
  }
  return anchors.reverse()
}

// Replacing a block costs more than inserting or deleting one, so an unchanged
// block keeps its own copy rather than pairing with a deleted neighbour, and
// less than both, so an edited block still keeps its surrounding whitespace.
const INDEL = 2

const REPLACE = 3

function align(
  before: string[],
  after: string[],
  b: number,
  bEnd: number,
  a: number,
  aEnd: number,
  result: Array<number | undefined>,
  work: { budget: number; similarity: number },
): void {
  const rows = bEnd - b + 1
  const columns = aEnd - a + 1
  const offset = Math.abs(rows - columns)
  let width = Math.max(1, offset)
  for (;;) {
    const costs: Uint32Array[] = []
    const get = (i: number, j: number): number =>
      i < 0 || j < 0 || Math.abs(i - j) > width
        ? Infinity
        : (costs[i]?.[j - Math.max(0, i - width)] ?? Infinity)
    for (let i = 0; i < rows; i++) {
      const from = Math.max(0, i - width)
      const to = Math.min(columns - 1, i + width)
      work.budget -= to - from + 1
      if (work.budget < 0) throw tooManyBlocks()
      const row = new Uint32Array(to - from + 1)
      costs.push(row)
      for (let j = from; j <= to; j++) {
        const change = before[b + i - 1] === after[a + j - 1] ? 0 : REPLACE
        row[j - from] =
          i === 0
            ? j * INDEL
            : j === 0
              ? i * INDEL
              : Math.min(
                  get(i - 1, j) + INDEL,
                  get(i, j - 1) + INDEL,
                  get(i - 1, j - 1) + change,
                )
      }
    }
    // A path that leaves the band takes at least width + 1 insertions or
    // deletions away from the diagonal and width + 1 - offset back to its end,
    // so a path inside the band that costs no more is optimal. Widen only when
    // needed, charging every attempt to the same work budget.
    if (
      width < Math.max(rows, columns) - 1 &&
      get(rows - 1, columns - 1) > INDEL * (2 * (width + 1) - offset)
    ) {
      width *= 2
      continue
    }
    const unchanged: Anchor[] = []
    let i = rows - 1
    let j = columns - 1
    while (i || j) {
      const same = i && j && before[b + i - 1] === after[a + j - 1]
      if (i && j && get(i, j) === get(i - 1, j - 1) + (same ? 0 : REPLACE)) {
        result[a + j - 1] = b + i - 1
        if (same) unchanged.push({ b: b + i - 1, a: a + j - 1 })
        i--
        j--
      } else if (i && get(i, j) === get(i - 1, j) + INDEL) i--
      else j--
    }
    unchanged.push({ b: b - 1, a: a - 1 })
    unchanged.reverse().push({ b: bEnd, a: aEnd })
    for (let index = 1; index < unchanged.length; index++)
      pairSimilar(
        before,
        after,
        unchanged[index - 1]!.b + 1,
        unchanged[index]!.b,
        unchanged[index - 1]!.a + 1,
        unchanged[index]!.a,
        result,
        work,
      )
    return
  }
}

// Between unchanged blocks, edit distance prices every replacement alike, so
// it cannot tell which original an edited block came from. Pair each with the
// original it most resembles, keeping their order: typing in a block then keeps
// its own source even when a neighbour was inserted or deleted beside it.
export function pairSimilar(
  before: string[],
  after: string[],
  b: number,
  bEnd: number,
  a: number,
  aEnd: number,
  result: Array<number | undefined>,
  work: { similarity: number },
): void {
  const removed = bEnd - b
  const added = aEnd - a
  if (!removed || !added || (removed === 1 && added === 1)) return
  // Resemblance decides; among equally resembling pairings, more pairs keep
  // more replaced blocks in place with their surrounding whitespace.
  const bonus = 1 / (Math.min(removed, added) + 1)
  // This is a refinement with its own budget of characters compared. When it
  // runs out, the alignment's pairing stands rather than the edit failing.
  if (removed * added > work.similarity) return
  const weights = new Float64Array(removed * added)
  for (let x = 0; x < removed; x++)
    for (let y = 0; y < added; y++) {
      const shared = similarity(before[b + x]!, after[a + y]!)
      work.similarity -= shared + 1
      if (work.similarity < 0) return
      weights[x * added + y] = shared + bonus
    }
  const best = Array.from(
    { length: removed + 1 },
    () => new Float64Array(added + 1),
  )
  for (let x = 1; x <= removed; x++)
    for (let y = 1; y <= added; y++)
      best[x]![y] = Math.max(
        best[x - 1]![y]!,
        best[x]![y - 1]!,
        best[x - 1]![y - 1]! + weights[(x - 1) * added + y - 1]!,
      )
  for (let index = a; index < aEnd; index++) result[index] = undefined
  for (let x = removed, y = added; x && y;) {
    if (
      best[x]![y] ===
      best[x - 1]![y - 1]! + weights[(x - 1) * added + y - 1]!
    ) {
      result[a + --y] = b + --x
    } else if (best[x]![y] === best[x - 1]![y]) x--
    else y--
  }
}

// Characters an edit left in place at the start and end of a block.
function similarity(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let prefix = 0
  while (prefix < limit && left[prefix] === right[prefix]) prefix++
  let suffix = 0
  while (
    suffix < limit - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++
  return prefix + suffix
}
