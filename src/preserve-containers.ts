import { gutterAt } from './gutter'
import { type SourceNode, type Neighbour, type Gutters } from './preserve-types'
import { signature, matchShape } from './preserve-shape'
import {
  markerAt,
  relabel,
  authoredMarker,
  childGutters,
  regutter,
  canonicalSlice,
  itemMarker,
} from './preserve-list'
import { type retainSource } from './preserve-retain'

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
export function retainSplit(
  retain: typeof retainSource,
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
    text: retain(part, after, source, canonical, lineEnding),
  }
}

// The source of a block that an edit lifted out of a list item or quote in
// `blocks`, which keeps the way it was written. Only a block that reads the
// same as exactly one of theirs is taken, since two would leave it unknown which
// one it was.
export function liftedSource(
  blocks: readonly SourceNode[],
  after: SourceNode,
  source: string,
): string | undefined {
  if (after.type === 'list' || after.type === 'blockquote') return undefined
  const wanted = signature(after)
  const found: SourceNode[] = []
  // A task's paragraph is written after its box, so it is not taken.
  const visit = (node: SourceNode) => {
    for (const child of node.children ?? []) {
      if (
        child.type === 'list' ||
        child.type === 'listItem' ||
        child.type === 'blockquote'
      )
        visit(child)
      else if (
        (node.type === 'blockquote' ||
          (node.type === 'listItem' && node.checked == null)) &&
        signature(child) === wanted
      )
        found.push(child)
    }
  }
  blocks.forEach(visit)
  if (found.length !== 1) return undefined
  const start = found[0]!.position?.start.offset
  const end = found[0]!.position?.end.offset
  if (start == null || end == null) return undefined
  return regutter(source.slice(start, end), ['', gutterAt(source, start)])
}

// The items, in the order a list's children read, that sit one after the
// other in the source and open as those children do.
function strayRun(
  strays: readonly SourceNode[],
  wanted: readonly SourceNode[],
  source: string,
  opening: (item: SourceNode) => string | undefined,
): SourceNode[] {
  const keys = wanted.map(opening)
  for (const [at, stray] of strays.entries()) {
    if (opening(stray) !== keys[0]) continue
    const run = [stray]
    for (const next of strays.slice(at + 1)) {
      if (
        opening(next) !== keys[run.length] ||
        !/^[ \t>]*(\r?\n[ \t>]*)+$/.test(
          source.slice(
            run.at(-1)!.position!.end.offset,
            next.position!.start.offset,
          ),
        )
      )
        break
      run.push(next)
    }
    return run
  }
  return []
}

