/**
 * Typing aids for the source and TXT surfaces: bracket pairing, list continuation and indentation.
 * Each function reads the surface's text, with `\n` line endings, and the selection, and returns
 * the one replacement that makes the edit. The surface applies it, and the document's own line
 * endings are restored there.
 */

/** One replacement in the surface's text. */
export interface SourceChange {
  /** The range of the current text that `text` replaces. */
  from: number
  to: number
  text: string
}

export interface SourceEdit {
  /** The replacements, in order and apart, in offsets of the current text. Each is applied to the
   *  document's own source where it falls, so every line ending it does not touch stays as it was. */
  changes: SourceChange[]
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
      changes: [{ from: start, to: end, text: typed + selected + closer }],
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
    changes: [{ from: start, to: start, text: typed + closer }],
    selection: { from: caret, to: caret },
  }
}

const quotePrefix = /^(?: {0,3}>[ ]?)*/
const itemPattern =
  /^(?<indent>[ \t]*)(?<marker>[-*+]|\d{1,9}[.)])(?:(?<gap>[ \t]+)(?<task>\[[ xX]\](?:[ \t]+|$))?|$)/

/**
 * Where the Markdown parser puts the text's list items: the offset of the marker of each item that
 * is empty, or whose text starts on the marker's line as a paragraph, a heading or a table. An
 * item that opens with code, a quote, HTML or a rule, or whose content starts on a later line, is
 * not in the set, and neither is a line the parser reads as code, HTML, a comment or a thematic
 * break. The text is in `\n` line endings, as the surface shows it.
 */
export type ListItems = ReadonlySet<number>

/** Reads the list items when it is needed, so that text without an item line is never parsed. */
export type ItemsReader = () => ListItems

const noItems: ItemsReader = () => new Set()

interface Tree {
  type: string
  children?: Tree[]
  position?: { start: { offset?: number; line?: number } }
}

const containers = new Set(['root', 'blockquote', 'list', 'listItem'])
const itemStarts = new Set(['paragraph', 'heading', 'table'])

/** The list items of a parsed tree. `shift` is the length of a byte order mark the parser skipped. */
export function listItemsOf(tree: unknown, shift: number): ListItems {
  const items = new Set<number>()
  const visit = (node: Tree) => {
    if (node.type === 'listItem') {
      const first = node.children?.[0]
      const offset = node.position?.start.offset
      if (
        offset !== undefined &&
        (!first ||
          (itemStarts.has(first.type) &&
            first.position?.start.line === node.position?.start.line))
      )
        items.add(offset + shift)
    }
    if (containers.has(node.type)) node.children?.forEach(visit)
  }
  visit(tree as Tree)
  return items
}

/** Where the YAML or TOML front matter at the start of the text ends, or 0. */
export function frontMatterEnd(value: string): number {
  const shift = value.startsWith('\uFEFF') ? 1 : 0
  const match = /^(---|\+\+\+)\r?\n[\s\S]*?\r?\n\1(?:\r?\n|$)/.exec(
    value.slice(shift),
  )
  return match ? shift + match[0].length : 0
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
  /** Where the marker starts in the line. */
  markerAt: number
}

function itemLine(line: string): ItemLine | undefined {
  const quote = quotePrefix.exec(line)![0]
  const rest = line.slice(quote.length)
  const match = itemPattern.exec(rest)
  if (!match) return undefined
  return {
    quote,
    indent: match.groups!.indent!,
    marker: match.groups!.marker!,
    gap: match.groups!.gap ?? '',
    task: match.groups!.task ?? '',
    contentStart: quote.length + match[0].length,
    markerAt: quote.length + match.groups!.indent!.length,
  }
}

/** The item on the line that starts at `from`, when the parser reads one there. */
function itemAt(
  value: string,
  from: number,
  to: number,
  items: ItemsReader,
): ItemLine | undefined {
  const item = itemLine(value.slice(from, to))
  if (!item || from + item.markerAt < frontMatterEnd(value)) return undefined
  return items().has(from + item.markerAt) ? item : undefined
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
  const from = offset === 0 ? 0 : value.lastIndexOf('\n', offset - 1) + 1
  const next = value.indexOf('\n', offset)
  return { from, to: next < 0 ? value.length : next }
}

