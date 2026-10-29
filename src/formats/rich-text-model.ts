import { invalidArgument, isOmitted } from '../errors'
import type {
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
  RichTextListItem,
  RichTextMark,
  RichTextTableCell,
} from '../types'

// The rules and messages mirror `apple/Sources/InkKitRTF/Validation.swift`, so a document the
// host's converter accepts loads here, and the canonical form is the same on both sides.

/** The deepest list nesting RTF can hold (`\ilvl` 0 to 8). */
export const maximumListDepth = 9

/** Characters a run never holds: they would change the structure, stand for an attachment or end
 *  the text when RTF is written. */
const forbidden = /[\u0000\n\r\u000b\u000c\u0085\u2028\u2029\ufffc]/
const loneSurrogate =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

/** The canonical order of marks. */
export const markRank = {
  bold: 0,
  italic: 1,
  underline: 2,
  strikethrough: 3,
  superscript: 4,
  subscript: 5,
  code: 6,
  link: 7,
} as const satisfies Record<RichTextMark['type'], number>

type Path = string

function invalid(path: Path, problem: string): never {
  throw invalidArgument(`${path}: ${problem}`)
}

function record(
  value: unknown,
  path: Path,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(path, 'must be an object')
  for (const key of Object.keys(value))
    if (!keys.includes(key)) invalid(`${path}.${key}`, 'is not a known field')
  return value as Record<string, unknown>
}

function list(value: unknown, path: Path): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'must be a list')
  return value
}

function scalarName(text: string): string {
  const code = text.codePointAt(0)!.toString(16).toUpperCase()
  return `U+${code.padStart(4, '0')}`
}

/** Collects inline content in canonical form: adjacent runs with equal marks merge, and each run
 *  is NFC after merging, because joining two NFC strings can leave a sequence that composes. */
export class InlineBuilder {
  readonly content: RichTextInline[] = []
  private marksKey?: string

  text(text: string, marks: readonly RichTextMark[]): void {
    if (!text) return
    const key = JSON.stringify(marks)
    const last = this.content.at(-1)
    if (last?.type === 'text' && this.marksKey === key) {
      last.text += text
      return
    }
    this.content.push(
      marks.length
        ? { type: 'text', text, marks: [...marks] }
        : { type: 'text', text },
    )
    this.marksKey = key
  }

  break(): void {
    this.content.push({ type: 'break' })
    this.marksKey = undefined
  }

  finish(): RichTextInline[] {
    for (const inline of this.content)
      if (inline.type === 'text') inline.text = inline.text.normalize('NFC')
    return this.content
  }
}

/** Marks in canonical order. A link's run never also has underline: a link's underline is how it
 *  is drawn, so RTF readers report it on every link. */
export function canonicalMarks(marks: readonly RichTextMark[]): RichTextMark[] {
  const sorted = [...marks].sort((a, b) => markRank[a.type] - markRank[b.type])
  return sorted.some((mark) => mark.type === 'link')
    ? sorted.filter((mark) => mark.type !== 'underline')
    : sorted
}

function readMarks(value: unknown, path: Path): RichTextMark[] {
  const marks = list(value, path).map((entry, index): RichTextMark => {
    const at = `${path}[${index}]`
    const mark = record(entry, at, ['type', 'href'])
    const type = mark.type
    if (typeof type !== 'string' || !(type in markRank))
      invalid(`${at}.type`, `unknown mark type ${JSON.stringify(type)}`)
    if (type === 'link') {
      if (typeof mark.href !== 'string') invalid(`${at}.href`, 'must be text')
      return { type: 'link', href: mark.href }
    }
    if (!isOmitted(mark.href))
      invalid(`${at}.href`, 'only a link has an address')
    return { type: type as Exclude<RichTextMark['type'], 'link'> }
  })
  const sorted = [...marks].sort((a, b) => markRank[a.type] - markRank[b.type])
  const types = new Set<string>()
  for (const mark of sorted) {
    if (types.has(mark.type))
      invalid(path, `the ${mark.type} mark appears more than once`)
    types.add(mark.type)
    if (mark.type === 'link' && !mark.href)
      invalid(path, 'a link needs an address')
  }
  if (types.has('superscript') && types.has('subscript'))
    invalid(path, 'a run cannot be both superscript and subscript')
  return canonicalMarks(sorted)
}

