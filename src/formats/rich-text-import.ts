import { Fragment, Slice } from '@milkdown/kit/prose/model'
import type { EditorState } from '@milkdown/kit/prose/state'
import { isSafeLinkTarget } from '../link-safety'
import type {
  ClipboardInput,
  RichTextBlock,
  RichTextInline,
  RichTextMark,
} from '../types'
import {
  InlineBuilder,
  appendText,
  canonicalMarks,
  maximumListDepth,
  plainTextBlocks,
} from './rich-text-model'
import { proseBlock } from './rich-text-prose'

// Pasted HTML becomes what an RTF document can hold: paragraphs, lists, tables, line breaks and
// the eight marks. Headings become bold paragraphs, as RTF writes them; code blocks become
// paragraphs in code; quotes and other containers give up their paragraphs; images, rules and
// anything else that shows no text are left out. The HTML is read with `DOMParser`, whose
// document runs no script and loads nothing, and only text and the recognised structure leave it.

const skipped = new Set([
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'SVG',
  'MATH',
  'IMG',
  'PICTURE',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'HR',
])

const blockTags = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'BODY',
  'CENTER',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HTML',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'UL',
])

type Marks = readonly RichTextMark[]

function withMark(marks: Marks, mark: RichTextMark): Marks {
  if (marks.some((held) => held.type === mark.type)) return marks
  // A run cannot be both; the inner one wins.
  const other =
    mark.type === 'superscript'
      ? 'subscript'
      : mark.type === 'subscript'
        ? 'superscript'
        : ''
  return canonicalMarks([...marks.filter((held) => held.type !== other), mark])
}

function withoutMark(marks: Marks, type: RichTextMark['type']): Marks {
  return marks.filter((mark) => mark.type !== type)
}

/** The marks an element adds to its text, from its tag and its inline style. */
function elementMarks(
  element: Element,
  marks: Marks,
  schemes: ReadonlySet<string>,
): Marks {
  const tag = element.tagName
  if (tag === 'B' || tag === 'STRONG') marks = withMark(marks, { type: 'bold' })
  if (
    tag === 'I' ||
    tag === 'EM' ||
    tag === 'CITE' ||
    tag === 'DFN' ||
    tag === 'VAR'
  )
    marks = withMark(marks, { type: 'italic' })
  if (tag === 'U' || tag === 'INS')
    marks = withMark(marks, { type: 'underline' })
  if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE')
    marks = withMark(marks, { type: 'strikethrough' })
  if (tag === 'SUP') marks = withMark(marks, { type: 'superscript' })
  if (tag === 'SUB') marks = withMark(marks, { type: 'subscript' })
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT')
    marks = withMark(marks, { type: 'code' })
  if (tag === 'A') {
    const href = element.getAttribute('href')?.trim()
    // An address that is unsafe or empty keeps its text without the link.
    if (href && isSafeLinkTarget(href, schemes))
      marks = withMark(withoutMark(marks, 'link'), { type: 'link', href })
  }
  const style = element instanceof HTMLElement ? element.style : undefined
  if (style) {
    const weight = style.fontWeight
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600)
      marks = withMark(marks, { type: 'bold' })
    else if (weight === 'normal' || (weight && Number(weight) < 600))
      marks = withoutMark(marks, 'bold')
    if (style.fontStyle === 'italic' || style.fontStyle === 'oblique')
      marks = withMark(marks, { type: 'italic' })
    else if (style.fontStyle === 'normal') marks = withoutMark(marks, 'italic')
    const decoration = `${style.textDecoration} ${style.textDecorationLine}`
    if (/underline/.test(decoration))
      marks = withMark(marks, { type: 'underline' })
    if (/line-through/.test(decoration))
      marks = withMark(marks, { type: 'strikethrough' })
    if (style.verticalAlign === 'super')
      marks = withMark(marks, { type: 'superscript' })
    if (style.verticalAlign === 'sub')
      marks = withMark(marks, { type: 'subscript' })
  }
  return canonicalMarks(marks)
}

