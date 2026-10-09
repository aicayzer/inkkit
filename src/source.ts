import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { literalCommentSpans } from './comments'

export const sourceAttribute = 'inkkitSource'
export interface SourceProvenance {
  readonly text: string
  readonly format: 'md' | 'txt'
  readonly from: number
  readonly to: number
}

export function cleanSourceDoc(doc: ProseNode): ProseNode {
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