// Children written afresh between authored ones, each read against the
// original it continues: a list or quote split from an original keeps that
// run of its children, and an item that keeps its first line is the original
// item. An item that does not still keeps the lists and quotes split into it.
// Undefined when no child continues an original.
export function retainParts(
  retain: typeof retainSource,
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
  gutters?: Gutters,
  // Whether `to` is where more of its line follows.
  open = false,
  inherited?: string,
): string | undefined {
  const taken = new Set<SourceNode>()
  const opening = (item: SourceNode) =>
    item.children?.length
      ? matchShape(item) + signature(item.children[0]!)
      : undefined
  // The items the originals hold, those in sublists after those at the level
  // of the edit, so an item moved a level in either direction is found.
  const items = new Map<string, SourceNode[]>()
  for (let row = before; row.length;) {
    const deeper: SourceNode[] = []
    for (const node of row) {
      if (node.type !== 'listItem') continue
      const key = opening(node)
      if (key) {
        const same = items.get(key)
        if (same) same.push(node)
        else items.set(key, [node])
      }
      for (const child of node.children ?? [])
        if (child.type === 'list') deeper.push(...(child.children ?? []))
    }
    row = deeper
  }
  // An item moved into a list of the other kind, bullets or numbers, is
  // written afresh, since its marker would change the width of its lines.
  const isNumbered = (item: SourceNode) =>
    /[.)]/.test(itemMarker(item, source) ?? '')
  const originals = after.map((child) => {
    const original =
      child.type === 'listItem'
        ? items.get(opening(child) ?? '')?.shift()
        : undefined
    return original && marker && isNumbered(original) !== /[.)]/.test(marker)
      ? undefined
      : original
  })
  const ownLevel = new Set(before)
  // Items no child continues, which an edit can have moved into one: an item
  // sunk below its sibling, or a sibling an item took along as its sublist.
  const strays = [...items.values()]
    .flat()
    .sort(
      (left, right) =>
        left.position!.start.offset! - right.position!.start.offset!,
    )
  const pieces = after.map((child, index): string | undefined => {
    const end = child.position!.end.offset!
    if (child.type === 'list' || child.type === 'blockquote') {
      const part = retainSplit(
        retain,
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
      // A list made of items from other levels keeps their source.
      if (child.type === 'list' && !lists.length) {
        const run = strayRun(strays, child.children!, source, opening)
        if (!run.length) return undefined
        const first = run[0]!.position!.start.offset!
        const opened: SourceNode = {
          type: 'list',
          ordered: child.ordered,
          start: child.ordered
            ? Number(/^\d+/.exec(source.slice(first))![0])
            : null,
          spread: false,
          children: run,
          position: {
            start: { offset: first },
            end: { offset: run.at(-1)!.position!.end.offset },
          },
        }
        return (
          regutter(
            retain(opened, child, source, canonical, lineEnding),
            gutters && [gutters[0], gutterAt(source, first)],
          ) + canonical.slice(child.children!.at(-1)!.position!.end.offset, end)
        )
      }
      return child.type === 'list' && lists.length
        ? retainParts(
            retain,
            authoredMarker(lists[0]!, source),
            lists.flatMap((list) => list.children ?? []),
            child.children!,
            source,
            canonical,
            child.position!.start.offset!,
            end,
            lineEnding,
            undefined,
            undefined,
            childGutters(lists[0]!, child, source, canonical),
          )
        : undefined
    }
    if (child.type !== 'listItem') return undefined
    const original = originals[index]
    const text = original
      ? regutter(
          retain(
            original,
            child,
            source,
            canonical,
            lineEnding,
            false,
            undefined,
            undefined,
            strays,
          ),
          gutters && [
            gutters[0],
            gutterAt(source, original.position!.start.offset!),
          ],
        )
      : child.children?.some(
            (node) => node.type === 'list' || node.type === 'blockquote',
          )
        ? retainParts(
            retain,
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
            undefined,
            undefined,
            childGutters(
              before.find((node) => node.type === 'listItem')!,
              child,
              source,
              canonical,
            ),
          )
        : undefined
    return text !== undefined && marker ? relabel(text, [0], marker) : text
  })
  if (pieces.every((piece) => piece === undefined)) return undefined
  let text = '',
    at = from,
    lastNumber: number | undefined
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
    // An item that came from another level of an ordered list is numbered
    // after the item before it.
    const number = /^\d+/.exec(piece ?? '')?.[0]
    if (
      piece &&
      number &&
      marker &&
      lastNumber !== undefined &&
      originals[index] &&
      !ownLevel.has(originals[index]!) &&
      String(lastNumber + 1).length === number.length
    )
      piece = String(lastNumber + 1) + piece.slice(number.length)
    piece ??= canonicalSlice(
      marker,
      [child],
      canonical,
      childStart,
      childEnd,
      previous,
      following,
      gutters,
      false,
      inherited,
    )
    lastNumber =
      child.type === 'listItem' && /^\d/.test(piece)
        ? Number(/^\d+/.exec(piece)![0])
        : undefined
    previous =
      child.type === 'list'
        ? {
            ordered: child.ordered,
            marker:
              markerAt(piece, /^[ \t]*/.exec(piece)![0].length)?.marker ?? '',
          }
        : undefined
    text += regutter(canonical.slice(at, childStart), gutters, true) + piece
    at = childEnd
  })
  return text + regutter(canonical.slice(at, to), gutters, open)
}