function alignment(
  element: Element,
): 'center' | 'right' | 'justify' | undefined {
  const value =
    (element instanceof HTMLElement ? element.style.textAlign : '') ||
    element.getAttribute('align') ||
    (element.tagName === 'CENTER' ? 'center' : '')
  return value === 'center' || value === 'right' || value === 'justify'
    ? value
    : undefined
}

/** Reads blocks from a DOM, the way a person reads the page. */
class Reader {
  readonly blocks: RichTextBlock[] = []
  private inline?: InlineBuilder
  private align?: 'center' | 'right' | 'justify'
  // Whitespace that collapsed at the end of the paragraph so far, written only if text follows.
  private space?: Marks

  constructor(
    private readonly schemes: ReadonlySet<string>,
    private readonly depth: number,
  ) {}

  /** Ends the open paragraph, if any. */
  flush(): void {
    if (!this.inline) return
    const content = this.inline.finish()
    this.blocks.push(
      this.align
        ? { type: 'paragraph', align: this.align, content }
        : { type: 'paragraph', content },
    )
    this.inline = undefined
    this.align = undefined
    this.space = undefined
  }

  private open(): InlineBuilder {
    this.inline ??= new InlineBuilder()
    return this.inline
  }

  text(value: string, marks: Marks, pre: boolean): void {
    if (pre) {
      value.split(/\r\n|[\n\r]/).forEach((line, index) => {
        if (index) this.flush()
        appendText(this.open(), line, marks)
      })
      return
    }
    const collapsed = value.replace(/[ \t\n\r\f]+/g, ' ')
    if (!collapsed) return
    const builder = this.open()
    const empty = !builder.content.length
    let text = collapsed
    if (text.startsWith(' ')) {
      if (!empty) this.space ??= marks
      text = text.slice(1)
    }
    if (!text) return
    if (this.space) {
      builder.text(' ', this.space)
      this.space = undefined
    }
    if (text.endsWith(' ')) {
      this.space = marks
      text = text.slice(0, -1)
    }
    appendText(builder, text, marks)
  }

  lineBreak(): void {
    this.space = undefined
    this.open().break()
  }

  /** Starts a paragraph that takes `element`'s alignment. */
  paragraph(element: Element): void {
    this.flush()
    this.align = alignment(element)
  }

  push(block: RichTextBlock): void {
    this.flush()
    this.blocks.push(block)
  }

  read(node: Node, marks: Marks, pre: boolean): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.text(node.textContent ?? '', marks, pre)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    const tag = element.tagName.toUpperCase()
    if (skipped.has(tag) || (element instanceof HTMLElement && element.hidden))
      return
    if (element instanceof HTMLElement && element.style.display === 'none')
      return
    if (tag === 'BR') {
      this.lineBreak()
      return
    }
    if (tag === 'UL' || tag === 'OL') {
      this.push(this.list(element, marks))
      return
    }
    if (tag === 'TABLE') {
      const rows = tableRows(element, marks, this.schemes)
      if (!rows.length) return
      if (this.depth === 0) this.push({ type: 'table', rows })
      // A list item cannot hold a table: each row is a line of tab-separated cells.
      else
        for (const row of rows) {
          this.paragraph(element)
          row.forEach((cell, index) => {
            if (index) this.open().text('\t', [])
            for (const inline of cell.content)
              if (inline.type === 'break') this.open().break()
              else this.open().text(inline.text, inline.marks ?? [])
          })
          this.flush()
        }
      return
    }
    let inner = elementMarks(element, marks, this.schemes)
    if (/^H[1-6]$/.test(tag)) inner = withMark(inner, { type: 'bold' })
    const block = blockTags.has(tag)
    if (block) this.paragraph(element)
    const preformatted =
      pre ||
      tag === 'PRE' ||
      (element instanceof HTMLElement && /^pre/.test(element.style.whiteSpace))
    if (tag === 'PRE') inner = withMark(inner, { type: 'code' })
    for (const child of element.childNodes)
      this.read(child, inner, preformatted)
    if (block) this.flush()
  }

  private list(element: Element, marks: Marks): RichTextBlock {
    const ordered = element.tagName.toUpperCase() === 'OL'
    const start = Number(element.getAttribute('start') ?? 1)
    const items: { blocks: RichTextBlock[] }[] = []
    const inner = elementMarks(element, marks, this.schemes)
    for (const child of element.childNodes) {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child as Element).tagName.toUpperCase() === 'LI'
      ) {
        items.push({ blocks: this.item(child as Element, inner) })
        continue
      }
      // Text or a nested list outside an item belongs to the previous item, or starts one.
      const reader = new Reader(this.schemes, this.depth + 1)
      reader.read(child, inner, false)
      reader.flush()
      if (!reader.blocks.length) continue
      const blocks = itemBlocks(reader.blocks, this.depth + 1)
      if (
        items.length &&
        blocks[0]!.type === 'paragraph' &&
        !(blocks[0] as { content: unknown[] }).content.length
      )
        items.at(-1)!.blocks.push(...blocks.slice(1))
      else items.push({ blocks })
    }
    if (!items.length)
      items.push({ blocks: [{ type: 'paragraph', content: [] }] })
    return ordered && Number.isSafeInteger(start) && start > 1
      ? { type: 'list', ordered, start, items }
      : { type: 'list', ordered, items }
  }

  private item(element: Element, marks: Marks): RichTextBlock[] {
    const reader = new Reader(this.schemes, this.depth + 1)
    const inner = elementMarks(element, marks, this.schemes)
    for (const child of element.childNodes) reader.read(child, inner, false)
    reader.flush()
    return itemBlocks(reader.blocks, this.depth + 1)
  }
}

