/**
 * Typing aids for the source and TXT surfaces: bracket pairing, list continuation and indentation.
 * Each function reads the surface's text, with `\n` line endings, and the selection, and returns
 * the one replacement that makes the edit. The surface applies it, and the document's own line
 * endings are restored there.
 */

export interface SourceEdit {
  /** The range of the current text that `text` replaces. */
  from: number
  to: number
  text: string
  /** The selection after the edit, in the new text. */
  selection: { from: number; to: number }
}

export interface IndentStyle {
  indent: 'tab' | 'spaces'
  width: number
}

export const defaultIndent: IndentStyle = { indent: 'tab', width: 4 }

const closers: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
}

const closingBrackets = new Set([')', ']', '}'])

export function closerOf(opener: string): string | undefined {
  return Object.hasOwn(closers, opener) ? closers[opener] : undefined
}

export function isPairedOpener(text: string): boolean {
  return Object.hasOwn(closers, text)
}

/** Whether a quote typed after `previous` may pair. An apostrophe in a word stays single. */
export function quoteMayPair(previous: string | undefined): boolean {
  return !previous || !/[\p{L}\p{N}]/u.test(previous)
}

/** Whether a bracket or quote typed before `next` may pair: the end of a line, white space or a
 *  closing bracket. */
export function pairsBefore(next: string | undefined): boolean {
  return next === undefined || /\s/u.test(next) || closingBrackets.has(next)
}

function lastCharacter(text: string): string | undefined {
  return Array.from(text).at(-1)
}

function firstCharacter(text: string): string | undefined {
  const point = text.codePointAt(0)
  return point === undefined ? undefined : String.fromCodePoint(point)
}

/**
 * The edit for typing `typed` at the selection with pairing on: the opener and its closer with the
 * caret between them, or a selection on one line wrapped, or nothing when the character types
 * as itself.
 */
export function pairEdit(
  value: string,
  start: number,
  end: number,
  typed: string,
): SourceEdit | undefined {
  const closer = closerOf(typed)
  if (closer === undefined) return undefined
  if (start !== end) {
    const selected = value.slice(start, end)
    if (/[\r\n]/.test(selected)) return undefined
    return {
      from: start,
      to: end,
      text: typed + selected + closer,
      selection: { from: start + typed.length, to: end + typed.length },
    }
  }
  if (!pairsBefore(firstCharacter(value.slice(start, start + 2))))
    return undefined
  if (
    (typed === '"' || typed === "'") &&
    !quoteMayPair(lastCharacter(value.slice(Math.max(0, start - 2), start)))
  )
    return undefined
  const caret = start + typed.length
  return {
    from: start,
    to: start,
    text: typed + closer,
    selection: { from: caret, to: caret },
  }
}

const quotePrefix = /^(?: {0,3}>[ ]?)*/
const itemPattern =
  /^(?<indent>[ \t]*)(?<marker>[-*+]|\d{1,9}[.)])(?<gap>[ \t]+)(?<task>\[[ xX]\](?:[ \t]+|$))?/
