import type { RootContent } from 'hast'
import { common, createLowlight } from 'lowlight'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

const lowlight = createLowlight(common)

// Colors are decorations over the plain text, so the markdown is untouched;
// a block without a known language stays plain.
function blockDecorations(node: ProseNode, pos: number): Decoration[] {
  const language = String(node.attrs.language ?? '').toLowerCase()
  const found: Decoration[] = []
  if (!language || !lowlight.registered(language)) return found
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
        const own = (child.properties?.className as string[] | undefined) ?? []
        walk(child.children, [...classes, ...own])
      }
    }
  }
  walk(lowlight.highlight(language, node.textContent).children, [])
  return found
}

function decorations(doc: ProseNode): DecorationSet {
  const found: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.name === 'code_block')
      found.push(...blockDecorations(node, pos))
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
    // The scans meet when inserted text repeats its neighbours.
    if (end) ranges.push([start, end.b + Math.max(0, start - end.a)])
  }
  return ranges
}

// Mapping carries colors of unchanged blocks to their new positions without
// reading them, but leaves stale colors inside any block that was edited. Those
// blocks lose their decorations and are highlighted again; no other block is.
function update(mapped: DecorationSet, tr: Transaction): DecorationSet {
  const stale: Decoration[] = []
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
    stale.push(...mapped.find(start, end))
    for (const [node, pos] of blocks) fresh.push(...blockDecorations(node, pos))
  }
  return mapped.remove(stale).add(tr.doc, fresh)
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