function readInlines(value: unknown, path: Path): RichTextInline[] {
  const builder = new InlineBuilder()
  list(value, path).forEach((entry, index) => {
    const at = `${path}[${index}]`
    const inline = record(entry, at, ['type', 'text', 'marks'])
    if (inline.type === 'break') {
      if (!isOmitted(inline.text) || !isOmitted(inline.marks))
        invalid(at, 'a break holds no text or marks')
      builder.break()
      return
    }
    if (inline.type !== 'text')
      invalid(
        `${at}.type`,
        `unknown inline type ${JSON.stringify(inline.type)}`,
      )
    const text = inline.text
    if (typeof text !== 'string') invalid(`${at}.text`, 'must be text')
    if (!text) invalid(`${at}.text`, 'a text run cannot be empty')
    const bad = forbidden.exec(text)
    if (bad) invalid(`${at}.text`, `text cannot hold ${scalarName(bad[0])}`)
    if (loneSurrogate.test(text))
      invalid(`${at}.text`, 'text cannot hold a lone surrogate')
    builder.text(
      text,
      isOmitted(inline.marks) ? [] : readMarks(inline.marks, `${at}.marks`),
    )
  })
  return builder.finish()
}

function readBlock(
  value: unknown,
  path: Path,
  listDepth: number,
): RichTextBlock {
  const block = record(value, path, [
    'type',
    'align',
    'content',
    'ordered',
    'start',
    'items',
    'rows',
  ])
  const only = (...keys: string[]) => {
    for (const key of Object.keys(block))
      if (key !== 'type' && !keys.includes(key))
        invalid(`${path}.${key}`, `a ${String(block.type)} has no ${key}`)
  }
  switch (block.type) {
    case 'paragraph': {
      only('align', 'content')
      const align = block.align
      if (
        !isOmitted(align) &&
        align !== 'center' &&
        align !== 'right' &&
        align !== 'justify'
      )
        invalid(`${path}.align`, 'must be center, right or justify')
      const content = readInlines(block.content, `${path}.content`)
      return isOmitted(align)
        ? { type: 'paragraph', content }
        : { type: 'paragraph', align, content }
    }
    case 'list':
      only('ordered', 'start', 'items')
      return readList(block, path, listDepth + 1)
    case 'table': {
      only('rows')
      if (listDepth > 0) invalid(path, 'a table cannot be inside a list item')
      const rows = list(block.rows, `${path}.rows`)
      if (!rows.length)
        invalid(`${path}.rows`, 'a table needs at least one row')
      const width = list(rows[0], `${path}.rows[0]`).length
      if (!width)
        invalid(`${path}.rows[0]`, 'a table row needs at least one cell')
      return {
        type: 'table',
        rows: rows.map((row, rowIndex) => {
          const at = `${path}.rows[${rowIndex}]`
          const cells = list(row, at)
          if (cells.length !== width)
            invalid(
              at,
              `the row has ${cells.length} cells, but the first row has ${width}`,
            )
          return cells.map((cell, cellIndex): RichTextTableCell => {
            const cellPath = `${at}[${cellIndex}]`
            const content = record(cell, cellPath, ['content']).content
            return { content: readInlines(content, `${cellPath}.content`) }
          })
        }),
      }
    }
    default:
      invalid(
        `${path}.type`,
        `unknown block type ${JSON.stringify(block.type)}`,
      )
  }
}

