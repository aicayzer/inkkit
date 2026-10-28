import { gutterAt } from './gutter'
import {
  type SourceNode,
  type Reorder,
  type Neighbour,
  type Gutters,
} from './preserve-types'
import { inlineParents } from './preserve-shape'

/** Where the delimiter row ends, given where the header row before it ends. */
export function delimiterRowEnd(text: string, headerEnd: number): number {
  const next = text.indexOf('\n', headerEnd)
  if (next < 0) return headerEnd
  const ending = /\r?\n/g
  ending.lastIndex = next + 1
  return ending.exec(text)?.index ?? text.length
}

// The character that decides which list an item belongs to: its bullet, or the
// delimiter after its number. Items with different ones start a new list.
export function markerAt(
  text: string,
  at: number,
): { at: number; marker: string } | undefined {
  const match = /^(?:[-*+]|\d{1,9}[.)])/.exec(text.slice(at, at + 10))
  return match
    ? { at: at + match[0].length - 1, marker: match[0].at(-1)! }
    : undefined
}

export function relabel(
  text: string,
  offsets: number[],
  marker: string,
): string {
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

export const parentKey = (node: SourceNode): string =>
  `${node.type}:${node.position!.start.offset!}`

// Whether a move carried children of `node` or of a block inside it.
export function reorderedWithin(node: SourceNode, reorder?: Reorder): boolean {
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
export function renumberItem(
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

export function authoredMarker(
  list: SourceNode,
  source: string,
): string | undefined {
  const at = list.children?.[0]?.position?.start.offset
  return at == null ? undefined : markerAt(source, at)?.marker
}

export const sameList = (before: SourceNode, after: SourceNode): boolean =>
  before.type === 'list' &&
  after.type === 'list' &&
  before.ordered === after.ordered

// The gutters of the lines a block's children are written on, in the source and in the canonical
// text. A slice written from the start of the block carries its own markers, whose width the
// canonical text sets, so only the gutter that holds the block is exchanged there.
export function childGutters(
  before: SourceNode,
  after: SourceNode,
  source: string,
  canonical: string,
  fromStart = false,
): Gutters | undefined {
  if (inlineParents.has(before.type) || before.type === 'table')
    return undefined
  const [first, now] = [before, after].map((node) =>
    fromStart
      ? node.position?.start.offset
      : node.children?.[0]?.position?.start.offset,
  )
  return first == null || now == null
    ? undefined
    : [gutterAt(source, first), gutterAt(canonical, now)]
}

// Canonical text written into authored source, with the gutter of its lines changed from the one
// the canonical writer uses to the one the source does. The first line keeps what it has. A text
// that is `open` ends where more of the line follows, so its last line is only a gutter.
export function regutter(
  text: string,
  gutters?: Gutters,
  open = false,
): string {
  if (!gutters || gutters[0] === gutters[1]) return text
  const [authored, canonical] = gutters
  const bare = canonical.trimEnd()
  return text.replace(/(\r?\n)([^\r\n]*)/g, (match, ending, line, at) => {
    if (
      open &&
      at + match.length === text.length &&
      (line === bare || line === canonical)
    )
      return ending + authored
    if (line === bare) return ending + authored.trimEnd()
    return line.startsWith(canonical)
      ? ending + authored + line.slice(canonical.length)
      : match
  })
}

// Canonical Markdown written into authored source. Items written into an
// authored list take its marker, which they would otherwise split away from.
// A list written beside an authored list takes a marker that list does not
// use, which it would otherwise merge with.
export function canonicalSlice(
  marker: string | undefined,
  children: SourceNode[],
  canonical: string,
  from: number,
  to: number,
  previous?: Neighbour,
  next?: Neighbour,
  gutters?: Gutters,
  open = false,
  // The marker of the list item that holds `children`, which a list opened in
  // it takes when it is written afresh.
  inherited?: string,
): string {
  let text = canonical.slice(from, to)
  const offsets = (list: SourceNode) =>
    (list.children ?? []).map((item) => item.position!.start.offset! - from)
  if (marker)
    return regutter(
      relabel(
        text,
        children.map((item) => item.position!.start.offset! - from),
        marker,
      ),
      gutters,
      open,
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
      inherited && /[.)]/.test(inherited) === !!child.ordered
        ? inherited
        : undefined,
      own,
      ...(child.ordered ? ['.', ')'] : ['-', '*', '+']),
    ].find((candidate) => candidate && !avoid.includes(candidate))
    if (choice) text = relabel(text, offsets(child), choice)
    previous = { ordered: child.ordered, marker: choice ?? own ?? '' }
  })
  return regutter(text, gutters, open)
}

// The marker an authored list item is written with.
export const itemMarker = (
  item: SourceNode,
  source: string,
): string | undefined =>
  item.type === 'listItem'
    ? markerAt(source, item.position!.start.offset!)?.marker
    : undefined

// The authored list a child is, as a neighbour of canonical Markdown.
export function authoredNeighbour(
  before: SourceNode | undefined,
  after: SourceNode | undefined,
  source: string,
): Neighbour | undefined {
  if (!before || !after || !sameList(before, after)) return undefined
  const marker = authoredMarker(before, source)
  return marker ? { ordered: before.ordered, marker } : undefined
}

// Whether blank lines separate a list's items or the blocks inside one. A
// list's own spread can also count blank lines after its last item.
export function loose(list: SourceNode, text: string): boolean {
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
