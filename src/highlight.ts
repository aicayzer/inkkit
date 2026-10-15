import type { RootContent } from 'hast'
import { common, createLowlight } from 'lowlight'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

const lowlight = createLowlight(common)

// highlight.js takes time that grows with the square of the text for some
// input in several grammars: one long word in ini or TypeScript, or lines of
// plain words in C, where the slow match runs on across lines. Neither a line
// nor a token limit bounds it, so a block longer than this stays plain. At
// this length the slowest input found takes about 110 ms in Chromium and
// WebKit, and ordinary code takes a few milliseconds.
export const highlightLimit = 5_000

// The length limit bounds one block; this bounds a load or an edit that
// reaches many blocks. Once highlighting in one load or edit has taken this
// many milliseconds, the blocks it has not reached stay plain until they are
// edited. A note of ordinary code reaches it only with about a megabyte of
// code; docs/performance.md has the measurements.
export const highlightBudget = 200

// Colors are decorations over the plain text, so the markdown is untouched;
// a block without a known language stays plain.
function blockDecorations(
  node: ProseNode,
  pos: number,
  deadline: number,
): Decoration[] {
  const language = String(node.attrs.language ?? '').toLowerCase()
  const found: Decoration[] = []
  if (!language || !lowlight.registered(language)) return found
  if (node.content.size > highlightLimit || performance.now() > deadline)
    return found
  let offset = pos + 1
  const walk = (children: RootContent[], classes: string[]) => {
    for (const child of children) {
      if (child.type === 'text') {
        const end = offset + child.value.length
        if (classes.length > 0)
          found.push(
            Decoration.inline(offset, end, { class: classes.join(' ') }),
          )
        offset = end
      } else if (child.type === 'element') {
        // The grammar names its tokens `hljs-*`; InkKit's own prefix keeps a
        // host's highlight.js theme out of the editor.
        const own = (
          (child.properties?.className as string[] | undefined) ?? []
        ).map((name) => `inkkit-${name}`)
        walk(child.children, [...classes, ...own])
      }
    }
  }
  walk(lowlight.highlight(language, node.textContent).children, [])
  return found
}

function decorations(doc: ProseNode): DecorationSet {
  const deadline = performance.now() + highlightBudget
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'code_block')
      for (const decoration of blockDecorations(node, pos, deadline))
        found.push(decoration)
    return false
  })
  return DecorationSet.create(doc, found)
}

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

// Mapping carries colors of unchanged blocks to their new positions without
// reading them, but leaves stale colors inside any block that was edited. Those
// blocks are highlighted again; no other block is. Stale colors are dropped by
// rebuilding the set: DecorationSet.remove compares every removed decoration
// with every other in its block, which is quadratic in a large block.
function update(mapped: DecorationSet, tr: Transaction): DecorationSet {
  const deadline = performance.now() + highlightBudget
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
      for (const decoration of blockDecorations(node, pos, deadline))
        fresh.push(decoration)
  }
  const found: Decoration[] = []
  for (const [start, end] of stale)
    for (const decoration of mapped.find(start, end)) found.push(decoration)
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

export const highlightPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: new PluginKey('highlight'),
      state: {
        init: (_, state) => decorations(state.doc),
        apply: (tr, previous) =>
          tr.docChanged
            ? update(previous.map(tr.mapping, tr.doc), tr)
            : previous,
      },
      props: {
        decorations(state) {
          return this.getState(state)
        },
      },
    }),
)