/** A list item's blocks as RTF holds them: one paragraph, then lists. Further paragraphs join the
 *  first as lines, and lists deeper than RTF can hold give their items as lines too. */
function itemBlocks(
  blocks: readonly RichTextBlock[],
  depth: number,
): RichTextBlock[] {
  const builder = new InlineBuilder()
  let align: 'center' | 'right' | 'justify' | undefined
  let lines = 0
  const nested: RichTextBlock[] = []
  const line = (content: readonly RichTextInline[]) => {
    if (lines++) builder.break()
    for (const inline of content)
      if (inline.type === 'break') builder.break()
      else builder.text(inline.text, inline.marks ?? [])
  }
  const flatten = (block: RichTextBlock) => {
    if (block.type === 'paragraph') line(block.content)
    else if (block.type === 'list')
      for (const item of block.items)
        for (const child of item.blocks) flatten(child)
    else
      for (const row of block.rows) for (const cell of row) line(cell.content)
  }
  for (const block of blocks) {
    if (block.type === 'list' && depth < maximumListDepth) nested.push(block)
    else if (block.type === 'paragraph' && !nested.length) {
      if (!lines) align = block.align
      line(block.content)
    } else if (
      block.type === 'paragraph' ||
      block.type === 'table' ||
      block.type === 'list'
    ) {
      // Text after a nested list starts a line of the item's paragraph too.
      flatten(block)
    }
  }
  const content = builder.finish()
  return [
    align
      ? { type: 'paragraph', align, content }
      : { type: 'paragraph', content },
    ...nested,
  ]
}

function tableRows(
  table: Element,
  marks: Marks,
  schemes: ReadonlySet<string>,
): { content: RichTextInline[] }[][] {
  const rows: { content: RichTextInline[] }[][] = []
  for (const row of table.querySelectorAll('tr')) {
    // Only this table's rows; a nested table's rows read as its cell's text.
    if (row.closest('table') !== table) continue
    const cells: { content: RichTextInline[] }[] = []
    for (const cell of row.children) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue
      const reader = new Reader(schemes, 1)
      // A header cell is drawn bold, but its text carries no mark of its own.
      const inner = elementMarks(cell, marks, schemes)
      for (const child of cell.childNodes) reader.read(child, inner, false)
      reader.flush()
      const builder = new InlineBuilder()
      let lines = 0
      const add = (block: RichTextBlock) => {
        if (block.type === 'paragraph') {
          if (lines++) builder.break()
          for (const inline of block.content)
            if (inline.type === 'break') builder.break()
            else builder.text(inline.text, inline.marks ?? [])
        } else if (block.type === 'list')
          for (const item of block.items) item.blocks.forEach(add)
        else
          for (const nestedRow of block.rows)
            for (const nestedCell of nestedRow)
              add({ type: 'paragraph', content: nestedCell.content })
      }
      reader.blocks.forEach(add)
      const content = builder.finish()
      // A merged cell keeps its text in its first place; the places it covered are empty.
      const span = Math.max(
        1,
        Math.min(100, Number(cell.getAttribute('colspan') ?? 1) || 1),
      )
      cells.push({ content })
      for (let index = 1; index < span; index++) cells.push({ content: [] })
    }
    if (cells.length) rows.push(cells)
  }
  const width = Math.max(0, ...rows.map((row) => row.length))
  for (const row of rows) while (row.length < width) row.push({ content: [] })
  return rows
}