/**
 * Return in a list item line: the next item with the same indentation, marker and quote prefix,
 * or nothing but the quote prefix when the item has no text. Returns undefined when the parser
 * does not read the line as a list item paragraph, or the caret is before the item's text, so
 * Return adds a plain line.
 */
export function continueListEdit(
  value: string,
  start: number,
  end: number,
  items: ItemsReader = noItems,
): SourceEdit | undefined {
  const bounds = lineBounds(value, start)
  const line = value.slice(bounds.from, bounds.to)
  const item = itemAt(value, bounds.from, bounds.to, items)
  if (!item) return undefined
  const column = start - bounds.from
  const empty = line.slice(item.contentStart).trim() === ''
  // Before the item's text, or at its start, Return adds a plain line.
  if (
    empty
      ? column < item.markerAt + item.marker.length || start !== end
      : column <= item.contentStart
  )
    return undefined
  if (empty) {
    return {
      changes: [{ from: bounds.from, to: bounds.to, text: item.quote }],
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
  return {
    changes: [{ from: start, to: end, text }],
    selection: { from: caret, to: caret },
  }
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

/** Where `offset` ends up after `changes`, which are apart and in order. */
function shifted(changes: readonly SourceChange[], offset: number): number {
  let moved = offset
  for (const { from, to, text } of changes) {
    // A caret at an insertion point stays before the inserted text.
    if (to > from ? offset >= to : offset > to)
      moved += text.length - (to - from)
    else if (offset > from) moved += from + text.length - offset
  }
  return moved
}

/**
 * Tab. A caret or a selection within one line takes one indent there; on a Markdown list item
 * line the indent goes at the start of the line, so the item nests. A selection across lines
 * indents each line that has text. Each indent is its own change, so the line endings between
 * lines are not touched.
 */
export function indentEdit(
  value: string,
  start: number,
  end: number,
  style: IndentStyle,
  items: ItemsReader | undefined,
): SourceEdit {
  const unit = indentUnit(style)
  const lines = selectedLines(value, start, end)
  // Markdown has a quote prefix that an indent goes after.
  const at = (line: { from: number; to: number }) =>
    items
      ? line.from + quotePrefix.exec(value.slice(line.from, line.to))![0].length
      : line.from
  const first = lines[0]!
  if (lines.length === 1 && !value.slice(start, end).includes('\n')) {
    if (!items || !itemAt(value, first.from, first.to, items)) {
      const caret = start + unit.length
      return {
        changes: [{ from: start, to: end, text: unit }],
        selection: { from: caret, to: caret },
      }
    }
    const position = at(first)
    const changes = [{ from: position, to: position, text: unit }]
    const shift = (offset: number) =>
      offset > position ? offset + unit.length : offset
    return { changes, selection: { from: shift(start), to: shift(end) } }
  }
  const changes: SourceChange[] = []
  for (const line of lines) {
    if (value.slice(line.from, line.to).trim() === '') continue
    const position = at(line)
    changes.push({ from: position, to: position, text: unit })
  }
  return {
    changes,
    selection: {
      from: shifted(changes, start),
      to: shifted(changes, end),
    },
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
  const changes: SourceChange[] = []
  for (const line of selectedLines(value, start, end)) {
    const content = value.slice(line.from, line.to)
    const prefix = markdown ? quotePrefix.exec(content)![0].length : 0
    const leading = content.slice(prefix)
    const removed = leading.startsWith('\t')
      ? 1
      : /^ */.exec(leading)![0].slice(0, style.width).length
    if (removed)
      changes.push({
        from: line.from + prefix,
        to: line.from + prefix + removed,
        text: '',
      })
  }
  if (!changes.length) return undefined
  return {
    changes,
    selection: {
      from: shifted(changes, start),
      to: shifted(changes, end),
    },
  }
}
