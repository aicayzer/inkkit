import { parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { serialize } from './dialect'
import { restoreCodeEndings, finalCodeEnding } from './code-fences'
import { sourceFrontmatter } from './literals'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'

interface Block {
  start: number
  end: number
  form: string
  ast: SourceNode
}

interface SourceNode {
  type: string
  value?: string
  children?: SourceNode[]
  position?: { start: { offset?: number }; end: { offset?: number } }
  [key: string]: unknown
}

// Line endings are the document's, not the node's: a CRLF source and its LF
// canonical form describe the same text.
function signature(node: SourceNode): string {
  return JSON.stringify(node, (key, value) =>
    ['position', 'data', 'marker'].includes(key)
      ? undefined
      : typeof value === 'string'
        ? value.replace(/\r\n?/g, '\n')
        : value,
  )
}

function ownShape(node: SourceNode): string {
  return JSON.stringify(node, (key, value) =>
    ['position', 'data', 'children', 'value', 'marker'].includes(key)
      ? undefined
      : value,
  )
}

// The character that decides which list an item belongs to: its bullet, or the
// delimiter after its number. Items with different ones start a new list.
function markerAt(
  text: string,
  at: number,
): { at: number; marker: string } | undefined {
  const match = /^(?:[-*+]|\d{1,9}[.)])/.exec(text.slice(at, at + 10))
  return match
    ? { at: at + match[0].length - 1, marker: match[0].at(-1)! }
    : undefined
}

function relabel(text: string, offsets: number[], marker: string): string {
  for (const offset of offsets) {
    const found = markerAt(text, offset)
    if (
      found &&
      found.marker !== marker &&
      /[-*+]/.test(found.marker) === /[-*+]/.test(marker)
    )
      text = text.slice(0, found.at) + marker + text.slice(found.at + 1)
  }
  return text
}

function authoredMarker(list: SourceNode, source: string): string | undefined {
  const at = list.children?.[0]?.position?.start.offset
  return at == null ? undefined : markerAt(source, at)?.marker
}

const sameList = (before: SourceNode, after: SourceNode): boolean =>
  before.type === 'list' &&
  after.type === 'list' &&
  before.ordered === after.ordered

interface Neighbour {
  ordered: unknown
  marker: string
}

// Canonical Markdown written into authored source. Items written into an
// authored list take its marker, which they would otherwise split away from.
// A list written beside an authored list takes a marker that list does not
// use, which it would otherwise merge with.
function canonicalSlice(
  marker: string | undefined,
  children: SourceNode[],
  canonical: string,
  from: number,
  to: number,
  previous?: Neighbour,
  next?: Neighbour,
): string {
  let text = canonical.slice(from, to)
  const offsets = (list: SourceNode) =>
    (list.children ?? []).map((item) => item.position!.start.offset! - from)
  if (marker)
    return relabel(
      text,
      children.map((item) => item.position!.start.offset! - from),
      marker,
    )
  children.forEach((child, index) => {
    if (child.type !== 'list') {
      previous = undefined
      return
    }
    const avoid = [previous, index === children.length - 1 ? next : undefined]
      .filter((neighbour) => neighbour?.ordered === child.ordered)
      .map((neighbour) => neighbour!.marker)
    const own = markerAt(
      canonical,
      child.children![0]!.position!.start.offset!,
    )?.marker
    const choice = [
      own,
      ...(child.ordered ? ['.', ')'] : ['-', '*', '+']),
    ].find((candidate) => candidate && !avoid.includes(candidate))
    if (choice) text = relabel(text, offsets(child), choice)
    previous = { ordered: child.ordered, marker: choice ?? own ?? '' }
  })
  return text
}

// The authored list a child is, as a neighbour of canonical Markdown.
function authoredNeighbour(
  before: SourceNode | undefined,
  after: SourceNode | undefined,
  source: string,
): Neighbour | undefined {
  if (!before || !after || !sameList(before, after)) return undefined
  const marker = authoredMarker(before, source)
  return marker ? { ordered: before.ordered, marker } : undefined
}

