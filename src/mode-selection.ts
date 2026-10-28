import { leadingBOMLength } from './bom'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { RootContent } from 'mdast'
import { decodedOffsets } from './preserve-inline'
import { Preservation } from './preserve'

interface Point {
  formatted: number
  source: number
}

// Use the dialect's positioned syntax tree rather than searching the Markdown
// itself: a repeated word in a link destination or definition is not a caret.
export function modeSelectionMap(ctx: Ctx, source: string, doc: ProseNode) {
  const points: Point[] = []
  const bom = leadingBOMLength(source)
  let text = ''
  const offsets: number[] = []
  const ends: number[] = []
  const append = (value: string, positions: number[]) => {
    for (let index = 0; index < value.length; index++)
      offsets[text.length + index] = positions[index]!
    for (let index = 1; index <= value.length; index++)
      ends[text.length + index] = positions[index]!
    text += value
  }
  const visit = (node: RootContent) => {
    if (node.type === 'definition') return
    if ('children' in node) {
      node.children.forEach((child) => visit(child as RootContent))
      return
    }
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start == null || end == null || !('value' in node)) return
    const raw = source.slice(start + bom, end + bom)
    if (node.type === 'text') {
      const decoded = decodedOffsets(raw, true)
      if (decoded)
        append(
          decoded.decoded,
          decoded.offsets.map((at) => at + start + bom),
        )
    } else if (node.type === 'inlineCode') {
      const exact = raw.indexOf(node.value)
      if (exact >= 0) {
        append(
          node.value,
          Array.from(
            { length: node.value.length + 1 },
            (_, index) => start + bom + exact + index,
          ),
        )
        return
      }
      const ticks = /^`+/.exec(raw)?.[0].length ?? 0
      let value = ''
      const positions: number[] = []
      for (let index = ticks; index < raw.length - ticks; index++) {
        positions.push(start + bom + index)
        if (raw[index] === '\r' && raw[index + 1] === '\n') index++
        value += /[\r\n]/.test(raw[index]!) ? ' ' : raw[index]
      }
      positions.push(start + bom + raw.length - ticks)
      if (value.startsWith(' ') && value.endsWith(' ') && /[^ ]/.test(value)) {
        value = value.slice(1, -1)
        positions.shift()
        positions.pop()
      }
      append(value, positions)
    } else if (node.type === 'code') {
      const lines = [...raw.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)]
      let line = /^(`{3,}|~{3,})/.test(raw) ? 1 : 0
      const value = node.value.replace(/\r\n?/g, '\n')
      const positions: number[] = []
      let offset = 0
      for (const content of value.split('\n')) {
        while (line < lines.length && !lines[line]![1]!.endsWith(content))
          line++
        const match = lines[line++]
        if (!match) return
        const at = match.index! + match[1]!.length - content.length
        for (let index = 0; index <= content.length; index++)
          positions[offset + index] = start + bom + at + index
        offset += content.length + 1
      }
      append(value, positions)
    } else if (node.type === 'html' || node.type === 'inkkitLiteral') {
      // Literal Markdown keeps its own line endings in the ProseMirror node.
      const value = node.value
      const at = raw.indexOf(value)
      if (at >= 0)
        append(
          value,
          Array.from(
            { length: value.length + 1 },
            (_, index) => start + bom + at + index,
          ),
        )
    }
  }
  const tree = Preservation.read(ctx, source).sourceTree
  tree.children.forEach((node) => visit(node as RootContent))
  let cursor = 0
  doc.descendants((node, position) => {
    if (
      ['comment_inline', 'comment_block', 'reference_definition'].includes(
        node.type.name,
      )
    )
      return false
    if (!node.isText) return true
    const value = node.text!
    const at = text.indexOf(value, cursor)
    if (at < 0) return false
    for (let index = 0; index <= value.length; index++) {
      const offset =
        index === value.length ? ends[at + index] : offsets[at + index]
      if (offset != null)
        points.push({ formatted: position + index, source: offset })
    }
    cursor = at + value.length
    return false
  })
  const nearest = (
    position: number,
    from: 'source' | 'formatted',
    to: 'source' | 'formatted',
    bias = -1,
  ) => {
    let best: Point | undefined
    for (const point of points)
      if (
        !best ||
        Math.abs(point[from] - position) < Math.abs(best[from] - position) ||
        (bias > 0 &&
          Math.abs(point[from] - position) === Math.abs(best[from] - position))
      )
        best = point
    return best?.[to] ?? (from === 'formatted' ? 0 : 1)
  }
  return {
    source: (position: number, bias = -1) =>
      nearest(position, 'formatted', 'source', bias),
    formatted: (offset: number) => nearest(offset, 'source', 'formatted'),
  }
}
