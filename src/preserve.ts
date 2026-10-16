import { parserCtx, remarkCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Root } from 'mdast'
import { serialize } from './dialect'
import { linkForm } from './link-form'
import { restoreCodeEndings, finalCodeEnding } from './code-fences'
import { lineBreakHTML, sourceFrontmatter } from './literals'
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
  return JSON.stringify(ordered(node), function (key, value) {
    if (['position', 'data', 'marker'].includes(key)) return undefined
    const holder = this as SourceNode
    // Every spelling of a line break reads back as the same break.
    if (key === 'value' && holder.type === 'html' && lineBreakHTML(value))
      return '<br />'
    // A row read as ending in empty cells is the row written without them.
    if (key === 'children' && holder.type === 'tableRow') {
      let end = (value as SourceNode[]).length
      while (end > 0 && !(value as SourceNode[])[end - 1]!.children?.length)
        end--
      return (value as SourceNode[]).slice(0, end)
    }
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : value
  })
}

const formatting = new Set(['emphasis', 'strong', 'delete', 'highlight'])

// Formatting around a whole link and a link around whole formatting read the
// same, so both are compared with the formatting outside.
function ordered(node: SourceNode): SourceNode {
  let current = node
  const inner = current.children?.[0]
  if (
    current.type === 'link' &&
    current.children!.length === 1 &&
    formatting.has(inner!.type)
  )
    current = {
      ...inner!,
      children: [{ ...current, children: inner!.children }],
    }
  return current.children
    ? { ...current, children: current.children.map(ordered) }
    : current
}

/** Where the delimiter row ends, given where the header row before it ends. */
function delimiterRowEnd(text: string, headerEnd: number): number {
  const next = text.indexOf('\n', headerEnd)
  if (next < 0) return headerEnd
  const ending = /\r?\n/g
  ending.lastIndex = next + 1
  return ending.exec(text)?.index ?? text.length
}

function ownShape(node: SourceNode): string {
  return JSON.stringify(ordered(node), (key, value) =>
    ['position', 'data', 'children', 'value', 'marker'].includes(key)
      ? undefined
      : value,
  )
}

// The shape two nodes must share to be the same child of a list or quote. A
// task ticked since is still the same item.
const matchShape = (node: SourceNode): string =>
  ownShape({ ...node, checked: undefined })

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

/** Where a block move carried children: by their parent, the original index
 *  of each moved child, by its current index. A parent is known by its type
 *  and where it starts in the source, since a list starts where its first
 *  item does. */
type Reorder = Map<string, Map<number, number>>

const parentKey = (node: SourceNode): string =>
  `${node.type}:${node.position!.start.offset!}`

// Whether a move carried children of `node` or of a block inside it.
function reorderedWithin(node: SourceNode, reorder?: Reorder): boolean {
  if (!reorder) return false
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start == null || end == null) return false
  for (const key of reorder.keys()) {
    const at = Number(key.slice(key.lastIndexOf(':') + 1))
    if (at >= start && at < end) return true
  }
  return false
}

/**
 * An item of an ordered list moved from `original`'s place to `place`'s, which
 * takes the number written there, so the numbers keep their order. Lines after
 * the first that are indented to the item's content move with it when the
 * number's width changes.
 */
function renumberItem(
  text: string,
  source: string,
  original: SourceNode,
  place: SourceNode,
): string {
  const own = /^\d{1,9}/.exec(text)?.[0]
  const number = /^\d{1,9}/.exec(
    source.slice(place.position!.start.offset!),
  )?.[0]
  if (!own || !number || own === number) return text
  const start = original.position!.start.offset!
  const content = original.children?.[0]?.position?.start.offset
  const lines = text.split(/(?<=\n)/)
  const prefix = source.slice(source.lastIndexOf('\n', start - 1) + 1, start)
  const indent = content == null ? -1 : content - start
  const first = lines[0]!
  if (indent < 0 || first.slice(0, indent).includes('\n')) return text
  const from = prefix + ' '.repeat(indent)
  const to = prefix + ' '.repeat(indent + number.length - own.length)
  return [
    number + first.slice(own.length),
    ...lines
      .slice(1)
      .map((line) =>
        line.startsWith(from) ? to + line.slice(from.length) : line,
      ),
  ].join('')
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

// How often a child may occur in an original and still place a part in it.
const RARE = 4

// Ending a list or quote in the middle splits it, and each part holds a run of
// the original's children. The run of a candidate that a part matches best
// stands in for the original, so the children the edit did not reach keep
// their source.

function splitPart(
  candidates: readonly SourceNode[],
  after: SourceNode,
  source: string,
  taken: ReadonlySet<SourceNode> = new Set(),
): SourceNode | undefined {
  if (
    (after.type !== 'list' && after.type !== 'blockquote') ||
    !after.children?.length
  )
    return undefined
  const ids = new Map<string, number>()
  const id = (node: SourceNode) => {
    const key = signature(node) + matchShape(node)
    let value = ids.get(key)
    if (value === undefined) ids.set(key, (value = ids.size))
    return value
  }
  const wanted = after.children.map(id)
  // The placements with the best score; more than one is a tie.
  // `from` is where the part's first child falls in the run.
  let best: Array<{ node: SourceNode; run: SourceNode[]; from: number }> = []
  let score = 0
  for (const node of candidates) {
    const children = node.children
    if (
      node.type !== after.type ||
      node.ordered !== after.ordered ||
      !children?.length
    )
      continue
    const have = children.map(id)
    const positions = new Map<number, number[]>()
    have.forEach((key, index) => {
      if (taken.has(children[index]!)) return
      const at = positions.get(key)
      if (at) at.push(index)
      else positions.set(key, [index])
    })
    // Each child found only a few times in the original suggests where the
    // part starts in it. A part can also run past either end of the original
    // by children it does not hold, such as an item added at its end.
    // Children another part already kept are not this part's.
    const votes = new Map<number, number>()
    wanted.forEach((key, index) => {
      const at = positions.get(key) ?? []
      if (at.length <= RARE)
        for (const position of at)
          votes.set(position - index, (votes.get(position - index) ?? 0) + 1)
    })
    const held = (key: number) => positions.has(key)
    const lead = wanted.findIndex(held)
    const trail = [...wanted].reverse().findIndex(held)
    const offsets = new Set([
      ...[...votes]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([offset]) => offset),
      ...(lead < 0 ? [] : [-lead, have.length - wanted.length + trail]),
    ])
    for (const from of offsets) {
      // Children another part kept can end the run, as edits do; one kept
      // inside it places the part elsewhere.
      let first = Math.max(0, from)
      let last = Math.min(have.length, from + wanted.length)
      while (first < last && taken.has(children[first]!)) first++
      while (last > first && taken.has(children[last - 1]!)) last--
      const run = children.slice(first, last)
      if (run.some((child) => taken.has(child))) continue
      let matched = 0
      for (let index = first; index < last; index++)
        if (have[index] === wanted[index - from]) matched++
      if (!matched || matched < score) continue
      if (matched > score) best = []
      score = matched
      best.push({ node, run, from: from - first })
    }
  }
  if (!best.length) return undefined
  // Tied placements that would give the part different source leave which
  // copy it is unknown, so it is written afresh.
  const spelling = (placement: (typeof best)[number]) =>
    JSON.stringify(
      wanted.map((_, index) => {
        const child = placement.run[index + placement.from]
        return (
          child &&
          source.slice(child.position?.start.offset, child.position?.end.offset)
        )
      }),
    )
  if (new Set(best.map(spelling)).size > 1) return undefined
  const { node: original, run } = best[0]!
  const start = run[0]!.position?.start.offset
  const end = run.at(-1)!.position?.end.offset
  if (start == null || end == null) return undefined
  const part: SourceNode = {
    ...original,
    children: run,
    position: { start: { offset: start }, end: { offset: end } },
  }
  if (part.type === 'blockquote') {
    // The part opens at the quote's marker on the line of its first child.
    const opening = original.position!.start.offset!
    const column = opening - (source.lastIndexOf('\n', opening - 1) + 1)
    const marker = source.lastIndexOf('\n', start - 1) + 1 + column
    if (source[marker] !== '>' || marker > start) return undefined
    part.position!.start.offset = marker
  } else {
    part.spread = run.some(
      (item, index) =>
        index > 0 &&
        /\n[ \t>]*\r?\n/.test(
          source.slice(
            run[index - 1]!.position!.end.offset,
            item.position!.start.offset,
          ),
        ),
    )
    // The number the part's first item was written with is where it starts.
    if (part.ordered) part.start = Number(/^\d+/.exec(source.slice(start))![0])
  }
  return part
}

// The source of a part split from an original, from the offset it starts at
// in the source.
function retainSplit(
  candidates: readonly SourceNode[],
  after: SourceNode,
  source: string,
  canonical: string,
  lineEnding: string,
  // Children of originals that other parts kept, which this part takes too.
  taken: Set<SourceNode>,
): { from: number; text: string } | undefined {
  const part = splitPart(candidates, after, source, taken)
  if (!part) return undefined
  for (const child of part.children!) taken.add(child)
  return {
    from: part.position!.start.offset!,
    text: retainSource(part, after, source, canonical, lineEnding),
  }
}

// Children written afresh between authored ones, each read against the
// original it continues: a list or quote split from an original keeps that
// run of its children, and an item that keeps its first line is the original
// item. An item that does not still keeps the lists and quotes split into it.
// Undefined when no child continues an original.
function retainParts(
  marker: string | undefined,
  before: SourceNode[],
  after: SourceNode[],
  source: string,
  canonical: string,
  from: number,
  to: number,
  lineEnding: string,
  previous?: Neighbour,
  next?: Neighbour,
): string | undefined {
  let items: Map<string, SourceNode[]> | undefined
  const taken = new Set<SourceNode>()
  const opening = (item: SourceNode) =>
    item.children?.length
      ? matchShape(item) + signature(item.children[0]!)
      : undefined
  const pieces = after.map((child): string | undefined => {
    const end = child.position!.end.offset!
    if (child.type === 'list' || child.type === 'blockquote') {
      const part = retainSplit(
        before,
        child,
        source,
        canonical,
        lineEnding,
        taken,
      )
      // A list's range can take in the blank line its container gave it,
      // which the part, ending at its last child, does not hold.
      if (part)
        return (
          part.text +
          canonical.slice(child.children!.at(-1)!.position!.end.offset, end)
        )
      // A list joined from originals keeps the items it took from them, under
      // the marker of the first.
      const lists = before.filter(
        (node) => node.type === 'list' && node.ordered === child.ordered,
      )
      return child.type === 'list' && lists.length
        ? retainParts(
            authoredMarker(lists[0]!, source),
            lists.flatMap((list) => list.children ?? []),
            child.children!,
            source,
            canonical,
            child.position!.start.offset!,
            end,
            lineEnding,
          )
        : undefined
    }
    if (child.type !== 'listItem') return undefined
    if (!items) {
      items = new Map()
      for (const node of before) {
        const key = node.type === 'listItem' ? opening(node) : undefined
        if (!key) continue
        const same = items.get(key)
        if (same) same.push(node)
        else items.set(key, [node])
      }
    }
    const original = items.get(opening(child) ?? '')?.shift()
    const text = original
      ? retainSource(original, child, source, canonical, lineEnding)
      : child.children?.some(
            (node) => node.type === 'list' || node.type === 'blockquote',
          )
        ? retainParts(
            undefined,
            before.flatMap((node) =>
              node.type === 'listItem' ? (node.children ?? []) : [],
            ),
            child.children,
            source,
            canonical,
            child.position!.start.offset!,
            end,
            lineEnding,
          )
        : undefined
    return text !== undefined && marker ? relabel(text, [0], marker) : text
  })
  if (pieces.every((piece) => piece === undefined)) return undefined
  let text = '',
    at = from
  after.forEach((child, index) => {
    const childStart = child.position!.start.offset!
    const childEnd = child.position!.end.offset!
    const following = index === after.length - 1 ? next : undefined
    let piece = pieces[index]
    // A list beside another with its marker would join it.
    const own = piece && markerAt(piece, 0)?.marker
    if (
      child.type === 'list' &&
      [previous, following].some(
        (neighbour) =>
          neighbour?.ordered === child.ordered && neighbour?.marker === own,
      )
    )
      piece = undefined
    piece ??= canonicalSlice(
      marker,
      [child],
      canonical,
      childStart,
      childEnd,
      previous,
      following,
    )
    previous =
      child.type === 'list'
        ? {
            ordered: child.ordered,
            marker:
              markerAt(piece, /^[ \t]*/.exec(piece)![0].length)?.marker ?? '',
          }
        : undefined
    text += canonical.slice(at, childStart) + piece
    at = childEnd
  })
  return text + canonical.slice(at, to)
}