function retainText(
  raw: string,
  before: string,
  after: string,
  quoteIndent = false,
  inTable = false,
): string {
  before = before.replace(/\r\n?/g, '\n')
  after = after.replace(/\r\n?/g, '\n')
  let prefix = 0
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++
  const offsets = [0]
  let decoded = ''
  for (let index = 0; index < raw.length;) {
    if (index > 0 && raw[index - 1] === '\n') {
      const gutter = (
        quoteIndent ? /^(?:[ \t]*>[ \t]*)+/ : /^(?:[ \t]*>[ \t]?)+/
      ).exec(raw.slice(index))
      if (gutter) {
        index += gutter[0].length
        offsets[offsets.length - 1] = index
        continue
      }
    }
    const escaped = /^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/.exec(
      raw.slice(index),
    )
    const entity = /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);/.exec(
      raw.slice(index),
    )
    let value: string
    let length: number
    if (escaped) {
      value = escaped[1]!
      length = escaped[0].length
    } else if (entity) {
      const element = document.createElement('textarea')
      element.innerHTML = entity[0]
      value = element.value
      length = entity[0].length
    } else if (raw.slice(index, index + 2) === '\r\n') {
      value = '\n'
      length = 2
    } else {
      value = raw[index]!
      length = 1
    }
    decoded += value
    index += length
    for (let part = 0; part < value.length; part++) offsets.push(index)
  }
  if (decoded !== before) {
    // Continuation indentation is excluded from a quoted paragraph's text.
    return quoteIndent ? after : retainText(raw, before, after, true, inTable)
  }
  const inserted = after
    .slice(prefix, after.length - suffix)
    .split('')
    .map((character, index) => {
      const at = prefix + index
      const delimiter =
        (character === '%' || character === '=') &&
        (after[at - 1] === character || after[at + 1] === character)
      return delimiter ||
        /[\\`*_[\]<>]/.test(character) ||
        (inTable && character === '|')
        ? `\\${character}`
        : character
    })
    .join('')
  return (
    raw.slice(0, offsets[prefix]) +
    inserted +
    raw.slice(offsets[before.length - suffix])
  )
}

function retainBoundaryWhitespace(raw: string, canonical: string): string {
  // A middle-of-line space becomes indentation or trimmed text at a block edge.
  const token = '(?:[ \\t]|&#(?:[xX]0*(?:20|9)|0*(?:32|9));|&Tab;)'
  const decoded = (value: string): string =>
    (value.match(new RegExp(token, 'g')) ?? [])
      .map((value) =>
        value === '\t' || /(?:9;|Tab;)$/.test(value) ? '\t' : ' ',
      )
      .join('')
  const encode = (value: string): string =>
    value.replace(/[ \t]/g, (value) => (value === '\t' ? '&#x9;' : '&#x20;'))
  const start = /^[ \t]+/.exec(raw)?.[0]
  const rawStart = new RegExp(`^${token}+`).exec(raw)?.[0]
  const encodedStart = new RegExp(`^${token}+`).exec(canonical)?.[0]
  if (
    start &&
    rawStart &&
    encodedStart?.includes('&') &&
    decoded(rawStart) === decoded(encodedStart)
  )
    raw = encode(start) + raw.slice(start.length)
  const end = /[ \t]+$/.exec(raw)?.[0]
  const rawEnd = new RegExp(`${token}+$`).exec(raw)?.[0]
  const encodedEnd = new RegExp(`${token}+$`).exec(canonical)?.[0]
  if (
    end &&
    rawEnd &&
    encodedEnd?.includes('&') &&
    decoded(rawEnd) === decoded(encodedEnd)
  )
    raw = raw.slice(0, -end.length) + encode(end)
  return raw
}

// Patch changed leaves so an adjacent edit retains authored delimiters and labels.
function retainSource(
  before: SourceNode,
  after: SourceNode,
  source: string,
  canonical: string,
  lineEnding: string,
  inTable = false,
): string {
  const start = before.position?.start.offset
  const end = before.position?.end.offset
  const newStart = after.position?.start.offset
  const newEnd = after.position?.end.offset
  if (start == null || end == null || newStart == null || newEnd == null)
    throw new PreservationError('A source token has no location')
  const raw = source.slice(start, end)
  if (
    before.type === 'code' &&
    after.type === 'code' &&
    before.lang === after.lang
  ) {
    const opening = /^([ \t>]*)(`{3,}|~{3,})([^\r\n]*)(\r?\n)/.exec(raw)
    if (opening) {
      const lines = raw.slice(opening[0].length).split(/\r?\n/)
      const closing = /^([ \t>]*)(`{3,}|~{3,})([ \t]*)$/.exec(
        lines.at(-1) ?? '',
      )
      const originalLine =
        (before.value ?? '').replace(/\r\n?/g, '\n').split('\n')[0] ?? ''
      const first = lines[0] ?? ''
      const gutter = first.endsWith(originalLine)
        ? first.slice(0, first.length - originalLine.length)
        : opening[1]!
      const body = (after.value ?? '').replace(/\r\n?/g, '\n').split('\n')
      const character = opening[2]![0]!
      let length = opening[2]!.length
      for (const line of body) {
        const run = new RegExp(`^ {0,3}(${character}+)[ \\t]*$`).exec(line)
        if (run) length = Math.max(length, run[1]!.length + 1)
      }
      const fence = character.repeat(length)
      return (
        opening[1] +
        fence +
        opening[3] +
        lineEnding +
        body.map((line) => gutter + line).join(lineEnding) +
        (closing
          ? lineEnding +
            closing[1] +
            character.repeat(Math.max(length, closing[2]!.length)) +
            closing[3]
          : '')
      )
    }
  }
  if (
    before.type === 'definition' &&
    after.type === 'definition' &&
    before.label === after.label &&
    before.title === after.title
  ) {
    const destination =
      /^(\[[\s\S]*?\]:[ \t]*)(<[^>\n]*>|[^\s]+)([\s\S]*)$/.exec(raw)
    if (destination)
      return (
        destination[1] +
        (destination[2]!.startsWith('<')
          ? `<${after.url}>`
          : String(after.url)) +
        destination[3]
      )
  }
  if (before.type === 'text' && after.type === 'text')
    return retainBoundaryWhitespace(
      withEnding(
        retainText(raw, before.value!, after.value!, false, inTable),
        lineEnding,
      ),
      canonical.slice(newStart, newEnd),
    )
  if (
    signature(before) === signature(after) &&
    ownShape(before) === ownShape(after)
  )
    return raw
  const marker = sameList(before, after)
    ? authoredMarker(before, source)
    : undefined
  if (
    before.type === after.type &&
    ownShape(before) === ownShape(after) &&
    before.children &&
    after.children &&
    before.children.length === after.children.length
  ) {
    let output = '',
      at = start
    let previous: Neighbour | undefined
    const retained = new Set<number>()
    before.children.forEach((child, index) => {
      const incoming = after.children![index]!
      const movedIndex =
        before.type === 'table' || before.type === 'tableRow'
          ? before.children!.findIndex(
              (candidate, candidateIndex) =>
                !retained.has(candidateIndex) &&
                signature(candidate) === signature(incoming) &&
                ownShape(candidate) === ownShape(incoming),
            )
          : -1
      const original = movedIndex < 0 ? child : before.children![movedIndex]!
      if (movedIndex >= 0) retained.add(movedIndex)
      const childStart = child.position?.start.offset,
        childEnd = child.position?.end.offset
      if (childStart == null || childEnd == null)
        throw new PreservationError('A source token has no location')
      let retainedSource =
        incoming.type === 'list' && !sameList(original, incoming)
          ? withEnding(
              canonicalSlice(
                undefined,
                [incoming],
                canonical,
                incoming.position!.start.offset!,
                incoming.position!.end.offset!,
                previous,
                authoredNeighbour(
                  before.children![index + 1],
                  after.children![index + 1],
                  source,
                ),
              ),
              lineEnding,
            )
          : retainSource(
              original,
              incoming,
              source,
              canonical,
              lineEnding,
              inTable || before.type === 'tableCell',
            )
      if (before.type === 'tableRow' && movedIndex >= 0) {
        // Cell positions own different pipe boundaries at the row edges.
        const originalFrom = original.children?.[0]?.position?.start.offset
        const originalTo = original.children?.at(-1)?.position?.end.offset
        const from = child.children?.[0]?.position?.start.offset
        const to = child.children?.at(-1)?.position?.end.offset
        retainedSource =
          originalFrom != null &&
          originalTo != null &&
          from != null &&
          to != null
            ? source.slice(childStart, from) +
              source.slice(originalFrom, originalTo) +
              source.slice(to, childEnd)
            : withEnding(
                canonical.slice(
                  incoming.position!.start.offset!,
                  incoming.position!.end.offset!,
                ),
                lineEnding,
              )
      }
      if (marker) retainedSource = relabel(retainedSource, [0], marker)
      previous =
        incoming.type !== 'list'
          ? undefined
          : (authoredNeighbour(original, incoming, source) ?? {
              ordered: incoming.ordered,
              marker:
                markerAt(
                  retainedSource,
                  /^[ \t]*/.exec(retainedSource)![0].length,
                )?.marker ?? '',
            })
      output += source.slice(at, childStart) + retainedSource
      at = childEnd
    })
    return output + source.slice(at, end)
  }
  if (
    before.type === after.type &&
    ownShape(before) === ownShape(after) &&
    before.children &&
    after.children
  ) {
    let prefix = 0,
      suffix = 0
    while (
      prefix < before.children.length &&
      prefix < after.children.length &&
      signature(before.children[prefix]!) === signature(after.children[prefix]!)
    )
      prefix++
    while (
      suffix < before.children.length - prefix &&
      suffix < after.children.length - prefix &&
      signature(before.children[before.children.length - 1 - suffix]!) ===
        signature(after.children[after.children.length - 1 - suffix]!)
    )
      suffix++
    // A bare URL takes in text written against it, so one beside a change is
    // written again with that change rather than kept as authored.
    const bare = (node: SourceNode | undefined) =>
      node?.type === 'link' &&
      !/^[<[]/.test(source.slice(node.position?.start.offset ?? 0))
    if (prefix && bare(before.children[prefix - 1])) prefix--
    if (suffix && bare(before.children[before.children.length - suffix]))
      suffix--
    // A cell's range includes its pipe and padding, which would hide a space
    // now at the edge of its content from the boundary check.
    const cell =
      before.type === 'tableCell' &&
      before.children.length > 0 &&
      after.children.length > 0
    const first = cell ? before.children[0]!.position?.start.offset : start
    const last = cell ? before.children.at(-1)!.position?.end.offset : end
    const newFirst = cell ? after.children[0]!.position?.start.offset : newStart
    const newLast = cell ? after.children.at(-1)!.position?.end.offset : newEnd
    const from = prefix
      ? before.children[prefix - 1]!.position?.end.offset
      : first
    const to = suffix
      ? before.children[before.children.length - suffix]!.position?.start.offset
      : last
    const newFrom = prefix
      ? after.children[prefix - 1]!.position?.end.offset
      : newFirst
    const newTo = suffix
      ? after.children[after.children.length - suffix]!.position?.start.offset
      : newLast
    if (
      first != null &&
      last != null &&
      newFirst != null &&
      newLast != null &&
      from != null &&
      to != null &&
      newFrom != null &&
      newTo != null
    )
      return (
        source.slice(start, first) +
        retainBoundaryWhitespace(
          source.slice(first, from) +
            withEnding(
              canonicalSlice(
                marker,
                after.children.slice(prefix, after.children.length - suffix),
                canonical,
                newFrom,
                newTo,
                authoredNeighbour(
                  before.children[prefix - 1],
                  after.children[prefix - 1],
                  source,
                ),
                authoredNeighbour(
                  before.children[before.children.length - suffix],
                  after.children[after.children.length - suffix],
                  source,
                ),
              ),
              lineEnding,
            ) +
            source.slice(to, last),
          canonical.slice(newFirst, newLast),
        ) +
        source.slice(last, end)
      )
  }
  // A list can end after blank lines that its container gave it; keep the
  // authored ones rather than add the canonical ones beside them, unless the
  // list became tight or loose, which those lines can undo.
  const lastAfter = after.children?.at(-1)?.position?.end.offset
  const lastBefore = before.children?.at(-1)?.position?.end.offset
  const trailing =
    marker != null &&
    lastAfter != null &&
    lastBefore != null &&
    loose(before, source) === loose(after, canonical)
  return (
    withEnding(
      canonicalSlice(
        marker,
        after.children ?? [],
        canonical,
        newStart,
        trailing ? lastAfter : newEnd,
      ),
      lineEnding,
    ) + (trailing ? source.slice(lastBefore, end) : '')
  )
}

// Whether blank lines separate a list's items or the blocks inside one. A
// list's own spread can also count blank lines after its last item.
function loose(list: SourceNode, text: string): boolean {
  const blank = (from?: number, to?: number) =>
    from != null && to != null && /\n[ \t>]*\r?\n/.test(text.slice(from, to))
  const gaps = (nodes: SourceNode[]) =>
    nodes.some((node, index) =>
      index
        ? blank(
            nodes[index - 1]!.position?.end.offset,
            node.position?.start.offset,
          )
        : false,
    )
  const items = list.children ?? []
  return gaps(items) || items.some((item) => gaps(item.children ?? []))
}

// How a reference label is matched to a definition. Footnote labels, which
// start with `^`, are a separate set.
function definitionLabel(label: string): string {
  return label.startsWith('^')
    ? '^' + normalizeIdentifier(label.slice(1))
    : normalizeIdentifier(label)
}

// Whether two nodes have the same blocks, leaving inline content aside.
function sameBlocks(left: ProseNode, right: ProseNode): boolean {
  if (left.type !== right.type || left.isTextblock !== right.isTextblock)
    return false
  if (left.isTextblock) return true
  if (left.childCount !== right.childCount) return false
  for (let index = 0; index < left.childCount; index++)
    if (!sameBlocks(left.child(index), right.child(index))) return false
  return true
}

// Canonical Markdown keeps authored CRLF inside literal blocks and code fences.
function withEnding(text: string, lineEnding: string): string {
  return lineEnding === '\n' ? text : text.replace(/\r?\n/g, lineEnding)
}

function positionalNode(tree: Root, transformed: SourceNode): SourceNode {
  return (
    (tree.children.find(
      (node) =>
        node.position?.start.offset === transformed.position?.start.offset &&
        node.position?.end.offset === transformed.position?.end.offset,
    ) as unknown as SourceNode | undefined) ?? transformed
  )
}

export class PreservationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PreservationError'
  }
}

function form(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
}

function blockForm(ctx: Ctx, node: ProseNode): string {
  // An empty document is empty Markdown, but an empty block inside a document
  // is authored spacing and must remain a real block when read again.
  if (node.type.name === 'paragraph' && node.content.size === 0) return '<br />'
  return form(serialize(ctx, node.type.schema.topNodeType.create(null, [node])))
}

export function semanticSignature(doc: ProseNode): string {
  const clean = (value: Record<string, unknown>): Record<string, unknown> => {
    if (value.type === 'inkkit_wiki_link' && value.attrs) {
      const {
        raw: _raw,
        inTable: _inTable,
        ...attrs
      } = value.attrs as Record<string, unknown>
      value = { ...value, attrs }
    }
    const content = value.content as Record<string, unknown>[] | undefined
    if (!content) return value
    const tokens: Record<string, unknown>[] = []
    for (const child of content) {
      if (child.type !== 'text') {
        tokens.push(clean(child))
        continue
      }
      const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(child.text))!
      for (const [index, text] of parts.slice(1).entries()) {
        if (!text) continue
        const token = {
          ...child,
          text: text.replace(/\r\n?/g, '\n'),
          marks: index === 1 ? child.marks : undefined,
        }
        const previous = tokens.at(-1)
        if (
          previous?.type === 'text' &&
          JSON.stringify(previous.marks) === JSON.stringify(token.marks)
        )
          previous.text = String(previous.text) + text
        else tokens.push(token)
      }
    }
    return { ...value, content: tokens }
  }
  const json = JSON.parse(
    JSON.stringify(doc.toJSON(), (key, value) =>
      // Fresh list items default to loose even when their Markdown reopens tight.
      [
        'referenceContent',
        'referenceType',
        'listPlaceholder',
        'marker',
        'id',
        'label',
        'spread',
        'authoredFence',
        'inkkitFileRaw',
        'inkkitFileWidth',
        'inkkitFileInTable',
      ].includes(key)
        ? undefined
        : value,
    ),
  ) as Record<string, unknown>
  return JSON.stringify(clean(json))
}

// Milkdown derives heading DOM IDs; Markdown stores the level and content.
function withoutHeadingId(node: ProseNode): ProseNode {
  return node.type.name === 'heading' && node.attrs.id
    ? node.type.create({ ...node.attrs, id: '' }, node.content, node.marks)
    : node
}

const MATCHING_BUDGET = 1_000_000
const SIMILARITY_BUDGET = 4_000_000

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

function tooManyBlocks(): PreservationError {
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
function pairSimilar(
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

type Kept = 'unchanged' | 'edited' | 'canonical'

/** Retains the loaded source of blocks the edit leaves alone. */
export class Preservation {
  private readonly baseline: ProseNode
  private readonly blocks: Block[] = []
  private readonly lineEnding: string
  private readonly originalForms = new Set<string>()
  private readonly forms = new WeakMap<ProseNode, string>()
  private readonly blockEdits = new WeakMap<
    ProseNode,
    { index: number; text: string }
  >()
  private readonly itemEdits = new WeakMap<
    ProseNode,
    { index: number; item: number; text: string }
  >()
  private readonly definitionNodes = new Map<string, number>()
  // Undefined when a definition sits inside another block, where appending
  // the top-level ones would not reproduce the document.
  private readonly definitionSources?: Array<{ label: string; text: string }>

  constructor(
    private readonly ctx: Ctx,
    private readonly source: string,
  ) {
    try {
      const parse = ctx.get(parserCtx)
      this.baseline = parse(source)
      this.lineEnding =
        source.includes('\r\n') && !source.replaceAll('\r\n', '').includes('\n')
          ? '\r\n'
          : '\n'
      const processor = ctx.get(remarkCtx)
      const offset = source.startsWith('\uFEFF') ? 1 : 0
      const body = source.slice(offset)
      const rawTree = processor.parse(source) as Root
      const tree = processor.runSync(structuredClone(rawTree), {
        value: body,
      }) as Root
      for (const [index, node] of tree.children.entries()) {
        let start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start == null || end == null)
          throw new PreservationError('A source block has no location')
        start += offset
        const sourceEnd = end + offset
        const firstColumn = source.lastIndexOf('\n', start - 1) + 1
        if (/^[ \t]*$/.test(source.slice(firstColumn, start)))
          start = firstColumn
        const text = source.slice(start, sourceEnd)
        const parsed =
          this.baseline.childCount === tree.children.length
            ? this.baseline.type.create(null, [this.baseline.child(index)])
            : parse(text)
        this.blocks.push({
          start,
          end: sourceEnd,
          form:
            parsed.childCount === 1
              ? blockForm(ctx, parsed.firstChild!)
              : form(serialize(ctx, parsed)),
          ast: positionalNode(rawTree, node as unknown as SourceNode),
        })
      }
      for (const block of this.blocks) this.originalForms.add(block.form)
      const definition = (node: SourceNode) =>
        node.type === 'definition' || node.type === 'footnoteDefinition'
      const nested = (node: SourceNode): boolean =>
        (node.children ?? []).some(
          (child) => definition(child) || nested(child),
        )
      const top = rawTree.children as unknown as SourceNode[]
      if (!top.some(nested))
        this.definitionSources = top.filter(definition).map((node) => {
          const raw = source.slice(
            node.position!.start.offset! + offset,
            node.position!.end.offset! + offset,
          )
          // A footnote reference is never validated alone, so only its label
          // matters, and its body need not be parsed on every keystroke.
          const label = /^\[((?:\\[\s\S]|[^\\\]])*)\]:/.exec(raw)![1]!
          return node.type === 'footnoteDefinition'
            ? { label: definitionLabel(label), text: `[${label}]: x` }
            : { label: definitionLabel(label), text: raw }
        })
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot read Markdown for preservation', {
        cause,
      })
    }
  }

  private retainBlock(
    block: Block,
    after: SourceNode,
    canonical: string,
  ): string {
    const offset = this.source.startsWith('\uFEFF') ? 1 : 0
    const start = block.ast.position?.start.offset
    if (start == null)
      throw new PreservationError('A source block has no location')
    return (
      this.source.slice(block.start, start + offset) +
      retainSource(
        block.ast,
        after,
        this.source.slice(offset),
        canonical,
        this.lineEnding,
      )
    )
  }

  private localEdits(doc: ProseNode): string | undefined {
    if (
      this.baseline.childCount !== this.blocks.length ||
      doc.childCount !== this.blocks.length ||
      !doc.sameMarkup(this.baseline)
    )
      return undefined
    let output = '',
      previous = 0
    let run: number[] = []
    for (let index = 0; index <= doc.childCount; index++) {
      const node = index < doc.childCount ? doc.child(index) : undefined
      if (!node || node.eq(this.baseline.child(index))) {
        if (run.length > 1 && !this.pairedInPlace(doc, run)) return undefined
        run = []
        continue
      }
      run.push(index)
      const block = this.blocks[index]!
      let retained = this.blockEdits.get(node)
      if (retained?.index !== index) {
        const text = this.localBlock(index, node)
        if (text === undefined) return undefined
        retained = { index, text }
        this.blockEdits.set(node, retained)
      }
      output += this.source.slice(previous, block.start) + retained.text
      previous = block.end
    }
    output += this.source.slice(previous)
    // Front matter is found by reading from the start of the file to the next
    // delimiter line, which an edited block can supply.
    const bom = (text: string) => text.replace(/^\uFEFF/, '')
    return sourceFrontmatter(bom(output)) ===
      sourceFrontmatter(bom(this.source))
      ? output
      : undefined
  }

  // Whole-document matching pairs adjacent edited blocks by resemblance, which
  // can pair one with its neighbour's original. Keep its result exactly.
  private pairedInPlace(doc: ProseNode, run: number[]): boolean {
    if (
      run.some((index) =>
        ['bullet_list', 'ordered_list'].includes(doc.child(index).type.name),
      )
    )
      return false
    const before = run.map((index) => this.blocks[index]!.form)
    const after = run.map((index) => this.formOf(doc.child(index)))
    const result: Array<number | undefined> = run.map((_, at) => at)
    pairSimilar(before, after, 0, run.length, 0, run.length, result, {
      similarity: SIMILARITY_BUDGET,
    })
    return result.every((position, at) => position === at)
  }

  // Every definition in the source, in order. A block's links can depend on
  // definitions and nothing else outside it, so parsing it with these gives
  // the meaning it has in the document.
  // The definitions a block's text can refer to: only a bracketed label that
  // matches one can resolve, so the others need not be parsed with it.
  private definitions(
    text: string,
  ): { text: string; blocks: number; nodes: number } | undefined {
    if (this.definitionSources === undefined) return undefined
    const labels = new Set<string>()
    for (const match of text.matchAll(/\[((?:\\[\s\S]|[^\\[\]])*)\]/g))
      labels.add(definitionLabel(match[1]!))
    const sources = this.definitionSources
      .filter((source) => labels.has(source.label))
      .map((source) => source.text)
    const appended = sources.join('\n\n')
    let nodes = this.definitionNodes.get(appended)
    if (nodes === undefined) {
      nodes = appended ? this.ctx.get(parserCtx)(appended).childCount : 0
      this.definitionNodes.set(appended, nodes)
    }
    return { text: appended, blocks: sources.length, nodes }
  }

  // The block's text followed by what it can depend on elsewhere in the
  // document, or undefined when that cannot be known from the block alone.
  private inContext(
    text: string,
  ): { text: string; blocks: number; nodes: number } | undefined {
    // HTML and %% comments can span blocks.
    if (/<|%%/.test(text)) return undefined
    if (!text.includes('[')) return { text, blocks: 1, nodes: 1 }
    const definitions = this.definitions(text)
    if (!definitions) return undefined
    return definitions.text
      ? {
          text: text + this.lineEnding.repeat(2) + definitions.text,
          blocks: 1 + definitions.blocks,
          nodes: 1 + definitions.nodes,
        }
      : { text, blocks: 1, nodes: 1 }
  }

  // The first block of text as the document would read it in place.
  private parseLocally(text: string): ProseNode | undefined {
    const local = this.inContext(text)
    if (!local) return undefined
    const parsed = this.ctx.get(parserCtx)(local.text)
    return parsed.childCount === local.nodes ? parsed.firstChild! : undefined
  }

  // Canonical Markdown for a block and its source tree, read in the same
  // context, so references in it resolve as they do in the document.
  private canonicalTree(
    text: string,
  ): { canonical: string; node: SourceNode } | undefined {
    const local = this.inContext(text)
    if (!local) return undefined
    const tree = this.ctx.get(remarkCtx).parse(local.text) as Root
    return tree.children.length === local.blocks
      ? {
          canonical: local.text,
          node: tree.children[0] as unknown as SourceNode,
        }
      : undefined
  }

  // Inline content other than text and line breaks can depend on other blocks
  // or carry attributes that a reparse does not reproduce.
  private static plainInline(node: ProseNode): boolean {
    let plain = true
    node.descendants((child) => {
      if (child.isInline && !child.isText && child.type.name !== 'hardbreak')
        plain = false
      return plain
    })
    return plain
  }

  private separated(index: number): boolean {
    const block = this.blocks[index]!
    return (
      (index === 0 ||
        /\r?\n[ \t]*\r?\n/.test(
          this.source.slice(this.blocks[index - 1]!.end, block.start),
        )) &&
      (index + 1 === this.blocks.length ||
        /\r?\n[ \t]*\r?\n/.test(
          this.source.slice(block.end, this.blocks[index + 1]!.start),
        ))
    )
  }

  // Validates a changed block on its own when nothing outside it can change
  // what it means, so a keystroke does not serialize and reparse the document.
  private localBlock(index: number, node: ProseNode): string | undefined {
    const before = this.baseline.child(index)
    const block = this.blocks[index]!
    const expected = withoutHeadingId(node)
    if (
      !expected.sameMarkup(withoutHeadingId(before)) ||
      !this.separated(index)
    )
      return undefined
    if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list')
      return this.localItems(index, node)
    const code = node.type.name === 'code_block'
    // Indented code is rewritten fenced, and the blocks after it can then read
    // differently.
    if (
      code &&
      !/^ {0,3}(?:`{3,}|~{3,})/.test(this.source.slice(block.start, block.end))
    )
      return undefined
    if (
      !code &&
      (!['paragraph', 'heading', 'table'].includes(node.type.name) ||
        !Preservation.plainInline(node) ||
        !Preservation.plainInline(before) ||
        !this.inContext(this.source.slice(block.start, block.end)))
    )
      return undefined
    const form = this.formOf(node)
    if (form !== block.form && this.originalForms.has(form)) return undefined
    // Code is literal, so only its fence decides where it ends.
    const canonical = code
      ? (() => {
          const tree = this.ctx.get(remarkCtx).parse(form) as Root
          return tree.children.length === 1
            ? {
                canonical: form,
                node: tree.children[0] as unknown as SourceNode,
              }
            : undefined
        })()
      : this.canonicalTree(form)
    if (!canonical) return undefined
    const text = this.retainBlock(block, canonical.node, canonical.canonical)
    const reopened = code
      ? (() => {
          const parsed = this.ctx.get(parserCtx)(text)
          return parsed.childCount === 1 ? parsed.firstChild! : undefined
        })()
      : this.parseLocally(text)
    // The authored fence is presentation the editor keeps from loading.
    const same = (node: ProseNode) =>
      code
        ? node.type === expected.type &&
          node.attrs.language === expected.attrs.language &&
          node.content.eq(expected.content)
        : withoutHeadingId(node).eq(expected)
    return reopened && same(reopened) ? text : undefined
  }

  private formOf(node: ProseNode): string {
    let form = this.forms.get(node)
    if (form == null) {
      form = blockForm(this.ctx, node)
      this.forms.set(node, form)
    }
    return form
  }

  // A list is one block, so typing in one item of a long list validates that
  // item alone, read as the only item of a list with the same marker.
  private localItems(index: number, node: ProseNode): string | undefined {
    const before = this.baseline.child(index)
    const block = this.blocks[index]!
    const list = block.ast
    const offset = this.source.startsWith('\uFEFF') ? 1 : 0
    const source = this.source.slice(offset)
    if (
      list.type !== 'list' ||
      list.children?.length !== node.childCount ||
      before.childCount !== node.childCount
    )
      return undefined
    // Whole-document matching would read a list that now matches another one
    // as moved there.
    for (let other = 0; other < this.baseline.childCount; other++) {
      const candidate = this.baseline.child(other)
      if (
        other !== index &&
        candidate.type === node.type &&
        candidate.childCount === node.childCount &&
        candidate.textContent === node.textContent
      )
        return undefined
    }
    const marker = authoredMarker(list, source)
    let output = ''
    let previous = block.start
    for (let at = 0; at < node.childCount; at++) {
      const item = node.child(at)
      if (item.eq(before.child(at))) continue
      let retained = this.itemEdits.get(item)
      if (retained?.index !== index || retained.item !== at) {
        const text = this.localItem(
          node,
          item,
          before.child(at),
          list.children[at]!,
          source,
          marker,
        )
        if (text === undefined) return undefined
        retained = { index, item: at, text }
        this.itemEdits.set(item, retained)
      }
      const ast = list.children[at]!
      output +=
        this.source.slice(previous, ast.position!.start.offset! + offset) +
        retained.text
      previous = ast.position!.end.offset! + offset
    }
    return output + this.source.slice(previous, block.end)
  }

  private localItem(
    list: ProseNode,
    item: ProseNode,
    before: ProseNode,
    ast: SourceNode,
    source: string,
    marker: string | undefined,
  ): string | undefined {
    const start = ast.position!.start.offset!
    const end = ast.position!.end.offset!
    if (
      !item.sameMarkup(before) ||
      !sameBlocks(item, before) ||
      !Preservation.plainInline(item) ||
      !Preservation.plainInline(before) ||
      // The authored item is compared with the edit, so it must read the same
      // in this context too.
      !this.inContext(source.slice(start, end))
    )
      return undefined
    const local = this.canonicalTree(
      form(
        serialize(
          this.ctx,
          list.type.schema.topNodeType.create(null, [
            list.type.create(list.attrs, [item]),
          ]),
        ),
      ),
    )
    const after = local?.node.children?.[0]
    if (!local || local.node.children!.length !== 1 || !after) return undefined
    // Whether an item is spread depends on the blank lines around it, which an
    // edit that keeps its blocks does not change.
    let text = retainSource(
      ast,
      { ...after, spread: ast.spread },
      source,
      local.canonical,
      this.lineEnding,
    )
    if (marker) text = relabel(text, [0], marker)
    // The marker and the spaces after it set the column that continuation
    // lines, and blocks after the list, are read against.
    const content = ast.children?.[0]?.position?.start.offset
    if (content == null || !text.startsWith(source.slice(start, content)))
      return undefined
    // An item with nothing on its first line has a different content column.
    if (/^(?:[-*+]|\d{1,9}[.)])[ \t]*(?:\r?\n|$)/.test(text)) return undefined
    const indent = source.slice(source.lastIndexOf('\n', start - 1) + 1, start)
    if (!/^[ \t]*$/.test(indent)) return undefined
    const reopened = this.parseLocally(indent + text)
    if (reopened?.type !== list.type || reopened.childCount !== 1)
      return undefined
    const reread = reopened.firstChild!
    // The label and spacing of an item come from its list.
    const { label: _label, spread: _spread, ...attrs } = reread.attrs
    const { label: _l, spread: _s, ...expected } = item.attrs
    return reread.type === item.type &&
      JSON.stringify(attrs) === JSON.stringify(expected) &&
      reread.content.eq(item.content)
      ? text
      : undefined
  }

  // Two lists of one kind side by side are one list unless their markers
  // differ, so each run of adjacent lists gets markers that alternate. A list
  // written afresh changes first, then an edited list. An unchanged list keeps
  // its source unless a move changed one of its neighbours; otherwise the
  // reopen check refuses.
  private separateLists(
    doc: ProseNode,
    pieces: string[],
    kept: Kept[],
    positions: Array<number | undefined>,
    current: string[],
  ): void {
    const kind = (index: number): string | undefined => {
      const name = doc.maybeChild(index)?.type.name
      return name === 'bullet_list' || name === 'ordered_list'
        ? name
        : undefined
    }
    const marker = (index: number): string | undefined =>
      markerAt(pieces[index]!, /^[ \t]*/.exec(pieces[index]!)![0].length)
        ?.marker
    const elsewhere = new Set(
      current.filter((_, index) => kept[index] !== 'unchanged'),
    )
    const moved = (index: number) =>
      positions[index] == null && this.originalForms.has(current[index]!)
    // Beside its source neighbour, or beside new blocks only, with nothing
    // between them in the source moved elsewhere.
    const inPlace = (index: number, step: -1 | 1): boolean => {
      const own = positions[index]!
      let next = index + step
      while (
        next >= 0 &&
        next < pieces.length &&
        positions[next] == null &&
        !moved(next)
      )
        next += step
      if (next >= 0 && next < pieces.length && positions[next] == null)
        return false
      const other =
        next < 0
          ? -1
          : next >= pieces.length
            ? this.blocks.length
            : positions[next]!
      if ((other - own) * step <= 0) return false
      for (let at = own + step; at !== other; at += step)
        if (elsewhere.has(this.blocks[at]!.form)) return false
      return true
    }
    // An unchanged list changes only to part from a list with its marker across
    // a boundary that a move disturbed, and one moved on both sides first.
    const cost = (index: number): number => {
      if (kept[index] === 'canonical') return 1
      if (kept[index] === 'edited') return 10
      const own = marker(index)
      const sides = ([-1, 1] as const).map((step) => inPlace(index, step))
      const collides = ([-1, 1] as const).some(
        (step, side) =>
          !sides[side] &&
          kind(index + step) === kind(index) &&
          marker(index + step) === own,
      )
      return collides
        ? [50, 150][Number(sides[0]) + Number(sides[1])]!
        : Infinity
    }
    for (let start = 0; start < pieces.length;) {
      const list = kind(start)
      let end = start + 1
      while (list && kind(end) === list) end++
      const run = Array.from({ length: end - start }, (_, i) => start + i)
      start = end
      if (
        run.length < 2 ||
        run.every((index, i) => !i || marker(index) !== marker(index - 1))
      )
        continue
      const markers = list === 'bullet_list' ? ['-', '*', '+'] : ['.', ')']
      const options = run.map((index) => {
        const own = marker(index)
        const change = cost(index)
        const choices: Array<{ marker: string; cost: number; text: string }> =
          own ? [{ marker: own, cost: 0, text: pieces[index]! }] : []
        if (change !== Infinity)
          for (const choice of markers) {
            if (choice === own) continue
            const text = this.relabelList(pieces[index]!, choice)
            if (text !== undefined)
              choices.push({ marker: choice, cost: change, text })
          }
        return choices
      })
      // Fewest and cheapest changes, with adjacent markers always different.
      const best = options.map((choices) => choices.map(() => Infinity))
      const from = options.map((choices) => choices.map(() => -1))
      options[0]!.forEach((choice, j) => (best[0]![j] = choice.cost))
      for (let i = 1; i < options.length; i++)
        options[i]!.forEach((choice, j) => {
          options[i - 1]!.forEach((previous, k) => {
            const total = best[i - 1]![k]! + choice.cost
            if (previous.marker !== choice.marker && total < best[i]![j]!) {
              best[i]![j] = total
              from[i]![j] = k
            }
          })
        })
      const last = best.at(-1)!
      let j = last.indexOf(Math.min(...last))
      if (j < 0 || last[j] === Infinity) continue
      for (let i = options.length - 1; i >= 0; j = from[i]![j]!, i--)
        pieces[run[i]!] = options[i]![j]!.text
    }
  }

  private relabelList(text: string, marker: string): string | undefined {
    const processor = this.ctx.get(remarkCtx)
    const read = (text: string) =>
      (processor.parse(text) as Root).children as unknown as SourceNode[]
    const [list, ...rest] = read(text)
    if (list?.type !== 'list' || rest.length) return undefined
    const relabelled = relabel(
      text,
      list.children!.map((item) => item.position!.start.offset!),
      marker,
    )
    const reread = read(relabelled)
    // A bullet can turn an item into a thematic break, such as `* * *`.
    return reread.length === 1 &&
      signature(reread[0]!) === signature(list) &&
      markerAt(relabelled, list.children![0]!.position!.start.offset!)
        ?.marker === marker
      ? relabelled
      : undefined
  }

  serialize(doc: ProseNode): string {
    if (doc.eq(this.baseline)) return this.source
    try {
      const local = this.localEdits(doc)
      if (local !== undefined) return local
      const canonical = serialize(this.ctx, doc)
      if (canonical === '')
        return this.source.startsWith('\uFEFF') ? '\uFEFF' : ''
      const current: string[] = []
      doc.forEach((node) => current.push(this.formOf(node)))
      const forms = this.blocks.map((block) => block.form)
      const processor = this.ctx.get(remarkCtx)
      const currentRawTree = processor.parse(canonical) as Root
      const currentTree = processor.runSync(structuredClone(currentRawTree), {
        value: canonical,
      }) as Root
      const parse = this.ctx.get(parserCtx)
      const normalized = (text: string): string => text.replace(/\r\n?/g, '\n')
      const positions = correspondence(forms, current)
      const gaps: string[] = []
      const pieces: string[] = []
      const kept: Kept[] = []
      let previous: number | undefined
      current.forEach((text, index) => {
        const position = positions[index]
        const block = position == null ? undefined : this.blocks[position]
        if (index === 0) {
          if (position === 0 && block)
            gaps.push(this.source.slice(0, block.start))
          else gaps.push(this.source.startsWith('\uFEFF') ? '\uFEFF' : '')
        } else if (previous != null && position === previous + 1 && block) {
          gaps.push(this.source.slice(this.blocks[previous]!.end, block.start))
        } else gaps.push(this.lineEnding.repeat(2))
        const kind: Kept =
          block && block.form === text
            ? 'unchanged'
            : block && currentTree.children.length === current.length
              ? 'edited'
              : 'canonical'
        kept.push(kind)
        pieces.push(
          kind === 'unchanged'
            ? this.source.slice(block!.start, block!.end)
            : kind === 'edited'
              ? this.retainBlock(
                  block!,
                  positionalNode(
                    currentRawTree,
                    currentTree.children[index] as unknown as SourceNode,
                  ),
                  canonical,
                )
              : restoreCodeEndings(
                  this.ctx,
                  doc.type.create(null, [doc.child(index)]),
                  withEnding(text, this.lineEnding),
                ),
        )
        previous = position
      })
      this.separateLists(doc, pieces, kept, positions, current)
      let output = pieces.map((piece, index) => gaps[index] + piece).join('')
      if (previous === this.blocks.length - 1 && this.blocks.length)
        output += this.source.slice(this.blocks[previous]!.end)
      else if (output) output += finalCodeEnding(doc) ?? this.lineEnding
      // A `---` rule that opens the file reads back as front matter when
      // another `---` line follows, whether it is new or moved there.
      const bom = output.startsWith('\uFEFF') ? 1 : 0
      if (
        doc.firstChild?.type.name === 'hr' &&
        sourceFrontmatter(output.slice(bom))?.startsWith('---')
      )
        output = output.slice(0, bom) + '***' + output.slice(bom + 3)
      const reopened = parse(output)
      if (semanticSignature(reopened) === semanticSignature(doc)) {
        const actual = normalized(serialize(this.ctx, reopened))
        if (actual === normalized(canonical)) return output
        // Parsing may normalize loose-list spacing. Compare both reconstructed
        // source and intended canonical source after that same normalization.
        if (actual === normalized(serialize(this.ctx, parse(canonical))))
          return output
      }
      throw new PreservationError(
        'The edited Markdown cannot be reopened without changing its content',
      )
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot preserve the edited Markdown', {
        cause,
      })
    }
  }
}
