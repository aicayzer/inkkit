import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { literalCommentSpans } from './comments'

export const sourceAttribute = 'inkkitSource'
export interface SourceProvenance {
  readonly text: string
  readonly format: 'md' | 'txt'
  readonly from: number
  readonly to: number
}

// Keep transient trailing Markdown breaks in the editing document and history,
// but do not ask preservation to save a boundary CommonMark cannot reopen.
// Unchanged subtrees retain their identity and are visited only once.
const completedLines = new WeakMap<ProseNode, ProseNode>()
function completedSource(node: ProseNode): ProseNode {
  const cached = completedLines.get(node)
  if (cached) return cached
  let result = node
  if (node.type.name === 'paragraph') {
    let end = node.content.size
    for (let index = node.childCount - 1; index >= 0; index--) {
      const child = node.child(index)
      if (
        child.type.name !== 'hardbreak' ||
        child.attrs.isInline ||
        child.attrs.isHTML
      )
        break
      end -= child.nodeSize
    }
    if (end !== node.content.size) result = node.copy(node.content.cut(0, end))
  } else if (!node.isLeaf && !node.isTextblock) {
    const children: ProseNode[] = []
    node.forEach((child) => children.push(completedSource(child)))
    if (children.some((child, index) => child !== node.child(index)))
      result = node.copy(Fragment.fromArray(children))
  }
  completedLines.set(node, result)
  return result
}

export function cleanSourceDoc(doc: ProseNode): ProseNode {
  doc = completedSource(doc)
  return doc.attrs[sourceAttribute] == null
    ? doc
    : doc.type.create({ ...doc.attrs, [sourceAttribute]: null }, doc.content)
}

export function rawOffset(source: string, normalized: number): number {
  let position = 0,
    count = 0
  while (position < source.length && count < normalized) {
    if (source[position] === '\r' && source[position + 1] === '\n') position++
    position++
    count++
  }
  return position
}

export function normalizedOffset(source: string, raw: number): number {
  return source.slice(0, raw).replace(/\r\n?/g, '\n').length
}

export function editedPlainSource(previous: string, value: string): string {
  const normalized = previous.replace(/\r\n?/g, '\n')
  if (normalized === value) return previous
  let prefix = 0,
    suffix = 0
  while (
    prefix < normalized.length &&
    prefix < value.length &&
    normalized[prefix] === value[prefix]
  )
    prefix++
  while (
    suffix < normalized.length - prefix &&
    suffix < value.length - prefix &&
    normalized[normalized.length - suffix - 1] ===
      value[value.length - suffix - 1]
  )
    suffix++
  const ending = /\r\n|\r|\n/.exec(previous)?.[0] ?? '\n'
  return (
    previous.slice(0, rawOffset(previous, prefix)) +
    value
      .slice(prefix, value.length - suffix)
      .replace(/\r\n?/g, '\n')
      .replaceAll('\n', ending) +
    previous.slice(rawOffset(previous, normalized.length - suffix))
  )
}

export function sourceSelection(
  source: string,
  start: number,
  end: number,
): { markdown: string; shareable: string } {
  const from = rawOffset(source, start),
    to = rawOffset(source, end)
  let shareable = '',
    cursor = from
  const bom = source.startsWith('\uFEFF') ? 1 : 0
  for (const parsed of literalCommentSpans(source.slice(bom))) {
    const span = { start: parsed.start + bom, end: parsed.end + bom }
    if (span.end <= from || span.start >= to) continue
    if (span.start > cursor)
      shareable += source.slice(cursor, Math.min(span.start, to))
    cursor = Math.max(cursor, Math.min(span.end, to))
  }
  shareable += source.slice(cursor, to)
  return { markdown: source.slice(from, to), shareable }
}