// The text Markdown inline source reads as, with the source offset of each of
// its characters; undefined where it holds more than escapes and entities, or
// line endings when `lines` is set. A line ending reads as LF without the
// spaces and tabs before it or the quote markers and indentation after it,
// which paragraph text leaves out; the offset before it is where those spaces
// start, so text typed at the end of a line goes before them.
export function decodedOffsets(
  raw: string,
  lines = false,
): { decoded: string; offsets: number[] } | undefined {
  const offsets = [0]
  let decoded = ''
  for (let index = 0; index < raw.length;) {
    const rest = raw.slice(index)
    // Only a run of spaces and tabs from its start can lead to a line
    // ending, which keeps a long run linear.
    const line =
      /[ \t]/.test(raw[index - 1] ?? '') && /[ \t]/.test(raw[index]!)
        ? undefined
        : /^[ \t]*(?:\r\n?|\n)(?:[ \t]*>)*[ \t]*/.exec(rest)?.[0]
    const token =
      line ??
      /^\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.exec(rest)?.[0] ??
      /^&(?:#[xX][\da-fA-F]+|#\d+|[A-Za-z][A-Za-z\d]+);/.exec(rest)?.[0]
    let value = raw[index]!
    if (line) {
      if (!lines) return undefined
      value = '\n'
    } else if (token?.startsWith('\\')) value = token[1]!
    else if (token) {
      const element = document.createElement('textarea')
      element.innerHTML = token
      value = element.value
    }
    index += token?.length ?? 1
    decoded += value
    for (let part = 0; part < value.length; part++) offsets.push(index)
  }
  return { decoded, offsets }
}

const lf = (text: string) => text.replace(/\r\n?/g, '\n')

// GFM finds addresses after punctuation in a pass after parsing, which gives
// the address and the text split around it no position. Each such run of
// children is found in the source between its located neighbours.
function locateChildren(node: SourceNode, text: string): void {
  const children = node.children
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (!children || start == null || end == null) return
  for (let index = 0; index < children.length;) {
    if (children[index]!.position?.start.offset != null) {
      index++
      continue
    }
    let last = index
    while (
      last < children.length &&
      children[last]!.position?.start.offset == null
    )
      last++
    const from = children[index - 1]?.position?.end.offset ?? start
    const to = children[last]?.position?.start.offset ?? end
    const run = children.slice(index, last)
    const values = run.map((child) => lf(inlineText(child)))
    const read = decodedOffsets(text.slice(from, to), true)
    const at = read?.decoded.indexOf(values.join(''))
    if (
      read &&
      at != null &&
      at >= 0 &&
      run.every((child) => child.type === 'text' || child.type === 'link')
    ) {
      let offset = at
      run.forEach((child, part) => {
        const childStart = from + read.offsets[offset]!
        offset += values[part]!.length
        const childEnd = from + read.offsets[offset]!
        child.position = {
          start: { offset: childStart },
          end: { offset: childEnd },
        } as SourceNode['position']
        child.children?.forEach((inner) => {
          inner.position = child.position
        })
      })
    }
    index = last
  }
}

// The text a run of text, breaks and links written bare or in angle brackets reads
// as, with the offset in `text` of each character and the range of each
// link, or undefined for any other run.
function runOffsets(
  nodes: readonly SourceNode[],
  text: string,
  from: number,
  to: number,
):
  | { decoded: string; offsets: number[]; links: Array<[number, number]> }
  | undefined {
  let decoded = ''
  const offsets = [from]
  const links: Array<[number, number]> = []
  let at = from
  let afterBreak = false
  for (const node of nodes) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start == null || end == null) return undefined
    // Container indentation belongs to the break, before the following text.
    if (afterBreak && start >= at && /^[ \t>]*$/.test(text.slice(at, start))) {
      at = start
      offsets[offsets.length - 1] = start
    }
    if (start !== at) return undefined
    const raw = text.slice(start, end)
    if (node.type === 'link') {
      const label = inlineText(node)
      const angle = raw === `<${label}>`
      if (raw !== label && !angle) return undefined
      links.push([decoded.length, decoded.length + label.length])
      decoded += label
      // An edit widens to whole links, so only their ends are used.
      for (let index = 1; index <= label.length; index++)
        offsets.push(
          index === label.length ? end : start + index + Number(angle),
        )
    } else if (node.type === 'text') {
      const read = decodedOffsets(raw, true)
      if (!read || read.decoded !== lf(node.value ?? '')) return undefined
      decoded += read.decoded
      offsets.push(...read.offsets.slice(1).map((offset) => start + offset))
    } else if (node.type === 'break') {
      decoded += '\n'
      offsets.push(end)
    } else return undefined
    afterBreak = node.type === 'break'
    at = end
  }
  return at === to ? { decoded, offsets, links } : undefined
}

// A run of text, breaks and addresses keeps its source outside the edit.
// The edit, widened to the addresses it touches before or after, is written
// as the canonical writer writes it, since
// escapes kept beside a new address could stop it reading as one.
function retainRun(
  before: readonly SourceNode[],
  after: readonly SourceNode[],
  source: string,
  canonical: string,
  [from, to]: [number, number],
  [newFrom, newTo]: [number, number],
): string | undefined {
  const old = runOffsets(before, source, from, to)
  const now = runOffsets(after, canonical, newFrom, newTo)
  if (!old || !now) return undefined
  const a = old.decoded
  const b = now.decoded
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++
  for (let widened = true; widened;) {
    widened = false
    for (const [links, length] of [
      [old.links, a.length],
      [now.links, b.length],
    ] as const)
      for (const [start, end] of links)
        if (start <= length - suffix && end >= prefix) {
          if (start < prefix) {
            prefix = start
            widened = true
          }
          if (length - end < suffix) {
            suffix = length - end
            widened = true
          }
        }
  }
  return (
    source.slice(from, old.offsets[prefix]) +
    canonical.slice(now.offsets[prefix], now.offsets[b.length - suffix]) +
    source.slice(old.offsets[a.length - suffix], to)
  )
}