const thematicBreak = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const fenceOpening = /^(?<fence>`{3,}|~{3,})(?<info>.*)$/
const atxHeading = /^ {0,3}#{1,6}(?:[ \t]|$)/

type LineKind = 'blank' | 'text' | 'item' | 'literal'

function columns(indent: string): number {
  let width = 0
  for (const character of indent) width += character === '\t' ? 4 : 1
  return width
}

interface Fence {
  character: string
  length: number
  depth: number
  floor: number
}

interface ListItem {
  indent: number
  depth: number
}

/**
 * What the line at `target` is: a list item, text, a blank line, or literal, which is code in a
 * fence or indented, front matter or a comment. The scan runs from the start of the text, so it
 * knows the fences, quotes and list items that enclose the line.
 */
export function lineKind(lines: readonly string[], target: number): LineKind {
  let frontMatterEnd = -1
  if (lines[0] !== undefined && /^---[ \t]*$/.test(lines[0])) {
    for (let index = 1; index < lines.length; index++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index]!)) {
        frontMatterEnd = index
        break
      }
    }
  }
  if (target <= frontMatterEnd) return 'literal'
  let fence: Fence | undefined
  let comment: '-->' | '%%' | undefined
  let items: ListItem[] = []
  let previousText = false
  for (let index = Math.max(frontMatterEnd + 1, 0); index <= target; index++) {
    const line = lines[index] ?? ''
    const prefix = quotePrefix.exec(line)![0]
    const depth = prefix.split('>').length - 1
    const rest = line.slice(prefix.length)
    const blank = rest.trim() === ''
    let kind: LineKind | undefined
    if (fence) {
      const floor = fence.floor
      const ended =
        !blank &&
        (depth < fence.depth || columns(/^[ \t]*/.exec(rest)![0]) < floor)
      if (!ended) {
        const closing = new RegExp(
          `^[ \\t]*${fence.character === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`,
        )
        if (closing.test(rest)) fence = undefined
        previousText = false
        if (index === target) return 'literal'
        continue
      }
      fence = undefined
    }
    if (comment) {
      const closed =
        comment === '-->'
          ? line.includes('-->')
          : (line.match(/%%/g)?.length ?? 0) % 2 === 1
      if (closed) comment = undefined
      previousText = false
      if (index === target) return 'literal'
      continue
    }
    if (blank) {
      previousText = false
      if (index === target) return 'blank'
      continue
    }
    const indent = columns(/^[ \t]*/.exec(rest)![0])
    items = items.filter((item) => item.depth <= depth && item.indent <= indent)
    const base = items.at(-1)?.indent ?? 0
    const relative = indent - base
    const unindented = rest.trimStart()
    const opening = relative <= 3 ? fenceOpening.exec(unindented) : null
    if (
      opening &&
      !(
        opening.groups!.fence![0] === '`' && opening.groups!.info!.includes('`')
      )
    ) {
      fence = {
        character: opening.groups!.fence![0]!,
        length: opening.groups!.fence!.length,
        depth,
        floor: base,
      }
      previousText = false
      if (index === target) return 'literal'
      continue
    }
    if (relative >= 4 && !previousText) {
      kind = 'literal'
    } else {
      const item = itemPattern.exec(rest)
      if (relative <= 3 && item && !thematicBreak.test(rest)) {
        kind = 'item'
        const content = rest.slice(
          item.groups!.indent!.length + item.groups!.marker!.length,
        )
        const gap = item.groups!.gap!
        const width = gap.length > 4 || gap === '' ? 1 : gap.length
        items.push({
          indent:
            columns(item.groups!.indent!) + item.groups!.marker!.length + width,
          depth,
        })
        const inside = content.slice(gap.length)
        const nested = fenceOpening.exec(
          (item.groups!.task
            ? inside.slice(item.groups!.task.length)
            : inside
          ).trimStart(),
        )
        if (
          nested &&
          !(
            nested.groups!.fence![0] === '`' &&
            nested.groups!.info!.includes('`')
          )
        ) {
          fence = {
            character: nested.groups!.fence![0]!,
            length: nested.groups!.fence!.length,
            depth,
            floor: items.at(-1)!.indent,
          }
          previousText = false
          if (index === target) return 'literal'
          continue
        }
      } else kind = 'text'
    }
    if (kind === 'text' || kind === 'item') {
      const open = line.lastIndexOf('<!--')
      if (open >= 0 && !line.slice(open).includes('-->')) comment = '-->'
      else if ((line.match(/%%/g)?.length ?? 0) % 2 === 1) comment = '%%'
      previousText =
        kind === 'item' || !(atxHeading.test(rest) || thematicBreak.test(rest))
    } else previousText = false
    if (index === target) return kind!
  }
  return 'text'
}

interface ItemLine {
  /** The text before the marker: quote prefix is first, then the indentation. */
  quote: string
  indent: string
  marker: string
  gap: string
  /** The task marker and the space after it, such as `[x] `. */
  task: string
  /** Where the item's own text starts in the line. */
  contentStart: number
}

function itemLine(line: string): ItemLine | undefined {
  const quote = quotePrefix.exec(line)![0]
  const rest = line.slice(quote.length)
  if (thematicBreak.test(rest)) return undefined
  const match = itemPattern.exec(rest)
  if (!match) return undefined
  return {
    quote,
    indent: match.groups!.indent!,
    marker: match.groups!.marker!,
    gap: match.groups!.gap!,
    task: match.groups!.task ?? '',
    contentStart: quote.length + match[0].length,
  }
}

function nextMarker(marker: string): string | undefined {
  const delimiter = marker.at(-1)!
  if (!/\d/.test(marker[0]!)) return marker
  const digits = marker.slice(0, -1)
  const next = String(Number(digits) + 1)
  if (next.length > 9) return undefined
  return next.padStart(digits.length, '0') + delimiter
}

function lineBounds(value: string, offset: number) {
  const from = value.lastIndexOf('\n', offset - 1) + 1
  const next = value.indexOf('\n', offset)
  return { from, to: next < 0 ? value.length : next }
}

/** The line number of `offset`, with lines split on `\n`. */
function lineNumber(value: string, offset: number): number {
  let count = 0
  for (
    let at = value.indexOf('\n');
    at >= 0 && at < offset;
    at = value.indexOf('\n', at + 1)
  )
    count++
  return count
}

/**
 * Return in a list item line: the next item with the same indentation, marker and quote prefix,
 * or nothing but the quote prefix when the item has no text. Returns undefined when the line is
 * not a list item, is code, or the caret is before the item's text, so Return adds a plain line.
 */
