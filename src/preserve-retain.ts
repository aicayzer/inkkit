import { gutterAt } from './gutter'
import { type SourceNode, type Reorder, type Neighbour } from './preserve-types'
import {
  signature,
  formatting,
  authoredNesting,
  ownShape,
  sameShape,
  inlineParents,
  spacer,
  lf,
  withEnding,
  numbered,
  literals,
  literalForms,
} from './preserve-shape'
import {
  delimiterRowEnd,
  markerAt,
  relabel,
  parentKey,
  reorderedWithin,
  renumberItem,
  authoredMarker,
  sameList,
  childGutters,
  regutter,
  canonicalSlice,
  itemMarker,
  authoredNeighbour,
  loose,
} from './preserve-list'
import { liftedSource, retainParts } from './preserve-containers'
import {
  locateChildren,
  retainRun,
  retainText,
  retainBoundaryText,
  rewrittenAddress,
} from './preserve-inline'
import { rowPipes, retainShortRow } from './preserve-table'
import { retainLiteral, holdsLiteral } from './preserve-literal'
import { PreservationError } from './preserve-error'

// Patch changed leaves so an adjacent edit retains authored delimiters and labels.
export function retainSource(
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
  afterBreak = false,
): string {
  after = authoredNesting(before, after)
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
    const gap = source.slice(
      first.position!.end.offset!,
      before.children[1]!.position!.start.offset!,
    )
    if (!/\r?\n[ \t]*\r?\n/.test(gap)) {
      const from = first.position!.start.offset! - start
      const to = before.children[1]!.position!.start.offset! - start
      // Without a separating blank line, an HTML break would absorb the
      // following block. Omit only the retained introduction and its gap.
      return retained.startsWith(source.slice(start, start + to))
        ? retained.slice(0, from) + retained.slice(to)
        : retained
    }
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
          () => [gutterAt(source, start), gutterAt(canonical, newStart)],
        ),
        lineEnding,
      ),
      canonical.slice(newStart, newEnd),
      afterBreak,
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
  // A block lifted out of a list or quote keeps its source.
  if (before.type !== after.type) {
    const lifted = liftedSource([before], after, source)
    if (lifted !== undefined) return lifted
  }
  const marker = sameList(before, after)
    ? authoredMarker(before, source)
    : undefined
  // GFM finds addresses after punctuation in a pass that gives the address
  // and the text around it no position; such children are written afresh.
  const located = (nodes: SourceNode[]) =>
    nodes.every((node) => node.position?.start.offset != null)
  if (
    before.type === after.type &&
    sameShape(before, after) &&
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
    const gutters = childGutters(before, after, source, canonical)
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
        ? regutter(
            canonical.slice(
              incoming.position!.start.offset!,
              incoming.position!.end.offset!,
            ),
            gutters,
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
                gutters,
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
              joined,
              reorder,
              after.children![index - 1]?.type === 'break',
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
    sameShape(before, after) &&
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
      const gutters = childGutters(before, after, source, canonical, !prefix)
      const inherited = itemMarker(before, source)
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
                    retainSource,
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
                    gutters,
                    suffix > 0,
                    inherited,
                  )) ??
                canonicalSlice(
                  marker,
                  changes,
                  canonical,
                  newFrom,
                  newTo,
                  previous,
                  next,
                  gutters,
                  suffix > 0,
                  inherited,
                ),
              lineEnding,
            ) +
            // An unchanged suffix can now follow a break. Keep its spelling,
            // but retain the escapes required at the new line boundary.
            (inlineParents.has(before.type)
              ? retainBoundaryText(
                  source.slice(to, last),
                  canonical.slice(newTo, newLast),
                  after.children[after.children.length - suffix - 1]?.type ===
                    'break',
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
        undefined,
        undefined,
        childGutters(before, after, source, canonical, true),
        false,
        itemMarker(before, source),
      ),
      lineEnding,
    ) + (trailing ? source.slice(lastBefore, end) : '')
  )
}