function retainText(
  raw: string,
  before: string,
  after: string,
  inTable = false,
  // The canonical text, used for text inserted against a link, and whether a
  // link sits before and after this text.
  written?: string,
  beside: readonly [boolean, boolean] = [false, false],
): string {
  before = lf(before)
  after = lf(after)
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
  const read = decodedOffsets(raw, true)
  if (read?.decoded !== before) return after
  const { offsets } = read
  // Text written against a link is written as the canonical writer writes
  // it, which knows what a bare address would run into.
  if (
    written !== undefined &&
    ((beside[0] && prefix === 0) || (beside[1] && suffix === 0))
  ) {
    const writtenOffsets = decodedOffsets(written)
    if (writtenOffsets && writtenOffsets.decoded === after)
      return (
        raw.slice(0, offsets[prefix]) +
        written.slice(
          writtenOffsets.offsets[prefix],
          writtenOffsets.offsets[after.length - suffix],
        ) +
        raw.slice(offsets[before.length - suffix])
      )
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

function retainBoundaryText(
  raw: string,
  canonical: string,
  afterBreak = false,
): string {
  // A new line can turn unchanged punctuation into a block opener. Take its
  // opening escapes from the writer, retaining the authored text after them.
  if (afterBreak) {
    const opening = /^(?:\d+)?(?:\\.)+/.exec(canonical)?.[0]
    const written = opening ? decodedOffsets(opening) : undefined
    const original = written ? decodedOffsets(raw, true) : undefined
    if (written && original?.decoded.startsWith(written.decoded))
      raw = opening + raw.slice(original.offsets[written.decoded.length])
  }
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
  // A callout header and its first body line share a Markdown text node.
  // Check each line after its quote markers, so a newly exposed body space
  // gets the same encoding as a space at the start of a paragraph.
  if (raw.includes('\n')) {
    const lines = raw.split(/(\r?\n)/)
    const written = canonical.split(/\r?\n/)
    if (lines.length === written.length * 2 - 1)
      return lines
        .map((line, index) => {
          if (index % 2) return line
          const canonicalLine = written[index / 2]!
          const gutter = (value: string) =>
            /^(?:[ \t]*>)*/.exec(value)?.[0] ?? ''
          const prefix = gutter(line)
          const canonicalPrefix = gutter(canonicalLine)
          if (
            prefix.replace(/[ \t]/g, '') !==
            canonicalPrefix.replace(/[ \t]/g, '')
          )
            return line
          const canonicalBody = canonicalLine.slice(canonicalPrefix.length)
          return (
            prefix +
            retainBoundaryWhitespace(line.slice(prefix.length), canonicalBody)
          )
        })
        .join('')
  }
  const rawStart = new RegExp(`^${token}+`).exec(raw)?.[0]
  const encodedStart = new RegExp(`^${token}+`).exec(canonical)?.[0]
  if (rawStart && encodedStart?.includes('&')) {
    // Only the tail from the first reference is content. The whitespace
    // before it can be container indentation, whose width differs in the
    // authored and canonical forms. Keep that prefix and entity spelling.
    const content = decoded(encodedStart.slice(encodedStart.indexOf('&')))
    const parts = rawStart.match(new RegExp(token, 'g'))!
    const from = parts.length - content.length
    if (from >= 0 && decoded(parts.slice(from).join('')) === content)
      raw =
        parts
          .map((part, index) => (index < from ? part : encode(part)))
          .join('') + raw.slice(rawStart.length)
  }
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

// The pipes GFM splits a row at; an escaped pipe does not split it.
function rowPipes(row: string): {
  opening: boolean
  closing: number | undefined
  cells: number
} {
  const pipes: number[] = []
  for (let index = 0; index < row.length; index++)
    if (row[index] === '\\' && /[\\|]/.test(row[index + 1] ?? '')) index++
    else if (row[index] === '|') pipes.push(index)
  const opening = pipes[0] === row.search(/\S/)
  const last = row.trimEnd().length - 1
  const closing =
    pipes.at(-1) === last && (!opening || pipes.length > 1) ? last : undefined
  return {
    opening,
    closing,
    cells: pipes.length + 1 - Number(opening) - Number(closing != null),
  }
}

// A source row may stop before the header's last cell; the editor holds the
// rest as empty cells, which stay unwritten until one of them gains content.
// Then the new cells follow the row's own source, before its closing pipe.
function retainShortRow(
  before: SourceNode,
  after: SourceNode,
  retain: (row: SourceNode) => string,
  source: string,
  canonical: string,
): string {
  const count = before.children!.length
  const row = retain({ ...after, children: after.children!.slice(0, count) })
  let filled = after.children!.length
  while (filled > count && !after.children![filled - 1]!.children?.length)
    filled--
  if (filled === count) return row
  const from = after.children![count]!.position?.start.offset
  const to = after.children![filled - 1]!.position?.end.offset
  const start = before.position?.start.offset
  const end = before.position?.end.offset
  if (from == null || to == null || start == null || end == null)
    throw new PreservationError('A source token has no location')
  const kept = rowPipes(row)
  let output = (
    kept.closing == null ? row : row.slice(0, kept.closing)
  ).trimEnd()
  // Without an opening pipe, an empty first cell would not be read at all.
  if (!kept.opening && !after.children![0]!.children?.length)
    output = `|${output ? ' ' : ''}${output.trimStart()}`
  for (let cell = kept.cells; cell < count; cell++) output += ' |'
  // A cell that matches one of the row's own, such as one moved there, keeps
  // that cell's authored text.
  const contentOf = (cell: SourceNode) => [
    cell.children![0]!.position!.start.offset!,
    cell.children!.at(-1)!.position!.end.offset!,
  ]
  const added = after
    .children!.slice(count, filled)
    .map((cell) => {
      const text = canonical.slice(
        cell.position!.start.offset!,
        cell.position!.end.offset!,
      )
      const original = cell.children?.length
        ? before.children!.find(
            (candidate) =>
              candidate.children?.length &&
              signature(candidate) === signature(cell),
          )
        : undefined
      if (!original) return text
      const [cellFrom, cellTo] = contentOf(cell)
      const [sourceFrom, sourceTo] = contentOf(original)
      const offset = cell.position!.start.offset!
      return (
        text.slice(0, cellFrom! - offset) +
        source.slice(sourceFrom, sourceTo) +
        text.slice(cellTo! - offset)
      )
    })
    .join('')
  const addedPipes = rowPipes(added)
  const closing =
    kept.closing != null || rowPipes(source.slice(start, end)).closing != null
  return (
    `${output} ` +
    (addedPipes.closing == null
      ? added
      : added.slice(0, addedPipes.closing)
    ).trimEnd() +
    (closing ? ' |' : '')
  )
}

// A `<br />` line, read as an HTML block or as a paragraph holding only it.
function spacer(node: SourceNode | undefined): boolean {
  const html = node?.type === 'paragraph' ? node.children?.[0] : node
  return (
    (node?.type !== 'paragraph' || node.children?.length === 1) &&
    html?.type === 'html' &&
    lineBreakHTML(String(html.value))
  )
}

// Nodes whose children are inline content.
const inlineParents = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'emphasis',
  'strong',
  'delete',
  'highlight',
  'link',
])

// HTML stops an address at its `<`, and a line break at the end of the line.
const inlineText = (node: SourceNode): string =>
  node.type === 'html'
    ? '<'
    : node.type === 'break'
      ? '\n'
      : (node.value ?? '') + (node.children?.map(inlineText).join('') ?? '')

// The text an address could run into from one side: up to the first space,
// and whether the space is the last text of the block.
function edge(text: string): string {
  const run = /^\S*/.exec(text)![0]
  const rest = text.slice(run.length)
  return `${run}|${rest === '' ? 'end' : /^\s+$/.test(rest) ? 'space' : rest[0]}`
}

const reversed = (text: string) => [...text].reverse().join('')

// A bare address reads differently beside other text: a character written
// against it can join it, so it is written bare, in angle brackets or as a
// link depending on its neighbours; and whether formatting delimiters open
// or close depends on the characters beside them. An address whose own text
// changed, or an address or formatting that an edit reaches with no space
// between, takes the form the edited document writes. Every other node keeps
// its source.
function rewrittenAddress(
  parent: string,
  before: readonly SourceNode[],
  beforeIndex: number,
  after: readonly SourceNode[],
  afterIndex: number,
  source: string,
  canonical: string,
): boolean {
  const old = before[beforeIndex]
  const now = after[afterIndex]
  if (!old || !now || !inlineParents.has(parent)) return false
  const links = (node: SourceNode, found: SourceNode[] = []) => {
    if (node.type === 'link') found.push(node)
    node.children?.forEach((child) => links(child, found))
    return found
  }
  const oldLinks = links(old)
  const address = oldLinks.some((link) => linkForm(link, source) !== null)
  if (!address && !formatting.has(old.type)) return false
  if (now.position?.start.offset == null) return false
  // The text beside the node, read away from it only as far as `edge` needs:
  // past the first space to the next other character.
  const beside = (nodes: readonly SourceNode[], from: number, step: 1 | -1) => {
    let text = ''
    for (let index = from; index >= 0 && index < nodes.length; index += step) {
      const part = inlineText(nodes[index]!)
      text += step > 0 ? part : reversed(part)
      if (/\s\S/.test(text)) break
    }
    return text
  }
  // Formatting whose content changed is compared child by child instead.
  if (old.type !== 'link' && signature(old) !== signature(now)) return false
  const following = [
    beside(before, beforeIndex + 1, 1),
    beside(after, afterIndex + 1, 1),
  ]
  const preceding = [
    beside(before, beforeIndex - 1, -1),
    beside(after, afterIndex - 1, -1),
  ]
  const slice = (node: SourceNode, from: string) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    return start == null || end == null ? undefined : from.slice(start, end)
  }
  // Delimiters open and close the same beside a space or punctuation, but
  // not always beside other text; where that changed, the formatting takes
  // the form the edited document writes.
  const kind = (text: string) => text === '' || /^[\s\p{P}\p{S}]/u.test(text)
  if (
    formatting.has(old.type) &&
    (kind(following[0]!) !== kind(following[1]!) ||
      kind(preceding[0]!) !== kind(preceding[1]!)) &&
    slice(old, source) !== slice(now, canonical)
  )
    return true
  if (
    !address ||
    (signature(old) === signature(now) &&
      edge(following[0]!) === edge(following[1]!) &&
      edge(preceding[0]!) === edge(preceding[1]!))
  )
    return false
  const nowLinks = links(now)
  if (oldLinks.length !== nowLinks.length) return true
  return oldLinks.some((link, index) => {
    if (linkForm(link, source) === null) return false
    const written = slice(link, source)
    return (
      written === undefined || written !== slice(nowLinks[index]!, canonical)
    )
  })
}

// Ordered lists already given their new start, which are not renumbered again.
const numbered = new WeakSet<SourceNode>()

// Canonical source nodes that read back as literal Markdown. The editor holds
// a literal block's source as its text, so an edit to it is written as it is;
// retaining it as Markdown would escape what was typed.
const literals = new WeakSet<SourceNode>()

// The canonical Markdown of each loaded block the editor holds as literal
// Markdown, by its source node. It differs from the source where the editor
// does not keep authored spelling, such as quote markers inside a comment or
// the indentation of a block inside another.
const literalForms = new WeakMap<SourceNode, string>()

// One line of a literal block: its authored spelling, given its canonical
// spelling `before` and the edited canonical line `after`. The authored text
// is kept on the side of the edit where it reads as `before` does.
function retainLine(authored: string, before: string, after: string): string {
  if (before === after) return authored
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
  if (authored.endsWith(before.slice(prefix)))
    return (
      authored.slice(0, authored.length - before.length + prefix) +
      after.slice(prefix)
    )
  if (authored.startsWith(before.slice(0, before.length - suffix)))
    return (
      after.slice(0, after.length - suffix) +
      authored.slice(before.length - suffix)
    )
  return after
}

// The authored source of a literal block with the edit that turned its
// canonical Markdown `before` into `after`, or into the authored source itself
// when its canonical Markdown is not known. The canonical Markdown has a line
// for each authored line, so each line the edit left alone keeps its authored
// spelling and line ending, and an edited line keeps them where it can. Where
// the edit adds or removes lines, those it reached are written as `after` has
// them.
function retainLiteral(
  raw: string,
  before: string | undefined,
  after: string,
): string {
  const parts = raw.split(/(\r\n|\r|\n)/)
  const authored = parts.filter((_, index) => index % 2 === 0)
  const endings = parts.filter((_, index) => index % 2 === 1)
  const old = (before ?? lf(raw)).split('\n')
  const now = after.split('\n')
  if (authored.length !== old.length) return after
  let start = 0
  while (start < old.length && start < now.length && old[start] === now[start])
    start++
  let end = 0
  while (
    end < old.length - start &&
    end < now.length - start &&
    old[old.length - 1 - end] === now[now.length - 1 - end]
  )
    end++
  const reached = now.slice(start, now.length - end)
  const lines: string[] = []
  for (let index = 0; index < start; index++)
    lines.push(authored[index]! + (endings[index] ?? ''))
  if (reached.length === old.length - start - end)
    reached.forEach((line, index) =>
      lines.push(
        retainLine(authored[start + index]!, old[start + index]!, line) +
          (endings[start + index] ?? ''),
      ),
    )
  else if (reached.length)
    lines.push(
      reached.join('\n') +
        (end ? (endings[authored.length - end - 1] ?? '\n') : ''),
    )
  // Removed lines at the end leave no line ending after the last one kept.
  else if (!end && start) lines[start - 1] = authored[start - 1]!
  for (let index = authored.length - end; index < authored.length; index++)
    lines.push(authored[index]! + (endings[index] ?? ''))
  return lines.join('')
}

const holdsLiteral = (node: SourceNode): boolean =>
  (node.children ?? []).some(
    (child) => literals.has(child) || holdsLiteral(child),
  )

const sourceRange = (node: SourceNode) =>
  `${node.position?.start.offset}:${node.position?.end.offset}`

// Marks the nodes of `raw` that `transformed` keeps as literal blocks, and
// those at the ranges of `blocks`, which the editor holds as literal blocks.
function markLiterals(
  raw: Root,
  transformed: Root,
  blocks: readonly SourceNode[] = [],
): void {
  const ranges = new Set(blocks.map(sourceRange))
  const find = (node: SourceNode) => {
    if (node.type === 'inkkitLiteral') ranges.add(sourceRange(node))
    else node.children?.forEach(find)
  }
  find(transformed as unknown as SourceNode)
  if (!ranges.size) return
  const mark = (node: SourceNode) => {
    if (node.position?.start.offset != null && ranges.has(sourceRange(node)))
      literals.add(node)
    else node.children?.forEach(mark)
  }
  ;(raw.children as unknown as SourceNode[]).forEach(mark)
}