export function continueListEdit(
  value: string,
  start: number,
  end: number,
): SourceEdit | undefined {
  const bounds = lineBounds(value, start)
  const line = value.slice(bounds.from, bounds.to)
  const item = itemLine(line)
  if (!item) return undefined
  const column = start - bounds.from
  const empty = line.slice(item.contentStart).trim() === ''
  // Before the item's text, or at its start, Return adds a plain line.
  if (
    empty
      ? column < item.contentStart || start !== end
      : column <= item.contentStart
  )
    return undefined
  if (lineKind(value.split('\n'), lineNumber(value, start)) !== 'item')
    return undefined
  if (empty) {
    return {
      from: bounds.from,
      to: bounds.to,
      text: item.quote,
      selection: {
        from: bounds.from + item.quote.length,
        to: bounds.from + item.quote.length,
      },
    }
  }
  const marker = nextMarker(item.marker)
  if (marker === undefined) return undefined
  const task = item.task ? '[ ]' + item.task.slice(3) : ''
  const prefix = item.quote + item.indent + marker + item.gap + task
  const text = '\n' + prefix
  const caret = start + text.length
  return { from: start, to: end, text, selection: { from: caret, to: caret } }
}

export function indentUnit(style: IndentStyle): string {
  return style.indent === 'tab' ? '\t' : ' '.repeat(style.width)
}

/** The lines a Tab or Shift-Tab changes: those of the selection, not counting a last line that
 *  the selection only reaches the start of. */
function selectedLines(
  value: string,
  start: number,
  end: number,
): Array<{ from: number; to: number }> {
  const lines: Array<{ from: number; to: number }> = []
  let at = lineBounds(value, start).from
  const last =
    start === end
      ? start
      : end > start && value[end - 1] === '\n'
        ? end - 1
        : end
  for (;;) {
    const bounds = lineBounds(value, at)
    lines.push(bounds)
    if (bounds.to >= last || bounds.to >= value.length) break
    at = bounds.to + 1
  }
  return lines
}

/**
 * Tab. A caret or a selection within one line takes one indent there; on a Markdown list item
 * line the indent goes at the start of the line, so the item nests. A selection across lines
 * indents each line that has text.
 */
export function indentEdit(
  value: string,
  start: number,
  end: number,
  style: IndentStyle,
  markdown: boolean,
): SourceEdit {
  const unit = indentUnit(style)
  const lines = selectedLines(value, start, end)
  const kinds = markdown ? value.split('\n') : []
  const first = lines[0]!
  const at = (line: { from: number; to: number }) =>
    markdown
      ? line.from + quotePrefix.exec(value.slice(line.from, line.to))![0].length
      : line.from
  if (lines.length === 1 && !value.slice(start, end).includes('\n')) {
    const item =
      markdown &&
      itemLine(value.slice(first.from, first.to)) !== undefined &&
      lineKind(kinds, lineNumber(value, first.from)) === 'item'
    if (!item) {
      const caret = start + unit.length
      return {
        from: start,
        to: end,
        text: unit,
        selection: { from: caret, to: caret },
      }
    }
    const position = at(first)
    const shift = (offset: number) =>
      offset > position ? offset + unit.length : offset
    return {
      from: position,
      to: position,
      text: unit,
      selection: { from: shift(start), to: shift(end) },
    }
  }
  let text = ''
  let from = first.from
  let cursor = first.from
  const inserts: number[] = []
  for (const line of lines) {
    const content = value.slice(line.from, line.to)
    const position = at(line)
    text += value.slice(cursor, position)
    if (content.trim() !== '') {
      text += unit
      inserts.push(position)
    }
    cursor = position
  }
  text += value.slice(cursor, lines.at(-1)!.to)
  const shift = (offset: number) =>
    offset +
    inserts.filter((position) => position < offset).length * unit.length
  return {
    from,
    to: lines.at(-1)!.to,
    text,
    selection: { from: shift(start), to: shift(end) },
  }
}

/** Shift-Tab: removes one indent, a tab or up to `width` spaces, from each selected line. */
export function outdentEdit(
  value: string,
  start: number,
  end: number,
  style: IndentStyle,
  markdown: boolean,
): SourceEdit | undefined {
  const lines = selectedLines(value, start, end)
  const removals: Array<{ from: number; to: number }> = []
  for (const line of lines) {
    const content = value.slice(line.from, line.to)
    const prefix = markdown ? quotePrefix.exec(content)![0].length : 0
    const leading = content.slice(prefix)
    const removed = leading.startsWith('\t')
      ? 1
      : /^ */.exec(leading)![0].slice(0, style.width).length
    if (removed)
      removals.push({
        from: line.from + prefix,
        to: line.from + prefix + removed,
      })
  }
  if (!removals.length) return undefined
  let text = ''
  let cursor = lines[0]!.from
  for (const removal of removals) {
    text += value.slice(cursor, removal.from)
    cursor = removal.to
  }
  text += value.slice(cursor, lines.at(-1)!.to)
  const shift = (offset: number) => {
    let moved = offset
    for (const removal of removals) {
      if (offset >= removal.to) moved -= removal.to - removal.from
      else if (offset > removal.from) moved -= offset - removal.from
    }
    return moved
  }
  return {
    from: lines[0]!.from,
    to: lines.at(-1)!.to,
    text,
    selection: { from: shift(start), to: shift(end) },
  }
}
