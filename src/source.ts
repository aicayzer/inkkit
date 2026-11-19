import { matchingTextEdges } from './text-edges'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { literalCommentSpans } from './comments'
import type { DocumentFormat } from './types'

export const sourceAttribute = 'inkkitSource'
export interface SourceProvenance {
  readonly text: string
  readonly format: DocumentFormat
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
  if (
    node.type.name === 'paragraph' ||
    (node.type.name === 'heading' && node.attrs.form === 'setext')
  ) {
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

// The paragraph or heading without the spaces and tabs that end its text, and
// the pending breaks among them. Markdown trims them, so saving them takes
// `&#x20;`, which other apps show as text. A block whose text is only spaces
// keeps them. So do spaces after a soft break: without them the block would
// end in a line ending, which Markdown drops.
function withoutEndBlanks(node: ProseNode): ProseNode {
  if (node.type.name !== 'paragraph' && node.type.name !== 'heading')
    return node
  let end = node.content.size,
    blanks = false
  for (let index = node.childCount - 1; index >= 0; index--) {
    const child = node.child(index)
    if (child.type.name === 'hardbreak' && !child.attrs.isHTML) {
      if (child.attrs.isInline) return node
      end -= child.nodeSize
      continue
    }
    if (child.isText && !child.marks.some((mark) => mark.type.spec.code)) {
      const kept = child.text!.replace(/[ \t]+$/, '').length
      blanks ||= kept < child.nodeSize
      end -= child.nodeSize - kept
      if (!kept) continue
    }
    // Without spaces, a pending break alone is `completedSource`'s to drop.
    return blanks ? node.copy(node.content.cut(0, end)) : node
  }
  return node
}

interface LoadedEnds {
  /** Loaded paragraphs and headings that end in spaces, by type and text. */
  readonly spaced: Map<string, ProseNode[]>
  readonly results: WeakMap<ProseNode, ProseNode>
}
const loadedEnds = new WeakMap<ProseNode, LoadedEnds>()
const endKey = (node: ProseNode) => `${node.type.name}\0${node.textContent}`

/**
 * `doc` without the spaces and tabs at the end of each paragraph and heading
 * an edit reached. Typed text usually ends in a space: iOS predictive text adds
 * one after each word. A block that reads as one of `baseline`'s, as a block
 * the edit did not reach or one Undo restored does, keeps its own, so an
 * unedited document still saves its bytes. Unchanged subtrees keep their
 * identity and are visited once for each baseline.
 */
export function withoutTypedEndBlanks(
  doc: ProseNode,
  baseline: ProseNode,
): ProseNode {
  let loaded = loadedEnds.get(baseline)
  if (!loaded) {
    const spaced = new Map<string, ProseNode[]>()
    baseline.descendants((node) => {
      if (!node.isTextblock) return true
      if (withoutEndBlanks(node) !== node) {
        const key = endKey(node)
        spaced.set(key, [...(spaced.get(key) ?? []), node])
      }
      return false
    })
    loaded = { spaced, results: new WeakMap() }
    loadedEnds.set(baseline, loaded)
  }
  const { spaced, results } = loaded
  const visit = (node: ProseNode): ProseNode => {
    const cached = results.get(node)
    if (cached) return cached
    let result = node
    if (node.isTextblock) {
      const trimmed = withoutEndBlanks(node)
      if (
        trimmed !== node &&
        !spaced.get(endKey(node))?.some((loaded) => loaded.eq(node))
      )
        result = trimmed
    } else if (!node.isLeaf) {
      const children: ProseNode[] = []
      node.forEach((child) => children.push(visit(child)))
      if (children.some((child, index) => child !== node.child(index)))
        result = node.copy(Fragment.fromArray(children))
    }
    results.set(node, result)
    return result
  }
  return visit(doc)
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
  const { prefix, suffix } = matchingTextEdges(normalized, value)
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
  for (const span of literalCommentSpans(source)) {
    if (span.end <= from || span.start >= to) continue
    if (span.start > cursor)
      shareable += source.slice(cursor, Math.min(span.start, to))
    cursor = Math.max(cursor, Math.min(span.end, to))
  }
  shareable += source.slice(cursor, to)
  return { markdown: source.slice(from, to), shareable }
}