/** Blocks for pasted HTML. */
export function htmlBlocks(
  html: string,
  schemes: ReadonlySet<string>,
): RichTextBlock[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const reader = new Reader(schemes, 0)
  reader.read(parsed.body, [], false)
  reader.flush()
  return reader.blocks
}

// ---------------------------------------------------------------------------
// The slice a paste inserts

/** Every block's text as lines of one paragraph, for a place that holds only one, such as a
 *  table cell. */
function asLines(blocks: readonly RichTextBlock[]): RichTextBlock[] {
  const builder = new InlineBuilder()
  let lines = 0
  const add = (content: readonly RichTextInline[]) => {
    if (lines++) builder.break()
    for (const inline of content)
      if (inline.type === 'break') builder.break()
      else builder.text(inline.text, inline.marks ?? [])
  }
  const visit = (block: RichTextBlock) => {
    if (block.type === 'paragraph') add(block.content)
    else if (block.type === 'list')
      block.items.forEach((item) => item.blocks.forEach(visit))
    else
      block.rows.forEach((row) =>
        add(
          row.flatMap((cell, index) =>
            index
              ? [{ type: 'text' as const, text: '\t' }, ...cell.content]
              : cell.content,
          ),
        ),
      )
  }
  blocks.forEach(visit)
  return [{ type: 'paragraph', content: builder.finish() }]
}

/**
 * The slice that `input` pastes into an RTF document at the selection. Explicit Markdown pastes as
 * its text, unparsed; HTML keeps what RTF can hold; plain text gives a paragraph for each line.
 * Plain text takes the marks of the text it replaces, as typing would.
 */
export function richTextPaste(
  input: ClipboardInput,
  state: EditorState,
  schemes: ReadonlySet<string>,
): Slice {
  const { schema, selection } = state
  const { $from, $to } = selection
  const html =
    input.markdown == null && input.html
      ? htmlBlocks(input.html, schemes)
      : undefined
  const plain = html == null
  let blocks = html ?? plainTextBlocks(input.markdown ?? input.text)
  if (
    html &&
    !blocks.some((block) => block.type !== 'paragraph' || block.content.length)
  )
    blocks = plainTextBlocks(input.text)
  let cell = false
  let lists = 0
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name
    if (name === 'table_cell' || name === 'table_header') cell = true
    if (name === 'bullet_list' || name === 'ordered_list') lists++
  }
  if (cell) blocks = asLines(blocks)
  else if (lists)
    blocks = blocks.flatMap((block): RichTextBlock[] => {
      if (block.type === 'table') return asLines([block])
      if (block.type === 'list' && lists + 1 > maximumListDepth)
        return asLines([block])
      return [block]
    })
  // Typed text takes the marks around it, but not a link, which ends where its text ends.
  const marks = plain
    ? ($from.marksAcross($to) ?? $from.marks()).filter(
        (mark) => mark.type.name !== 'link',
      )
    : []
  const nodes = blocks.map((block) => proseBlock(schema, block, marks))
  if (!nodes.length) return Slice.empty
  // Paragraphs at either end join the text around the selection.
  const openStart = nodes[0]!.type.name === 'paragraph' ? 1 : 0
  const openEnd = nodes.at(-1)!.type.name === 'paragraph' ? 1 : 0
  return new Slice(Fragment.fromArray(nodes), openStart, openEnd)
}
