import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import { type Decoration, DecorationSet } from '@milkdown/kit/prose/view'

// Every range of the new document an update may have touched: each step's own
// range, plus the whole span where the two documents differ, which also covers
// steps that change a node without changing its size.
function touched(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = []
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1)
    map.forEach((_, __, from, to) =>
      ranges.push([rest.map(from, -1), rest.map(to, 1)]),
    )
  })
  const start = tr.before.content.findDiffStart(tr.doc.content)
  if (start != null) {
    const end = tr.before.content.findDiffEnd(tr.doc.content)
    // The scans overlap when inserted or deleted text repeats its neighbours.
    if (end)
      ranges.push([start, end.b + Math.max(0, start - Math.min(end.a, end.b))])
  }
  return ranges
}

/**
 * Brings the decorations that `decorate` makes for code blocks up to date after `tr`. Mapping
 * carries the decorations of unchanged blocks to their new positions without reading them, but
 * leaves stale ones inside any block that was edited. Those blocks are decorated again; no other
 * block is. Stale decorations are dropped by rebuilding the set when there are many:
 * DecorationSet.remove compares every removed decoration with every other in its block, which is
 * quadratic in a large block.
 */
export function updateCodeBlockDecorations(
  mapped: DecorationSet,
  tr: Transaction,
  decorate: (node: ProseNode, pos: number) => Decoration[],
): DecorationSet {
  const stale: [number, number][] = []
  const fresh: Decoration[] = []
  const seen = new Set<number>()
  for (const [from, to] of touched(tr)) {
    let start = from
    let end = to
    const blocks: [ProseNode, number][] = []
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      start = Math.min(start, pos)
      end = Math.max(end, pos + node.nodeSize)
      if (node.type.name === 'code_block' && !seen.has(pos)) {
        seen.add(pos)
        blocks.push([node, pos])
      }
      return false
    })
    stale.push([start, end])
    for (const [node, pos] of blocks)
      for (const decoration of decorate(node, pos)) fresh.push(decoration)
  }
  const found: Decoration[] = []
  // `find` also returns a neighbour's decoration that ends where this range starts, so only
  // decorations inside the range are stale.
  for (const [start, end] of stale)
    for (const decoration of mapped.find(start, end))
      if (decoration.from >= start && decoration.to <= end)
        found.push(decoration)
  if (found.length === 0) return mapped.add(tr.doc, fresh)
  // remove is quadratic in the decorations it removes, so only a large block takes the rebuild below.
  if (found.length <= 256) return mapped.remove(found).add(tr.doc, fresh)
  stale.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of stale) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  const kept = mapped.find().filter((decoration) => {
    let low = 0
    let high = merged.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (merged[middle]![0] < decoration.to) low = middle + 1
      else high = middle
    }
    const range = merged[low - 1]
    return !range || range[1] <= decoration.from
  })
  return DecorationSet.create(tr.doc, kept.concat(fresh))
}