// Patch changed leaves so an adjacent edit retains authored delimiters and labels.
function retainSource(
  before: SourceNode,
  after: SourceNode,
  source: string,
  canonical: string,
  lineEnding: string,
  inTable = false,
  // The header's cell count, for the rows of a table.
  width?: number,
  // Whether a link sits before and after this node.
  beside: readonly [boolean, boolean] = [false, false],
  // Children of originals an edit joined into this node.
  joined: readonly SourceNode[] = [],
  // Children that a block move carried to other places, by where the parent
  // starts in `source`: the original index of each moved child, by its
  // index in `after`.
  reorder?: Reorder,
): string {
  if (literals.has(after))
    return withEnding(
      retainLiteral(
        source.slice(
          before.position!.start.offset!,
          before.position!.end.offset!,
        ),
        literalForms.get(before),
        lf(
          canonical.slice(
            after.position!.start.offset!,
            after.position!.end.offset!,
          ),
        ),
      ),
      lineEnding,
    )
  if (
    before.type === 'list' &&
    after.type === 'list' &&
    before.ordered &&
    after.ordered &&
    !numbered.has(before) &&
    before.position?.start.offset != null
  ) {
    // An ordered list can come to start from another number, such as the
    // part after a split, or lose the items before the first it keeps. Its
    // items keep their source, and those written in sequence stay in sequence
    // from the new start, at their authored width.
    const own = { ...before, start: after.start }
    numbered.add(own)
    const text = retainSource(
      own,
      after,
      source,
      canonical,
      lineEnding,
      inTable,
      width,
      beside,
      joined,
      reorder,
    )
    const at = before.position.start.offset
    const prefix = source
      .slice(source.lastIndexOf('\n', at - 1) + 1, at)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let count = 0,
      previous = 0,
      number = 0
    const renumbered = text.replace(
      new RegExp(`(^|\\n${prefix})(\\d{1,9})(?=[.)])`, 'g'),
      (_, line: string, digits: string) => {
        const authored = Number(digits)
        number =
          count === 0
            ? Number(after.start)
            : authored === previous + 1
              ? number + 1
              : authored
        previous = authored
        count++
        return (
          line +
          (digits.startsWith('0')
            ? String(number).padStart(digits.length, '0')
            : String(number))
        )
      },
    )
    if (count === after.children?.length) return renumbered
    if (before.start === after.start) return text
  }
  if (
    before.type === 'listItem' &&
    after.type === 'listItem' &&
    typeof before.checked === 'boolean' &&
    typeof after.checked === 'boolean' &&
    before.checked !== after.checked
  ) {
    // A ticked or cleared task keeps its source; only its box changes.
    const text = retainSource(
      { ...before, checked: after.checked },
      after,
      source,
      canonical,
      lineEnding,
      inTable,
      width,
      beside,
      joined,
      reorder,
    )
    const box = /^((?:[-*+]|\d{1,9}[.)])[ \t]+\[)[ xX](\])/.exec(text)
    if (box)
      return (
        box[1] + (after.checked ? 'x' : ' ') + text.slice(box[1]!.length + 1)
      )
  }
  if (inlineParents.has(before.type)) {
    locateChildren(before, source)
    locateChildren(after, canonical)
  }
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
    if ((before.value ?? '') === (after.value ?? '')) return raw
    const opening = /^([ \t>]*)(`{3,}|~{3,})([^\r\n]*)(\r?\n)/.exec(raw)
    if (opening) {
      const lines = raw.slice(opening[0].length).split(/\r?\n/)
      const closing = /^([ \t>]*)(`{3,}|~{3,})([ \t]*)$/.exec(
        lines.at(-1) ?? '',
      )
      const originalLine =
        (before.value ?? '').replace(/\r\n?/g, '\n').split('\n')[0] ?? ''
      // A fence whose code is empty or starts with a blank line has no line
      // to take the indent from but its closing one.
      const first = originalLine ? lines[0] : undefined
      const gutter =
        first === undefined
          ? (closing?.[1] ?? opening[1]!)
          : first.endsWith(originalLine)
            ? first.slice(0, first.length - originalLine.length)
            : opening[1]!
      // A code block without code is written as a fence with no line inside.
      const body = after.value
        ? after.value.replace(/\r\n?/g, '\n').split('\n')
        : []
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
        body.map((line) => lineEnding + gutter + line).join('') +
        (closing || body.length ? '' : opening[4]) +
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
    const parts = (text: string) =>
      /^(\[[\s\S]*?\]:[ \t]*)(<(?:\\[\s\S]|[^\\<>\n])*>|[^ \t\r\n]+)([\s\S]*)$/.exec(
        text,
      )
    const authored = parts(raw)
    // The canonical writer knows when a destination needs angle brackets, such
    // as for a space, and how to escape it.
    const written = parts(canonical.slice(newStart, newEnd))?.[2]
    if (authored && written) {
      const angle = authored[2]!.startsWith('<') && !written.startsWith('<')
      return (
        authored[1] +
        (angle
          ? `<${written.replace(/(\\[\s\S])|[<>]|\\$/g, (match, escape) => escape ?? `\\${match}`)}>`
          : written) +
        authored[3]
      )
    }
  }
  if (
    before.type === 'tableRow' &&
    after.type === 'tableRow' &&
    before.children &&
    after.children &&
    width != null &&
    before.children.length < width &&
    after.children.length === width
  )
    return retainShortRow(
      before,
      after,
      (row) =>
        retainSource(before, row, source, canonical, lineEnding, inTable),
      source,
      canonical,
    )
  if (
    before.type === 'tableCell' &&
    after.type === 'tableCell' &&
    !before.children?.length &&
    after.children?.length
  ) {
    // An empty cell's range is only its pipe and padding, so its new content
    // goes inside them rather than through the whole-range boundary check.
    const from = after.children[0]!.position?.start.offset
    const to = after.children.at(-1)!.position?.end.offset
    if (from == null || to == null)
      throw new PreservationError('A source token has no location')
    const pipes = rowPipes(raw)
    return `${pipes.opening ? '| ' : ''}${canonical.slice(from, to)} ${pipes.closing != null ? '|' : ''}`
  }
  if (
    before.type === 'listItem' &&
    after.type === 'listItem' &&
    before.children &&
    after.children &&
    before.children.length === after.children.length + 1 &&
    after.children.length > 0 &&
    (spacer(before.children[0]) || before.children[0]!.type === 'paragraph') &&
    after.children[0]?.type !== 'paragraph' &&
    !spacer(after.children[0])
  ) {
    // The item now opens with an empty line before a block, which is written
    // as no line. The blocks after it keep their authored source.
    const retained = retainSource(
      { ...before, children: before.children.slice(1) },
      { ...after, spread: before.spread },
      source,
      canonical,
      lineEnding,
      inTable,
    )
    const first = before.children[0]!
    if (spacer(first)) return retained
    // An emptied first line is kept as the `<br />` line it reads back as.
    const from = first.position!.start.offset! - start
    const to = first.position!.end.offset! - start
    return retained.startsWith(
      source.slice(start, before.children[1]!.position!.start.offset!),
    )
      ? retained.slice(0, from) + '<br />' + retained.slice(to)
      : retained
  }
  if (before.type === 'text' && after.type === 'text')
    return retainBoundaryText(
      withEnding(
        retainText(
          raw,
          before.value!,
          after.value!,
          inTable,
          canonical.slice(newStart, newEnd),
          beside,
        ),
        lineEnding,
      ),
      canonical.slice(newStart, newEnd),
    )
  // A literal block's tree does not show all of its text, such as spaces
  // that open a line, so a block holding one is compared line by line.
  if (
    signature(before) === signature(after) &&
    ownShape(before) === ownShape(after) &&
    !holdsLiteral(after) &&
    // Children a move carried can read the same and still be reordered.
    !reorderedWithin(before, reorder)
  )
    return raw
  const marker = sameList(before, after)
    ? authoredMarker(before, source)
    : undefined
  // GFM finds addresses after punctuation in a pass that gives the address
  // and the text around it no position; such children are written afresh.
  const located = (nodes: SourceNode[]) =>
    nodes.every((node) => node.position?.start.offset != null)
  if (
    before.type === after.type &&
    ownShape(before) === ownShape(after) &&
    before.children &&
    after.children &&
    before.children.length === after.children.length &&
    located(before.children) &&
    located(after.children)
  ) {
    let output = '',
      at = start
    let previous: Neighbour | undefined
    const same = (candidate: SourceNode, incoming: SourceNode) =>
      signature(candidate) === signature(incoming) &&
      ownShape(candidate) === ownShape(incoming)
    const reorderable = before.type === 'table' || before.type === 'tableRow'
    const moves = reorder?.get(parentKey(before))
    // Equal rows or cells can differ in spelling, so each one that stayed in
    // place keeps its own source before any moved one is matched.
    const retained = new Set<number>(
      reorderable
        ? before.children.flatMap((child, index) =>
            same(child, after.children![index]!) ? [index] : [],
          )
        : [],
    )
    before.children.forEach((child, index) => {
      const incoming = after.children![index]!
      const carried = moves?.get(index)
      const movedIndex = !reorderable
        ? // A child the move carried here keeps its own source when it reads
          // as the same child.
          carried !== undefined &&
          before.children![carried] !== undefined &&
          same(before.children![carried]!, incoming)
          ? carried
          : -1
        : same(child, incoming)
          ? index
          : before.children!.findIndex(
              (candidate, candidateIndex) =>
                !retained.has(candidateIndex) && same(candidate, incoming),
            )
      const original = movedIndex < 0 ? child : before.children![movedIndex]!
      if (movedIndex >= 0) retained.add(movedIndex)
      const childStart = child.position?.start.offset,
        childEnd = child.position?.end.offset
      if (childStart == null || childEnd == null)
        throw new PreservationError('A source token has no location')
      let retainedSource = rewrittenAddress(
        before.type,
        before.children!,
        movedIndex < 0 ? index : movedIndex,
        after.children!,
        index,
        source,
        canonical,
      )
        ? canonical.slice(
            incoming.position!.start.offset!,
            incoming.position!.end.offset!,
          )
        : incoming.type === 'list' && !sameList(original, incoming)
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
              before.type === 'table'
                ? before.children![0]?.children?.length
                : undefined,
              [
                after.children![index - 1]?.type === 'link',
                after.children![index + 1]?.type === 'link',
              ],
              [],
              reorder,
            )
      if (
        before.type === 'tableRow' &&
        movedIndex >= 0 &&
        movedIndex !== index
      ) {
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
      if (
        !reorderable &&
        before.ordered &&
        movedIndex >= 0 &&
        movedIndex !== index
      )
        retainedSource = renumberItem(retainedSource, source, original, child)
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
    if (
      prefix &&
      rewrittenAddress(
        before.type,
        before.children,
        prefix - 1,
        after.children,
        prefix - 1,
        source,
        canonical,
      )
    )
      prefix--
    if (
      suffix &&
      rewrittenAddress(
        before.type,
        before.children,
        before.children.length - suffix,
        after.children,
        after.children.length - suffix,
        source,
        canonical,
      )
    )
      suffix--
    // Keep both authored formatting delimiters when inserting/removing inline
    // children. A cell's pipe and padding also sit outside its content.
    const wrapped =
      (before.type === 'tableCell' || formatting.has(before.type)) &&
      before.children.length > 0 &&
      after.children.length > 0
    const first = wrapped ? before.children[0]!.position?.start.offset : start
    const last = wrapped ? before.children.at(-1)!.position?.end.offset : end
    const newFirst = wrapped
      ? after.children[0]!.position?.start.offset
      : newStart
    const newLast = wrapped
      ? after.children.at(-1)!.position?.end.offset
      : newEnd
    // In a quote, a list's range takes in the `>` of the blank lines after
    // it, and so does the range of an item that ends with a sublist. They
    // separate the list from what follows, so the kept part ends where the
    // innermost last item does and the separator comes from the canonical text.
    const ending = (node: SourceNode): SourceNode => {
      const last = node.children?.at(-1)
      return last &&
        (node.type === 'list' ||
          (node.type === 'listItem' && last.type === 'list'))
        ? ending(last)
        : node
    }
    // The delimiter row follows the header and belongs to no row. Alignment
    // is part of the table's own shape, so it is unchanged here, and a kept
    // header keeps the delimiter row as written.
    const header = (text: string, offset: number | undefined) =>
      before.type === 'table' && prefix === 1 && offset != null
        ? delimiterRowEnd(text, offset)
        : offset
    const from = prefix
      ? header(
          source,
          ending(before.children[prefix - 1]!).position?.end.offset,
        )
      : first
    const to = suffix
      ? before.children[before.children.length - suffix]!.position?.start.offset
      : last
    const newFrom = prefix
      ? header(
          canonical,
          ending(after.children[prefix - 1]!).position?.end.offset,
        )
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
    ) {
      const changed = before.children.slice(
        prefix,
        before.children.length - suffix,
      )
      const changes = after.children.slice(
        prefix,
        after.children.length - suffix,
      )
      const previous = authoredNeighbour(
        before.children[prefix - 1],
        after.children[prefix - 1],
        source,
      )
      const next = authoredNeighbour(
        before.children[before.children.length - suffix],
        after.children[after.children.length - suffix],
        source,
      )
      return (
        source.slice(start, first) +
        retainBoundaryText(
          source.slice(first, from) +
            withEnding(
              (inlineParents.has(before.type)
                ? retainRun(
                    changed,
                    changes,
                    source,
                    canonical,
                    [from, to],
                    [newFrom, newTo],
                  )
                : retainParts(
                    marker,
                    [...changed, ...joined],
                    changes,
                    source,
                    canonical,
                    newFrom,
                    newTo,
                    lineEnding,
                    previous,
                    next,
                  )) ??
                canonicalSlice(
                  marker,
                  changes,
                  canonical,
                  newFrom,
                  newTo,
                  previous,
                  next,
                ),
              lineEnding,
            ) +
            // An unchanged suffix can now follow a break. Keep its spelling,
            // but retain the escapes required at the new line boundary.
            (inlineParents.has(before.type)
              ? retainBoundaryText(
                  source.slice(to, last),
                  canonical.slice(newTo, newLast),
                  changes.at(-1)?.type === 'break',
                )
              : source.slice(to, last)),
          canonical.slice(newFirst, newLast),
        ) +
        source.slice(last, end)
      )
    }
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

/**
 * Characters preservation has parsed and written. A test reads it to tell an
 * edit validated where it happened from one that read the whole document.
 */
export const preservationWork = { characters: 0 }

function parseDoc(ctx: Ctx, text: string): ProseNode {
  preservationWork.characters += text.length
  return ctx.get(parserCtx)(text)
}

function parseTree(ctx: Ctx, text: string): Root {
  preservationWork.characters += text.length
  return ctx.get(remarkCtx).parse(text) as Root
}

function write(ctx: Ctx, doc: ProseNode): string {
  const text = serialize(ctx, doc)
  preservationWork.characters += text.length
  return text
}

/**
 * When enabled, every save that did not take the whole-document path is saved
 * through it as well, and each difference in bytes or refusal is recorded.
 * The test suite enables it, so every test also compares the two paths.
 */
export const crossCheck = {
  enabled: false,
  compared: 0,
  differences: [] as string[],
}

// Whether a source node is or holds a link or footnote definition.
function definesSource(node: SourceNode): boolean {
  return (
    node.type === 'definition' ||
    node.type === 'footnoteDefinition' ||
    (node.children ?? []).some(definesSource)
  )
}

function blockForm(ctx: Ctx, node: ProseNode): string {
  // An empty document is empty Markdown, but an empty block inside a document
  // is authored spacing and must remain a real block when read again.
  if (node.type.name === 'paragraph' && node.content.size === 0) return '<br />'
  const text = form(
    write(ctx, node.type.schema.topNodeType.create(null, [node])),
  )
  // A literal block's text is its source, so a line ending at its end is part
  // of what it holds, though the writer drops it and it cannot be read back.
  // Keeping it in the form shows the edit that added it.
  let endings = ''
  const literal = (child: ProseNode) => {
    if (child.type.name === 'literal_markdown')
      endings += lf(/(?:\r?\n)*$/.exec(child.textContent)![0])
  }
  literal(node)
  node.descendants((child) => {
    literal(child)
    return !child.isTextblock
  })
  return text + endings
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
        'marker',
        'id',
        'label',
        'spread',
        'authoredFence',
        'form',
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

type Kept = 'unchanged' | 'moved' | 'edited' | 'canonical'

// The blocks a block move carried, for one save: the original each moved
// top-level block keeps the source of, by its index, and whether children a
// move carried inside an edited block keep theirs.
interface Carried {
  moved: Map<number, number>
  children: boolean
  // Blocks paired with an original they read the same as, whose children a
  // move carried, so their source can still change.
  within: Set<number>
}

const nothingCarried: Carried = {
  moved: new Map(),
  children: false,
  within: new Set(),
}

interface Pairing {
  positions: Array<number | undefined>
  carried: Carried
}

// Changed blocks between two unchanged ones, by their index in the document.
interface Run {
  previous?: number
  next?: number
}

/** Retains the loaded source of blocks the edit leaves alone. */
export class Preservation {
  /** The document as loaded from `source`. */
  readonly baseline: ProseNode
  private readonly blocks: Block[] = []
  private readonly lineEnding: string
  private readonly originalForms = new Set<string>()
  // The form of each block, in order.
  private readonly blockForms: string[] = []
  private readonly forms = new WeakMap<ProseNode, string>()
  private readonly blockEdits = new WeakMap<
    ProseNode,
    { index: number; text: string }
  >()
  private readonly itemEdits = new WeakMap<
    ProseNode,
    { index: number; item: number; from?: number; text: string }
  >()
  private readonly regionEdits = new WeakMap<
    ProseNode,
    { identity: string; nodes: ProseNode[]; text: string }
  >()
  private readonly definitionNodes = new Map<string, number>()
  // The nodes block moves carried, for the save in progress, and where each
  // baseline block sits in the baseline, by node, made when first needed.
  private moves?: WeakSet<ProseNode>
  private origins?: WeakMap<ProseNode, number[]>
  // The source ranges of literal blocks inside other blocks, and the blocks
  // whose literal blocks have been given their canonical form.
  private readonly nestedLiterals = new Set<string>()
  private readonly literalsRead = new WeakSet<Block>()
  // Undefined when a definition sits inside another block, where appending
  // the top-level ones would not reproduce the document.
  private readonly definitionSources?: Array<{ label: string; text: string }>

  constructor(
    private readonly ctx: Ctx,
    private readonly source: string,
  ) {
    try {
      const parse = (text: string) => parseDoc(ctx, text)
      this.baseline = parse(source)
      this.lineEnding =
        source.includes('\r\n') && !source.replaceAll('\r\n', '').includes('\n')
          ? '\r\n'
          : '\n'
      const processor = ctx.get(remarkCtx)
      const offset = source.startsWith('\uFEFF') ? 1 : 0
      const body = source.slice(offset)
      const rawTree = parseTree(ctx, source)
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
        const own = this.baseline.childCount === tree.children.length
        const parsed = own
          ? this.baseline.type.create(null, [this.baseline.child(index)])
          : parse(text)
        const blockText =
          parsed.childCount === 1
            ? blockForm(ctx, parsed.firstChild!)
            : form(write(ctx, parsed))
        // The editor shows the baseline, so its blocks are these nodes until
        // an edit replaces them, and their forms need not be written again.
        if (own) this.forms.set(this.baseline.child(index), blockText)
        const ast = positionalNode(rawTree, node as unknown as SourceNode)
        if (
          parsed.childCount === 1 &&
          parsed.firstChild!.type.name === 'literal_markdown'
        )
          literalForms.set(ast, blockText)
        this.blocks.push({
          start,
          end: sourceEnd,
          form: blockText,
          ast,
        })
      }
      for (const block of this.blocks) {
        this.originalForms.add(block.form)
        this.blockForms.push(block.form)
      }
      const inside = (node: SourceNode) =>
        node.children?.forEach((child) => {
          if (child.type === 'inkkitLiteral')
            this.nestedLiterals.add(sourceRange(child))
          else inside(child)
        })
      ;(tree.children as unknown as SourceNode[]).forEach(inside)
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
    joined: readonly SourceNode[] = [],
    reorder?: Reorder,
  ): string {
    const offset = this.source.startsWith('\uFEFF') ? 1 : 0
    const start = block.ast.position?.start.offset
    if (start == null)
      throw new PreservationError('A source block has no location')
    this.readNestedLiterals(block)
    return (
      this.source.slice(block.start, start + offset) +
      retainSource(
        block.ast,
        after,
        this.source.slice(offset),
        canonical,
        this.lineEnding,
        false,
        undefined,
        undefined,
        joined,
        reorder,
      )
    )
  }

  // Gives each literal block inside `block` the canonical form it has in the
  // block's own canonical Markdown, found at the same place in its tree.
  private readNestedLiterals(block: Block): void {
    if (!this.nestedLiterals.size || this.literalsRead.has(block)) return
    this.literalsRead.add(block)
    const holds = (node: SourceNode): boolean =>
      (node.children ?? []).some(
        (child) => this.nestedLiterals.has(sourceRange(child)) || holds(child),
      )
    if (!holds(block.ast)) return
    const tree = parseTree(this.ctx, block.form)
    if (tree.children.length !== 1) return
    const pair = (source: SourceNode, written: SourceNode) => {
      if (source.children?.length !== written.children?.length) return
      source.children?.forEach((child, index) => {
        const other = written.children![index]!
        if (other.type !== child.type) return
        if (this.nestedLiterals.has(sourceRange(child)))
          literalForms.set(
            child,
            lf(
              block.form.slice(
                other.position!.start.offset!,
                other.position!.end.offset!,
              ),
            ),
          )
        else pair(child, other)
      })
    }
    pair(block.ast, tree.children[0] as unknown as SourceNode)
  }

  // The original blocks between those paired around a current block, which
  // an edit could have split it from or joined into it.
  private around(positions: Array<number | undefined>, index: number): Block[] {
    let low = index - 1,
      high = index + 1
    while (low >= 0 && positions[low] == null) low--
    while (high < positions.length && positions[high] == null) high++
    const [from, to] = [
      low < 0 ? 0 : positions[low]!,
      high >= positions.length ? this.blocks.length - 1 : positions[high]!,
    ].sort((left, right) => left - right)
    return this.blocks.slice(from, to! + 1)
  }

  // A new list or quote split from one between the blocks paired around it.
  private retainPart(
    positions: Array<number | undefined>,
    index: number,
    after: SourceNode,
    canonical: string,
    taken: Set<SourceNode>,
  ): string | undefined {
    const source = this.source.slice(this.source.startsWith('\uFEFF') ? 1 : 0)
    const part = retainSplit(
      this.around(positions, index).map((block) => block.ast),
      after,
      source,
      canonical,
      this.lineEnding,
      taken,
    )
    if (!part) return undefined
    const indent = source.slice(
      source.lastIndexOf('\n', part.from - 1) + 1,
      part.from,
    )
    return (/^[ \t]*$/.test(indent) ? indent : '') + part.text
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
      const before = node && this.baseline.child(index)
      // A block a move carried from another place is paired with its own
      // original, which only the whole-document path does.
      if (node && node !== before && this.moves?.has(node)) return undefined
      if (
        !node ||
        node === before ||
        (node.eq(before!) && !this.carries(node))
      ) {
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
      nodes = appended ? parseDoc(this.ctx, appended).childCount : 0
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
    const parsed = parseDoc(this.ctx, local.text)
    return parsed.childCount === local.nodes ? parsed.firstChild! : undefined
  }

  // Canonical Markdown for a block and its source tree, read in the same
  // context, so references in it resolve as they do in the document.
  private canonicalTree(
    text: string,
  ): { canonical: string; node: SourceNode } | undefined {
    const local = this.inContext(text)
    if (!local) return undefined
    const tree = parseTree(this.ctx, local.text)
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
          const tree = parseTree(this.ctx, form)
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
          const parsed = parseDoc(this.ctx, text)
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
    // Items a block move carried within this list, and below it.
    const reorder = this.moves ? this.carriedChildren(node, index) : undefined
    const carried = reorder?.get(parentKey(list))
    let output = ''
    let previous = block.start
    for (let at = 0; at < node.childCount; at++) {
      const item = node.child(at)
      const original = before.child(at)
      if (item === original || (item.eq(original) && !this.carries(item)))
        continue
      const moved = carried?.get(at)
      // A carried item keeps its source only where both trees agree on it.
      const from =
        moved !== undefined && list.children[moved] ? moved : undefined
      let retained = this.itemEdits.get(item)
      if (
        retained?.index !== index ||
        retained.item !== at ||
        retained.from !== from
      ) {
        const text =
          from === undefined
            ? this.localItem(
                node,
                item,
                before.child(at),
                list.children[at]!,
                source,
                marker,
                reorder,
              )
            : this.movedItem(
                node,
                item,
                list,
                list.children[from]!,
                list.children[at]!,
                source,
                marker,
              )
        if (text === undefined) return undefined
        retained = { index, item: at, from, text }
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

  // The source of an item a block move carried from `original`'s place to
  // `place`'s, when it reads there as the same item with the same marker and
  // spacing as that place.
  private movedItem(
    node: ProseNode,
    item: ProseNode,
    list: SourceNode,
    original: SourceNode,
    place: SourceNode,
    source: string,
    marker: string | undefined,
  ): string | undefined {
    const start = original.position!.start.offset!
    const end = original.position!.end.offset!
    if (
      !Preservation.plainInline(item) ||
      !this.inContext(source.slice(start, end))
    )
      return undefined
    let text = source.slice(start, end)
    if (list.ordered) text = renumberItem(text, source, original, place)
    if (marker) text = relabel(text, [0], marker)
    return this.readsAsItem(node, item, text, place, source)
  }

  // `text` in place of the item at `ast`, when it starts with the same marker
  // and spacing, which set the column that continuation lines and blocks after
  // the list are read against, and reads alone as `item`.
  private readsAsItem(
    list: ProseNode,
    item: ProseNode,
    text: string,
    ast: SourceNode,
    source: string,
  ): string | undefined {
    const start = ast.position!.start.offset!
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

  private localItem(
    list: ProseNode,
    item: ProseNode,
    before: ProseNode,
    ast: SourceNode,
    source: string,
    marker: string | undefined,
    reorder?: Reorder,
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
        write(
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
      false,
      undefined,
      undefined,
      [],
      reorder,
    )
    if (marker) text = relabel(text, [0], marker)
    return this.readsAsItem(list, item, text, ast, source)
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
      if (kept[index] === 'canonical' || kept[index] === 'moved') return 1
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
    const read = (text: string) =>
      parseTree(this.ctx, text).children as unknown as SourceNode[]
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

  /** `moved` holds the nodes block moves carried. A moved node that is still a
   *  node of the loaded document keeps that node's source where it reads the
   *  same; every other edit is saved without it. */
  serialize(doc: ProseNode, moved?: WeakSet<ProseNode>): string {
    this.moves = moved
    try {
      return this.serializeWith(doc)
    } finally {
      this.moves = undefined
    }
  }

  private serializeWith(doc: ProseNode): string {
    if (this.unchanged(doc)) return this.source
    let local: string | undefined
    try {
      local = this.localEdits(doc)
    } catch (cause) {
      if (cause instanceof PreservationError) throw cause
      throw new PreservationError('Cannot preserve the edited Markdown', {
        cause,
      })
    }
    if (local === undefined)
      try {
        local = this.regions(doc)
      } catch {
        // The whole-document path decides, and refuses if it fails too.
        local = undefined
      }
    return local === undefined
      ? this.wholeDocument(doc)
      : this.checked(doc, local)
  }

  // Equal to the loaded document. The editor shows the baseline's own nodes,
  // and an edit keeps the nodes it does not reach, so most blocks are
  // compared by identity rather than by content.
  private unchanged(doc: ProseNode): boolean {
    if (doc === this.baseline) return true
    if (
      doc.childCount !== this.baseline.childCount ||
      !doc.sameMarkup(this.baseline)
    )
      return false
    for (let index = 0; index < doc.childCount; index++) {
      const node = doc.child(index)
      const before = this.baseline.child(index)
      if (node !== before && (!node.eq(before) || this.carries(node)))
        return false
    }
    return true
  }

  // Whether a move carried `node` or a block inside it, so that a node equal
  // to its original can still be written differently.
  private carries(node: ProseNode): boolean {
    const moves = this.moves
    if (!moves) return false
    let found = moves.has(node)
    node.descendants((child) => {
      found ||= moves.has(child)
      return !found && !child.isTextblock
    })
    return found
  }

  // In cross-check mode, records where the whole-document path would save
  // different bytes or refuse.
  private checked(doc: ProseNode, text: string): string {
    if (!crossCheck.enabled) return text
    crossCheck.compared++
    const { characters } = preservationWork
    let whole: string
    try {
      whole = this.wholeDocument(doc)
    } catch (error) {
      // An edit validated where it stands needs no matching, so it can save
      // when matching the whole document would run out of budget.
      whole =
        (error as Error).message === tooManyBlocks().message &&
        this.reopens(doc, text)
          ? text
          : `refused: ${(error as Error).message}`
    }
    preservationWork.characters = characters
    if (whole !== text)
      crossCheck.differences.push(
        JSON.stringify({ source: this.source, fast: text, whole }),
      )
    return text
  }

  // Whether `output` reads back as `doc`.
  private reopens(
    doc: ProseNode,
    output: string,
    canonical = write(this.ctx, doc),
  ): boolean {
    const reopened = parseDoc(this.ctx, output)
    if (semanticSignature(reopened) !== semanticSignature(doc)) return false
    const normalized = (text: string): string => text.replace(/\r\n?/g, '\n')
    const actual = normalized(write(this.ctx, reopened))
    // Parsing may normalize loose-list spacing. Compare both reconstructed
    // source and intended canonical source after that same normalization.
    return (
      actual === normalized(canonical) ||
      actual === normalized(write(this.ctx, parseDoc(this.ctx, canonical)))
    )
  }

  // The gap the whole-document path writes before the current block at
  // `index`: the authored text between two blocks paired one after the other,
  // otherwise a blank line. The first block keeps the file's head when it is
  // paired with the first original.
  private gap(index: number, positions: Array<number | undefined>): string {
    const position = positions[index]
    const block = position == null ? undefined : this.blocks[position]
    if (index === 0)
      return position === 0 && block
        ? this.source.slice(0, block.start)
        : this.source.startsWith('\uFEFF')
          ? '\uFEFF'
          : ''
    const previous = positions[index - 1]
    return previous != null && position === previous + 1 && block
      ? this.source.slice(this.blocks[previous]!.end, block.start)
      : this.lineEnding.repeat(2)
  }

  // What the whole-document path writes for the current blocks from `from` to
  // `to`, and the gap before each. `canonical` is those blocks written as
  // canonical Markdown, and `tree` its parse, with the block at `from` as its
  // first child, when it reads back as one node for each block.
  private build(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
    carried: Carried,
    from: number,
    to: number,
    canonical: string,
    tree?: { raw: Root; transformed: Root },
  ): { gaps: string[]; pieces: string[]; kept: Kept[] } {
    const transformed = (index: number) =>
      tree!.transformed.children[index - from] as unknown as SourceNode
    // The editor also holds a block that failed to parse as literal Markdown,
    // which the transformed tree does not show.
    if (tree) {
      const failed: SourceNode[] = []
      for (let index = from; index < to; index++)
        if (doc.child(index).type.name === 'literal_markdown')
          failed.push(transformed(index))
      markLiterals(tree.raw, tree.transformed, failed)
    }
    // An original between the blocks paired around these is one an edit
    // could have joined into them. Pairing keeps order, so only the blocks
    // paired from just before `from` to just after `to` can lie between.
    const paired = new Set<Block>()
    for (
      let index = Math.max(0, from - 1);
      index < Math.min(positions.length, to + 1);
      index++
    ) {
      const position = positions[index]
      if (position != null) paired.add(this.blocks[position]!)
    }
    // The children each edited list or quote keeps at its start and end,
    // which a part split from the same original cannot also be.
    const taken = new Set<SourceNode>()
    if (tree)
      for (let index = from; index < to; index++) {
        const position = positions[index]
        const kids =
          position == null ? undefined : this.blocks[position]!.ast.children
        const now = transformed(index).children
        if (!kids || !now || this.blocks[position!]!.form === current[index])
          continue
        let start = 0,
          end = 0
        while (
          start < Math.min(kids.length, now.length) &&
          signature(kids[start]!) === signature(now[start]!)
        )
          taken.add(kids[start++]!)
        while (
          end < Math.min(kids.length, now.length) - start &&
          signature(kids[kids.length - 1 - end]!) ===
            signature(now[now.length - 1 - end]!)
        )
          taken.add(kids[kids.length - 1 - end++]!)
      }
    const gaps: string[] = []
    const pieces: string[] = []
    const kept: Kept[] = []
    for (let index = from; index < to; index++) {
      const text = current[index]!
      const position = positions[index]
      const moved = carried.moved.get(index)
      const block =
        position == null
          ? moved === undefined
            ? undefined
            : this.blocks[moved]
          : this.blocks[position]
      gaps.push(this.gap(index, positions))
      const kind: Kept =
        block && block.form === text && !carried.within.has(index)
          ? position == null
            ? 'moved'
            : 'unchanged'
          : block && tree && position != null
            ? 'edited'
            : 'canonical'
      kept.push(kind)
      const node = tree
        ? positionalNode(tree.raw, transformed(index))
        : undefined
      pieces.push(
        kind === 'unchanged' || kind === 'moved'
          ? this.source.slice(block!.start, block!.end)
          : kind === 'edited'
            ? this.retainBlock(
                block!,
                node!,
                canonical,
                this.around(positions, index)
                  .filter(
                    (other) =>
                      !paired.has(other) && other.ast.type === block!.ast.type,
                  )
                  .flatMap((other) => other.ast.children ?? []),
                carried.children
                  ? this.carriedChildren(doc.child(index), position!)
                  : undefined,
              )
            : ((node &&
                this.retainPart(positions, index, node, canonical, taken)) ??
              restoreCodeEndings(
                this.ctx,
                doc.type.create(null, [doc.child(index)]),
                withEnding(text, this.lineEnding),
              )),
      )
    }
    return { gaps, pieces, kept }
  }

  // The canonical Markdown of `nodes` and its parse, which locates each block
  // in it when it reads back as one node for each.
  private canonicalBlocks(
    doc: ProseNode,
    nodes: ProseNode[],
  ): { canonical: string; tree?: { raw: Root; transformed: Root } } {
    const { written, extra } = this.writeBlocks(doc, nodes)
    // Read with the definitions its labels can refer to, as in the document.
    const definitions = written.includes('[')
      ? this.definitions(written)
      : undefined
    const canonical = definitions?.text
      ? written + this.lineEnding.repeat(2) + definitions.text
      : written
    const raw = parseTree(this.ctx, canonical)
    const transformed = this.ctx
      .get(remarkCtx)
      .runSync(structuredClone(raw), { value: canonical }) as Root
    return {
      canonical,
      tree:
        transformed.children.length ===
        nodes.length + extra + (definitions?.blocks ?? 0)
          ? { raw, transformed }
          : undefined,
    }
  }

  // The canonical Markdown of the whole document and its parse.
  private canonicalDocument(doc: ProseNode): {
    canonical: string
    tree?: { raw: Root; transformed: Root }
  } {
    const nodes: ProseNode[] = []
    doc.forEach((node) => nodes.push(node))
    const { written: canonical, extra } = this.writeBlocks(doc, nodes)
    const raw = parseTree(this.ctx, canonical)
    const transformed = this.ctx
      .get(remarkCtx)
      .runSync(structuredClone(raw), { value: canonical }) as Root
    return {
      canonical,
      tree:
        transformed.children.length === doc.childCount + extra
          ? { raw, transformed }
          : undefined,
    }
  }

  // Canonical Markdown for `nodes`. An empty paragraph at the end of a
  // document is written as nothing, so a paragraph is added after one there,
  // and `extra` counts it.
  private writeBlocks(
    doc: ProseNode,
    nodes: ProseNode[],
  ): { written: string; extra: number } {
    const last = nodes.at(-1)
    const extra =
      last?.type.name === 'paragraph' && last.content.size === 0 ? 1 : 0
    const written = write(
      this.ctx,
      doc.type.create(
        doc.attrs,
        extra
          ? [...nodes, last!.type.create(null, doc.type.schema.text('end'))]
          : nodes,
      ),
    )
    return { written, extra }
  }

  // The runs of changed blocks, each between two blocks the edit left as they
  // were, or an end of the document. A block is unchanged when it is paired
  // with an original of the same form, and the text between two unchanged
  // blocks is kept when they are paired with consecutive originals.
  private runs(
    positions: Array<number | undefined>,
    current: string[],
    within: Set<number> = nothingCarried.within,
  ): Run[] {
    const unchanged = (index: number) => {
      const position = positions[index]
      return (
        position != null &&
        this.blocks[position]!.form === current[index] &&
        !within.has(index)
      )
    }
    const consecutive = (index: number) =>
      index === 0
        ? positions[0] === 0
        : positions[index] != null &&
          positions[index - 1] != null &&
          positions[index] === positions[index - 1]! + 1
    const runs: Run[] = []
    let previous: number | undefined
    let changed = false
    for (let index = 0; index < current.length; index++) {
      if (!unchanged(index)) changed = true
      else {
        if (changed || !consecutive(index)) runs.push({ previous, next: index })
        changed = false
        previous = index
      }
    }
    if (
      changed ||
      previous === undefined ||
      positions[previous] !== this.blocks.length - 1
    )
      runs.push({ previous })
    return runs
  }

  // Whether each run reads as it does in the document when it is read with
  // the definitions it refers to, which holds when every definition is a
  // top-level block that no run adds, changes or removes. Otherwise changed
  // blocks are read in the canonical Markdown of the whole document.
  private readAlone(
    doc: ProseNode,
    positions: Array<number | undefined>,
    runs: Run[],
  ): boolean {
    if (this.definitionSources === undefined) return false
    return runs.every((run) => {
      const from = run.previous === undefined ? 0 : run.previous + 1
      const to = run.next ?? doc.childCount
      for (let index = from; index < to; index++)
        if (Preservation.defines(doc.child(index))) return false
      const first =
        run.previous === undefined ? 0 : positions[run.previous]! + 1
      const last =
        run.next === undefined ? this.blocks.length : positions[run.next]!
      for (let index = first; index < last; index++)
        if (definesSource(this.blocks[index]!.ast)) return false
      return true
    })
  }

  // What the whole-document path writes for the changed blocks of a run, read
  // from their own canonical Markdown.
  private runPieces(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
    carried: Carried,
    run: Run,
  ): { gaps: string[]; pieces: string[]; kept: Kept[] } {
    const from = run.previous === undefined ? 0 : run.previous + 1
    const to = run.next ?? doc.childCount
    if (from === to) return { gaps: [], pieces: [], kept: [] }
    const nodes: ProseNode[] = []
    for (let index = from; index < to; index++) nodes.push(doc.child(index))
    const { canonical, tree } =
      from === 0 && to === doc.childCount
        ? this.canonicalDocument(doc)
        : this.canonicalBlocks(doc, nodes)
    return this.build(
      doc,
      positions,
      current,
      carried,
      from,
      to,
      canonical,
      tree,
    )
  }

  // Saves an edit that inserts, removes, splits or joins blocks by validating
  // only what changed. Blocks are paired with their originals as the
  // whole-document path pairs them, and each run of changed blocks between
  // unchanged ones is written by the same code. Each run is then read back
  // with the unchanged block on either side, which shows that nothing in it
  // changes how those blocks, or the blocks beyond them, read. Returns
  // undefined whenever that cannot be shown, and the whole-document path
  // decides.
  private regions(doc: ProseNode): string | undefined {
    const count = doc.childCount
    if (
      !count ||
      this.baseline.childCount !== this.blocks.length ||
      !doc.sameMarkup(this.baseline) ||
      // `readAlone` would refuse this after pairing; checking first skips it.
      this.definitionSources === undefined
    )
      return undefined
    const current: string[] = []
    doc.forEach((node) => current.push(this.formOf(node)))
    let positions: Array<number | undefined>
    let carried: Carried
    try {
      ;({ positions, carried } = this.pairing(doc, current))
    } catch {
      return undefined
    }
    const runs = this.runs(positions, current, carried.within)
    if (
      // With nothing left as it was, the whole document is one run.
      runs.some(
        (run) => run.previous === undefined && run.next === undefined,
      ) ||
      !this.readAlone(doc, positions, runs)
    )
      return undefined
    let output = ''
    let at = 0
    for (const run of runs) {
      const from =
        run.previous === undefined
          ? 0
          : this.blocks[positions[run.previous]!]!.end
      const to =
        run.next === undefined
          ? this.source.length
          : this.blocks[positions[run.next]!]!.start
      const text = this.region(doc, positions, current, carried, run)
      if (text === undefined) return undefined
      output += this.source.slice(at, from) + text
      at = to
    }
    output += this.source.slice(at)
    // Front matter runs from the start of the file to the next delimiter
    // line, which a changed block can supply, and a rule that opens the file
    // would then be rewritten.
    const bom = (text: string) => text.replace(/^\uFEFF/, '')
    const frontmatter = sourceFrontmatter(bom(output))
    if (
      frontmatter !== sourceFrontmatter(bom(this.source)) ||
      (doc.firstChild?.type.name === 'hr' && frontmatter?.startsWith('---'))
    )
      return undefined
    return output
  }

  // The text that replaces the source between the unchanged blocks around a
  // run, or undefined when the run cannot be validated on its own.
  private region(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
    carried: Carried,
    run: Run,
  ): string | undefined {
    const from = run.previous === undefined ? 0 : run.previous + 1
    const to = run.next ?? doc.childCount
    const nodes: ProseNode[] = []
    for (let index = from; index < to; index++) nodes.push(doc.child(index))
    const neighbours = [run.previous, run.next].flatMap((index) =>
      index === undefined ? [] : [doc.child(index)],
    )
    const key = nodes[0] ?? neighbours[0]!
    const original = (index: number | undefined) =>
      index === undefined ? -1 : positions[index]!
    const identity = [
      original(run.previous),
      original(run.next),
      // Unpaired positions are holes, which `slice` keeps as holes.
      ...Array.from(
        { length: to - from },
        (_, at) =>
          positions[from + at] ?? `m${carried.moved.get(from + at) ?? ''}`,
      ),
    ].join()
    const cached = this.regionEdits.get(key)
    if (
      cached &&
      cached.identity === identity &&
      cached.nodes.length === nodes.length + neighbours.length &&
      [...nodes, ...neighbours].every(
        (node, index) => cached.nodes[index] === node,
      )
    )
      return cached.text
    // Two lists of one kind side by side need markers chosen across both.
    const list = (index: number) => {
      const name = doc.maybeChild(index)?.type.name
      return name === 'bullet_list' || name === 'ordered_list'
        ? name
        : undefined
    }
    for (
      let index = Math.max(1, from);
      index <= Math.min(to, doc.childCount - 1);
      index++
    )
      if (list(index) && list(index) === list(index - 1)) return undefined
    const { gaps, pieces } = this.runPieces(
      doc,
      positions,
      current,
      carried,
      run,
    )
    let text = pieces.map((piece, index) => gaps[index] + piece).join('')
    if (run.next !== undefined) text += this.gap(run.next, positions)
    else
      text += this.endsAsAuthored(positions, carried)
        ? this.source.slice(this.blocks.at(-1)!.end)
        : (finalCodeEnding(doc) ?? this.lineEnding)
    const slice = (index: number | undefined) => {
      if (index === undefined) return ''
      const block = this.blocks[positions[index]!]!
      return this.source.slice(block.start, block.end)
    }
    const read = [
      ...(run.previous === undefined ? [] : [doc.child(run.previous)]),
      ...nodes,
      ...(run.next === undefined ? [] : [doc.child(run.next)]),
    ]
    if (!this.readsAs(slice(run.previous) + text + slice(run.next), read))
      return undefined
    this.regionEdits.set(key, {
      identity,
      nodes: [...nodes, ...neighbours],
      text,
    })
    return text
  }

  // Whether a block is or holds a link or footnote definition.
  private static defines(node: ProseNode): boolean {
    let found = false
    node.descendants((child) => {
      if (/^(?:reference|footnote)_definition$/.test(child.type.name))
        found = true
      return !found
    })
    return found || /^(?:reference|footnote)_definition$/.test(node.type.name)
  }

  // Whether `text` reads as `nodes` in place. HTML blocks, HTML comments and
  // `%%` comments can span blocks, so text holding them is not read alone;
  // the `<br />` line an empty paragraph is written as is the exception. A
  // paragraph after the text must still read as a paragraph of its own, which
  // shows that nothing in the text runs on into what follows it.
  private readsAs(text: string, nodes: ProseNode[]): boolean {
    if (
      text.includes('%%') ||
      text
        .split(/\r?\n/)
        .some((line) => line.includes('<') && !lineBreakHTML(line))
    )
      return false
    const definitions = text.includes('[')
      ? this.definitions(text)
      : { text: '', blocks: 0, nodes: 0 }
    if (!definitions) return false
    const sentinel = 'InkKit end of region'
    const separator = this.lineEnding.repeat(2)
    const read = parseDoc(
      this.ctx,
      text +
        separator +
        sentinel +
        (definitions.text ? separator + definitions.text : ''),
    )
    if (
      read.childCount !== nodes.length + 1 + definitions.nodes ||
      read.child(nodes.length).type.name !== 'paragraph' ||
      read.child(nodes.length).textContent !== sentinel
    )
      return false
    const children: ProseNode[] = []
    for (let index = 0; index < nodes.length; index++)
      children.push(read.child(index))
    const expected = read.type.create(null, nodes)
    const reopened = read.type.create(null, children)
    if (semanticSignature(reopened) !== semanticSignature(expected))
      return false
    const normalized = (value: string): string => value.replace(/\r\n?/g, '\n')
    const canonical = write(this.ctx, expected)
    const actual = normalized(write(this.ctx, reopened))
    if (actual === normalized(canonical)) return true
    // Parsing may normalize loose-list spacing, as in `reopens`.
    const again = parseDoc(
      this.ctx,
      canonical + (definitions.text ? separator + definitions.text : ''),
    )
    if (again.childCount !== nodes.length + definitions.nodes) return false
    const rewritten: ProseNode[] = []
    for (let index = 0; index < nodes.length; index++)
      rewritten.push(again.child(index))
    return (
      actual === normalized(write(this.ctx, read.type.create(null, rewritten)))
    )
  }

  private wholeDocument(doc: ProseNode): string {
    try {
      const canonical = write(this.ctx, doc)
      if (canonical === '')
        return this.source.startsWith('\uFEFF') ? '\uFEFF' : ''
      const current: string[] = []
      doc.forEach((node) => current.push(this.formOf(node)))
      const pairing = this.pairing(doc, current)
      const carries = pairing.carried.moved.size > 0 || pairing.carried.children
      if (carries) {
        // A moved block's source can read differently where it now stands,
        // such as indented code under a list. The moved blocks are then
        // written as an edit without the move's record writes them.
        let output: string | undefined
        try {
          output = this.writeDocument(doc, current, pairing)
        } catch {
          output = undefined
        }
        if (output !== undefined && this.reopens(doc, output, canonical))
          return output
      }
      const output = this.writeDocument(
        doc,
        current,
        carries
          ? {
              positions: correspondence(this.blockForms, current),
              carried: nothingCarried,
            }
          : pairing,
      )
      if (this.reopens(doc, output, canonical)) return output
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

  // The whole document written from `pairing`. Unchanged blocks keep their
  // source and the text between them. Each run of changed blocks is written
  // from its own canonical Markdown, or, when a run can't be read alone,
  // every block from the whole document's.
  private writeDocument(
    doc: ProseNode,
    current: string[],
    { positions, carried }: Pairing,
  ): string {
    const gaps = current.map((_, index) => this.gap(index, positions))
    const pieces = positions.map((position) =>
      position == null
        ? ''
        : this.source.slice(
            this.blocks[position]!.start,
            this.blocks[position]!.end,
          ),
    )
    const kept: Kept[] = current.map(() => 'unchanged')
    const runs = this.runs(positions, current, carried.within)
    for (const run of this.readAlone(doc, positions, runs) ? runs : [{}]) {
      const from = run.previous === undefined ? 0 : run.previous + 1
      const written = this.runPieces(doc, positions, current, carried, run)
      written.pieces.forEach((piece, index) => {
        pieces[from + index] = piece
        kept[from + index] = written.kept[index]!
      })
    }
    const previous = positions.at(-1)
    this.separateLists(doc, pieces, kept, positions, current)
    let output = pieces.map((piece, index) => gaps[index] + piece).join('')
    if (this.endsAsAuthored(positions, carried))
      output += this.source.slice(this.blocks.at(-1)!.end)
    else if (output) output += finalCodeEnding(doc) ?? this.lineEnding
    // A `---` rule that opens the file reads back as front matter when
    // another `---` line follows, whether it is new or moved there.
    const bom = output.startsWith('\uFEFF') ? 1 : 0
    if (
      doc.firstChild?.type.name === 'hr' &&
      sourceFrontmatter(output.slice(bom))?.startsWith('---')
    )
      output = output.slice(0, bom) + '***' + output.slice(bom + 3)
    return output
  }

  // Where each baseline block sits in the baseline, by node: its index among
  // the top-level blocks, then among the children of each block above it.
  private originIndex(): WeakMap<ProseNode, number[]> {
    if (this.origins) return this.origins
    const origins = new WeakMap<ProseNode, number[]>()
    const visit = (node: ProseNode, path: number[]) =>
      node.forEach((child, _, index) => {
        const at = [...path, index]
        origins.set(child, at)
        if (!child.isTextblock && !child.isLeaf && child.type.name !== 'table')
          visit(child, at)
      })
    visit(this.baseline, [])
    return (this.origins = origins)
  }

  // Pairs the current blocks with the originals. Without block moves, this is
  // `correspondence`. A top-level block a move carried, that is still a node
  // of the baseline, is paired with its own original before the others are
  // matched, so a copy of its text elsewhere can't take its source or give it
  // another's. Back beside a neighbor it had in the source, it is paired in
  // place, as if it had not moved; otherwise it keeps its source as a moved
  // block.
  private pairing(doc: ProseNode, current: string[]): Pairing {
    const moves = this.moves
    if (!moves || this.baseline.childCount !== this.blocks.length)
      return {
        positions: correspondence(this.blockForms, current),
        carried: nothingCarried,
      }
    const origins = this.originIndex()
    const pinned = new Map<number, number>()
    doc.forEach((node, _, index) => {
      if (moves.has(node)) {
        const origin = origins.get(node)
        if (origin?.length === 1) pinned.set(index, origin[0]!)
      }
    })
    if (!pinned.size) {
      const positions = correspondence(this.blockForms, current)
      return {
        positions,
        carried: {
          moved: pinned,
          children: true,
          within: this.within(doc, positions, current),
        },
      }
    }
    const taken = new Set(pinned.values())
    const before = this.blocks.flatMap((_, index) =>
      taken.has(index) ? [] : [index],
    )
    const after = current.flatMap((_, index) =>
      pinned.has(index) ? [] : [index],
    )
    // A block that is still a node of the baseline is matched with its own
    // original, so a copy of it elsewhere can't take its place when a move
    // has left its neighbors out of order.
    const present = new Map<number, number>()
    for (const index of after) {
      const origin = origins.get(doc.child(index))
      if (origin?.length === 1) present.set(index, origin[0]!)
    }
    const kept = new Set(present.values())
    const matched = correspondence(
      before.map((index) =>
        kept.has(index)
          ? `${this.blockForms[index]!}\u0000${index}`
          : this.blockForms[index]!,
      ),
      after.map((index) =>
        present.has(index)
          ? `${current[index]!}\u0000${present.get(index)!}`
          : current[index]!,
      ),
    )
    const positions: Array<number | undefined> = new Array(current.length)
    after.forEach((index, at) => {
      const match = matched[at]
      if (match !== undefined) positions[index] = before[match]
    })
    // The paired original after each current block, so a carried block back
    // in its own place is paired there, as if it had not moved.
    const next: number[] = new Array(current.length)
    let following = this.blocks.length
    for (let index = current.length - 1; index >= 0; index--) {
      next[index] = following
      if (positions[index] !== undefined) following = positions[index]!
    }
    // The original of each block that is still a node of the baseline. A
    // carried block between two of them in their source order is in its own
    // place, as after Undo, even when blocks around it were deleted since.
    const own = (index: number) => {
      const origin = origins.get(doc.child(index))
      return origin?.length === 1 ? origin[0]! : undefined
    }
    const above: number[] = new Array(current.length)
    let upper = this.blocks.length
    for (let index = current.length - 1; index >= 0; index--) {
      above[index] = upper
      upper = own(index) ?? upper
    }
    const moved = new Map<number, number>()
    let last = -1
    let lower = -1
    for (let index = 0; index < current.length; index++) {
      const origin = pinned.get(index)
      const inOrder = origin! > lower && origin! < above[index]!
      lower = own(index) ?? lower
      if (origin === undefined) {
        if (positions[index] !== undefined) last = positions[index]!
      } else if (origin > last && origin < next[index]! && inOrder) {
        positions[index] = origin
        last = origin
      } else moved.set(index, origin)
    }
    return {
      positions,
      carried: {
        moved,
        children: true,
        within: this.within(doc, positions, current),
      },
    }
  }

  // Whether the text after the last block stays as authored: the last block
  // is paired with the last original, or a move carried the last original
  // elsewhere and a carried block ends the note.
  private endsAsAuthored(
    positions: Array<number | undefined>,
    carried: Carried,
  ): boolean {
    const end = this.blocks.length - 1
    if (end < 0) return false
    if (positions.at(-1) === end) return true
    return (
      carried.moved.has(positions.length - 1) &&
      [...carried.moved.values()].includes(end)
    )
  }

  // The blocks that read the same as the originals they are paired with, but
  // hold children a move carried, so their source can change.
  private within(
    doc: ProseNode,
    positions: Array<number | undefined>,
    current: string[],
  ): Set<number> {
    const within = new Set<number>()
    positions.forEach((position, index) => {
      const node = doc.child(index)
      if (
        position !== undefined &&
        this.blocks[position]!.form === current[index] &&
        node !== this.baseline.child(position) &&
        this.carries(node)
      )
        within.add(index)
    })
    return within
  }

  // Where block moves carried the children of the current block `node`,
  // paired with the original at `original`: for each list, quote, callout or
  // footnote of the original, by where it starts in the source, the original
  // index of each child a move carried, by its current index.
  private carriedChildren(
    node: ProseNode,
    original: number,
  ): Reorder | undefined {
    const moves = this.moves
    if (!moves || this.baseline.childCount !== this.blocks.length) return
    const origins = this.originIndex()
    let reorder: Reorder | undefined
    const walk = (
      current: ProseNode,
      path: number[],
      ast: SourceNode | undefined,
    ) => {
      if (!ast?.children || ast.position?.start.offset == null) return
      current.forEach((child, _, index) => {
        let from = index
        const origin = moves.has(child) ? origins.get(child) : undefined
        if (
          origin?.length === path.length + 1 &&
          origin.every((step, at) => at === path.length || step === path[at])
        ) {
          from = origin.at(-1)!
          if (from !== index) {
            reorder ??= new Map()
            const key = parentKey(ast)
            if (!reorder.has(key)) reorder.set(key, new Map())
            reorder.get(key)!.set(index, from)
          }
        }
        if (!child.isTextblock && !child.isLeaf && child.type.name !== 'table')
          walk(child, [...path, from], ast.children![from])
      })
    }
    walk(node, [original], this.blocks[original]!.ast)
    return reorder
  }
}