function readList(
  block: Record<string, unknown>,
  path: Path,
  depth: number,
): RichTextBlock {
  if (depth > maximumListDepth)
    invalid(path, `lists nest deeper than ${maximumListDepth} levels`)
  if (typeof block.ordered !== 'boolean')
    invalid(`${path}.ordered`, 'must be true or false')
  let start: number | undefined
  if (!isOmitted(block.start)) {
    if (!block.ordered)
      invalid(`${path}.start`, 'only an ordered list has a start')
    if (!Number.isSafeInteger(block.start))
      invalid(`${path}.start`, 'must be a whole number')
    if ((block.start as number) < 1)
      invalid(`${path}.start`, 'the start must be at least 1')
    if (block.start !== 1) start = block.start as number
  }
  const entries = list(block.items, `${path}.items`)
  if (!entries.length)
    invalid(`${path}.items`, 'a list needs at least one item')
  const items = entries.map((entry, itemIndex): RichTextListItem => {
    const at = `${path}.items[${itemIndex}]`
    const blocks = list(record(entry, at, ['blocks']).blocks, `${at}.blocks`)
    const first = blocks[0] as { type?: unknown } | undefined
    if (!first || typeof first !== 'object' || first.type !== 'paragraph')
      invalid(`${at}.blocks[0]`, 'a list item must start with a paragraph')
    return {
      blocks: blocks.map((child, blockIndex) => {
        const childPath = `${at}.blocks[${blockIndex}]`
        if (
          blockIndex > 0 &&
          (!child ||
            typeof child !== 'object' ||
            (child as { type?: unknown }).type !== 'list')
        )
          invalid(
            childPath,
            'after its paragraph, a list item can hold only lists',
          )
        return readBlock(child, childPath, depth)
      }),
    }
  })
  return start === undefined
    ? { type: 'list', ordered: block.ordered, items }
    : { type: 'list', ordered: block.ordered, start, items }
}

/**
 * Checks `value` as a version 1 document and returns its canonical form: marks sorted, a link's
 * underline removed, adjacent equal runs merged, runs in NFC, and `start` of 1 left out. Throws
 * `invalid-argument` naming the first problem, under `path`.
 */
export function readRichTextDocument(
  value: unknown,
  path: Path,
): RichTextDocument {
  const document = record(value, path, ['version', 'blocks'])
  if (document.version !== 1)
    invalid(
      `${path}.version`,
      `version ${JSON.stringify(document.version)} is not supported; the version must be 1`,
    )
  const blocks = list(document.blocks, `${path}.blocks`).map((block, index) =>
    readBlock(block, `${path}.blocks[${index}]`, 0),
  )
  return { version: 1, blocks }
}

/** The text that stands for a canonical document inside the editor: its JSON. Two documents are
 *  the same exactly when their texts are. */
export function richTextText(document: RichTextDocument): string {
  return JSON.stringify(document)
}

/** The document a text from `richTextText` stands for, as a new object. */
export function richTextFromText(text: string): RichTextDocument {
  return JSON.parse(text) as RichTextDocument
}

/** Text from outside a document, such as a paste or another format, as canonical runs: a line or
 *  paragraph separator inside a paragraph becomes a line break, and characters RTF cannot hold as
 *  text become U+FFFD, so that no character disappears. */
export function appendText(
  builder: InlineBuilder,
  text: string,
  marks: readonly RichTextMark[],
): void {
  const lines = text
    .replace(/[\u0000\ufffc]/g, '\ufffd')
    .replace(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      '\ufffd',
    )
    .split(/\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/)
  lines.forEach((line, index) => {
    if (index) builder.break()
    builder.text(line, marks)
  })
}

/** Plain text as paragraphs, as the host's `RichTextDocument(plainText:)` reads it: each line is a
 *  paragraph, and a final line ending adds none. */
export function plainTextBlocks(text: string): RichTextBlock[] {
  const blocks: RichTextBlock[] = []
  const lines = text.split(/\r\n|[\n\r\u000c\u0085\u2029]/)
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  if (text === '') return blocks
  for (const line of lines) {
    const builder = new InlineBuilder()
    appendText(builder, line, [])
    blocks.push({ type: 'paragraph', content: builder.finish() })
  }
  return blocks
}
