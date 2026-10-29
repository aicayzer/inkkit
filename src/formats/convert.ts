import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { Transform } from '@milkdown/kit/prose/transform'
import {
  Fragment,
  type Slice,
  type Mark,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import { serialize } from '../dialect'
import {
  InkKitError,
  formatLossCodes,
  type FormatLoss,
  type FormatLossCode,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextInline,
  type RichTextMark,
} from '../types'
import {
  InlineBuilder,
  appendText,
  canonicalMarks,
  linkProblem,
  maximumListDepth,
  maximumListStart,
} from './rich-text-model'
import { proseToRichText, richTextToProse } from './rich-text-prose'

// Conversion between Markdown and rich text. It is the one module that reads both formats; the
// rich text handler itself reaches no Markdown code.

class Losses {
  private readonly counts = new Map<FormatLossCode, number>()
  add(code: FormatLossCode): void {
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1)
  }
  list(): readonly FormatLoss[] {
    return Object.freeze(
      formatLossCodes
        .filter((code) => this.counts.has(code))
        .map((code) => Object.freeze({ code, count: this.counts.get(code)! })),
    )
  }
}

const richMarks: Readonly<Record<string, RichTextMark['type']>> = {
  strong: 'bold',
  emphasis: 'italic',
  underline: 'underline',
  strike_through: 'strikethrough',
  superscript: 'superscript',
  subscript: 'subscript',
  inlineCode: 'code',
  link: 'link',
}

const isList = (node: ProseNode) =>
  node.type.name === 'bullet_list' || node.type.name === 'ordered_list'

/** Reads a formatted Markdown document as rich text, counting what RTF cannot hold. */
class MarkdownReader {
  readonly lost = new Losses()

  /** Appends text, counting characters RTF can't hold, which become U+FFFD. */
  private append(
    builder: InlineBuilder,
    text: string,
    marks: readonly RichTextMark[],
  ): void {
    if (
      /[\u0000\ufffc]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
        text,
      )
    )
      this.lost.add('invalid-character')
    appendText(builder, text, marks)
  }

  private marks(
    marks: readonly Mark[],
    extra: readonly RichTextMark[],
  ): RichTextMark[] {
    const result: RichTextMark[] = [...extra]
    for (const mark of marks) {
      const type = richMarks[mark.type.name]
      if (!type) {
        if (mark.type.name === 'highlight') this.lost.add('highlight')
        continue
      }
      if (result.some((held) => held.type === type)) continue
      if (type === 'link') {
        const href = String(mark.attrs.href ?? '')
        if (linkProblem(href)) {
          this.lost.add('link')
          continue
        }
        result.push({ type: 'link', href })
      } else result.push({ type })
    }
    // RTF keeps no underline on a link.
    if (
      result.some((mark) => mark.type === 'link') &&
      result.some((mark) => mark.type === 'underline')
    )
      this.lost.add('link-underline')
    // The schema keeps superscript and subscript apart; a heading's bold may repeat a strong mark.
    return canonicalMarks(result)
  }

  /** Appends a textblock's inline content. */
  inline(
    node: ProseNode,
    builder: InlineBuilder,
    extra: readonly RichTextMark[] = [],
  ): void {
    node.forEach((child) => {
      const name = child.type.name
      if (child.isText)
        this.append(builder, child.text!, this.marks(child.marks, extra))
      else if (name === 'hardbreak') builder.break()
      else if (name === 'footnote_reference') {
        this.lost.add('footnote')
        this.append(
          builder,
          `[${String(child.attrs.label)}]`,
          this.marks(child.marks, extra),
        )
      } else if (name === 'inkkit_wiki_link') {
        this.lost.add('wiki-link')
        this.append(
          builder,
          String(
            child.attrs.label || child.attrs.target || child.attrs.raw || '',
          ),
          this.marks(child.marks, extra),
        )
      } else if (name === 'image') {
        this.lost.add(
          child.attrs.inkkitFileTarget || child.attrs.inkkitFileRaw
            ? 'file'
            : 'image',
        )
      } else if (name === 'comment_inline') this.lost.add('comment')
      else if (name === 'html') {
        this.lost.add('literal')
        this.append(
          builder,
          String(child.attrs.value ?? ''),
          this.marks(child.marks, extra),
        )
      } else if (child.isInline) this.inline(child, builder, extra)
    })
  }

  private paragraph(
    node: ProseNode,
    extra: readonly RichTextMark[] = [],
  ): RichTextBlock & { type: 'paragraph' } {
    const builder = new InlineBuilder()
    this.inline(node, builder, extra)
    return { type: 'paragraph', content: builder.finish() }
  }

  private lines(text: string, marks: readonly RichTextMark[]): RichTextBlock[] {
    return text.split(/\r\n|[\n\r]/).map((line) => {
      const builder = new InlineBuilder()
      this.append(builder, line, marks)
      return { type: 'paragraph', content: builder.finish() }
    })
  }

  /** The blocks for `node`, `depth` lists deep. */
  blocks(node: ProseNode, depth: number): RichTextBlock[] {
    switch (node.type.name) {
      case 'paragraph':
        return [this.paragraph(node)]
      case 'heading':
        this.lost.add('heading')
        return [this.paragraph(node, [{ type: 'bold' }])]
      case 'code_block': {
        this.lost.add(
          String(node.attrs.language).toLowerCase() === 'mermaid'
            ? 'diagram'
            : 'code-block',
        )
        return this.lines(node.textContent, [{ type: 'code' }])
      }
      case 'literal_markdown':
        this.lost.add('literal')
        return this.lines(node.textContent, [])
      case 'blockquote':
      case 'inkkit_callout': {
        this.lost.add(node.type.name === 'blockquote' ? 'quote' : 'callout')
        const blocks: RichTextBlock[] = []
        const title = node.attrs.title as string | undefined
        if (title) blocks.push(...this.lines(title, [{ type: 'bold' }]))
        node.forEach((child) => blocks.push(...this.blocks(child, depth)))
        return blocks
      }
      case 'footnote_definition': {
        this.lost.add('footnote')
        const blocks: RichTextBlock[] = []
        node.forEach((child) => blocks.push(...this.blocks(child, depth)))
        const label = `[${String(node.attrs.label)}] `
        // The label leads the note's first paragraph, as the note reads in clipboard text.
        const first = blocks[0]
        const builder = new InlineBuilder()
        builder.text(first?.type === 'paragraph' ? label : label.trim(), [])
        if (first?.type === 'paragraph') {
          for (const inline of first.content)
            if (inline.type === 'break') builder.break()
            else builder.text(inline.text, inline.marks ?? [])
          blocks[0] = { ...first, content: builder.finish() }
        } else blocks.unshift({ type: 'paragraph', content: builder.finish() })
        return blocks
      }
      case 'bullet_list':
      case 'ordered_list':
        return [this.list(node, depth + 1)]
      case 'table':
        return depth > 0 ? this.tableLines(node) : [this.table(node)]
      case 'hr':
        this.lost.add('rule')
        return []
      case 'comment_block':
        this.lost.add('comment')
        return []
      case 'image_block':
        this.lost.add(
          node.attrs.inkkitFileTarget || node.attrs.inkkitFileRaw
            ? 'file'
            : 'image',
        )
        return []
      // A reference definition shows nothing; the links that use it keep its address.
      case 'reference_definition':
        return []
      default: {
        // An unknown container gives up its text.
        if (node.isTextblock) return [this.paragraph(node)]
        const blocks: RichTextBlock[] = []
        node.forEach((child) => blocks.push(...this.blocks(child, depth)))
        return blocks
      }
    }
  }

  private table(node: ProseNode): RichTextBlock {
    let aligned = false
    const rows: { content: RichTextInline[] }[][] = []
    node.forEach((row) => {
      const cells: { content: RichTextInline[] }[] = []
      row.forEach((cell) => {
        if (cell.attrs.alignment != null) aligned = true
        const builder = new InlineBuilder()
        cell.forEach((child, _offset, index) => {
          if (index) builder.break()
          this.inline(child, builder)
        })
        cells.push({ content: builder.finish() })
      })
      rows.push(cells)
    })
    if (aligned) this.lost.add('table-alignment')
    return { type: 'table', rows }
  }

  /** A table inside a list item, as lines of tab-separated cells. */
  private tableLines(node: ProseNode): RichTextBlock[] {
    const table = this.table(node) as RichTextBlock & { type: 'table' }
    return table.rows.map((row) => {
      const builder = new InlineBuilder()
      row.forEach((cell, index) => {
        if (index) builder.text('\t', [])
        for (const inline of cell.content)
          if (inline.type === 'break') builder.break()
          else builder.text(inline.text, inline.marks ?? [])
      })
      return { type: 'paragraph', content: builder.finish() }
    })
  }

  private list(node: ProseNode, depth: number): RichTextBlock {
    const ordered = node.type.name === 'ordered_list'
    let start = Number(node.attrs.order ?? 1)
    if (ordered && !(Number.isSafeInteger(start) && start >= 1)) {
      this.lost.add('list-start')
      start = 1
    } else if (ordered && start > maximumListStart) {
      this.lost.add('list-start')
      start = maximumListStart
    }
    const items: { blocks: RichTextBlock[] }[] = []
    node.forEach((item) => {
      if (item.attrs.checked != null) this.lost.add('task')
      const builder = new InlineBuilder()
      let lines = 0
      const nested: RichTextBlock[] = []
      let flattened = false
      const line = (content: readonly RichTextInline[]) => {
        if (lines++) builder.break()
        for (const inline of content)
          if (inline.type === 'break') builder.break()
          else builder.text(inline.text, inline.marks ?? [])
      }
      const flatten = (block: RichTextBlock) => {
        if (block.type === 'paragraph') line(block.content)
        else if (block.type === 'list')
          for (const listItem of block.items) listItem.blocks.forEach(flatten)
        else
          for (const row of block.rows)
            for (const cell of row) line(cell.content)
      }
      item.forEach((child, _offset, index) => {
        if (isList(child)) {
          if (depth < maximumListDepth)
            nested.push(...this.blocks(child, depth))
          else {
            this.lost.add('list-depth')
            this.blocks(child, depth).forEach(flatten)
          }
          return
        }
        for (const block of this.blocks(child, depth)) {
          if (index === 0 && !lines && block.type === 'paragraph') {
            line(block.content)
            continue
          }
          flattened = true
          flatten(block)
        }
      })
      if (flattened) this.lost.add('list-item-blocks')
      items.push({
        blocks: [{ type: 'paragraph', content: builder.finish() }, ...nested],
      })
    })
    return ordered && start !== 1
      ? { type: 'list', ordered, start, items }
      : { type: 'list', ordered, items }
  }
}

/** A formatted Markdown document as rich text, with what RTF could not hold. */
export function markdownToRichText(doc: ProseNode): {
  document: RichTextDocument
  lost: readonly FormatLoss[]
} {
  const reader = new MarkdownReader()
  const blocks: RichTextBlock[] = []
  doc.forEach((node) => blocks.push(...reader.blocks(node, 0)))
  // The editor's one empty paragraph is an empty document.
  if (
    blocks.length === 1 &&
    blocks[0]!.type === 'paragraph' &&
    !blocks[0]!.content.length
  )
    blocks.length = 0
  return { document: { version: 1, blocks }, lost: reader.lost.list() }
}

/** A rich text document as Markdown, with what Markdown could not hold: alignment. Underline,
 *  superscript and subscript are written as `<u>`, `<sup>` and `<sub>`. */
export function richTextToMarkdown(
  ctx: Ctx,
  document: RichTextDocument,
): { text: string; lost: readonly FormatLoss[] } {
  const lost = new Losses()
  const { schema } = ctx.get(editorViewCtx).state
  const ready = markdownReady(document, lost)
  const text = serialize(ctx, htmlBreaksInCells(richTextToProse(schema, ready)))
  // The Markdown must read back as the document less its alignment, or the conversion would lose
  // something it doesn't report.
  let reread: RichTextDocument | undefined
  try {
    reread = markdownToRichText(ctx.get(parserCtx)(text)).document
  } catch {
    reread = undefined
  }
  if (!reread || !sameDocument(reread, ready))
    throw new InkKitError(
      'preservation',
      'The document could not be written as Markdown that reads back the same',
    )
  return { text, lost: lost.list() }
}

/** Marks that show on a space: moving a space out of one changes what the reader sees. */
const visibleOnSpace = new Set<RichTextMark['type']>([
  'underline',
  'strikethrough',
  'link',
])

/**
 * `content` as Markdown can write it. An emphasis, strikethrough, link or HTML mark can't start or
 * end with a space, so leading and trailing spaces move outside the run, and a run of only spaces
 * loses its marks. A code span keeps its spaces. Counts `mark-spaces` where a visible mark moved.
 */
function markdownInlines(
  content: readonly RichTextInline[],
  lost: Losses,
): RichTextInline[] {
  const builder = new InlineBuilder()
  for (const inline of content) {
    if (inline.type === 'break') {
      builder.break()
      continue
    }
    let marks = inline.marks ?? []
    // A code span of only spaces is written without its other marks, and would otherwise run
    // into a code span beside it; it keeps only its code mark.
    if (
      /^ +$/.test(inline.text) &&
      marks.some((mark) => mark.type === 'code')
    ) {
      const kept = marks.filter((mark) => mark.type === 'code')
      if (
        marks.some(
          (mark) => mark.type !== 'code' && visibleOnSpace.has(mark.type),
        )
      )
        lost.add('mark-spaces')
      marks = kept
    }
    const match = /^( *)([^]*?)( *)$/.exec(inline.text)!
    const [, lead, core, trail] = match
    if (
      !marks.length ||
      marks.some((mark) => mark.type === 'code') ||
      (!lead && !trail)
    ) {
      builder.text(inline.text, marks)
      continue
    }
    if (marks.some((mark) => visibleOnSpace.has(mark.type)))
      lost.add('mark-spaces')
    builder.text(lead!, [])
    builder.text(core!, marks)
    builder.text(trail!, [])
  }
  return builder.finish()
}

/**
 * `document` as Markdown can hold it, with what that drops counted in `lost`: alignment, a mark's
 * edge spaces, a paragraph's only line break, which Markdown reads back as an empty paragraph, and
 * empty paragraphs at the end, which Markdown doesn't keep.
 */
function markdownReady(
  document: RichTextDocument,
  lost: Losses,
): RichTextDocument {
  const block = (item: RichTextBlock): RichTextBlock => {
    if (item.type === 'paragraph') {
      if (item.align) lost.add('alignment')
      let content = markdownInlines(item.content, lost)
      if (content.length === 1 && content[0]!.type === 'break') {
        lost.add('empty-line')
        content = []
      }
      return { type: 'paragraph', content }
    }
    if (item.type === 'list')
      return {
        ...item,
        items: item.items.map((listItem) => ({
          blocks: listItem.blocks.map(block),
        })),
      }
    return {
      type: 'table',
      rows: item.rows.map((row) =>
        row.map((cell) => ({ content: markdownInlines(cell.content, lost) })),
      ),
    }
  }
  const blocks = document.blocks.map(block)
  // Markdown keeps no empty paragraph at the end of a document.
  while (
    blocks.length > 1 &&
    blocks.at(-1)!.type === 'paragraph' &&
    !(blocks.at(-1) as { content: unknown[] }).content.length
  ) {
    blocks.pop()
    lost.add('empty-line')
  }
  return { version: 1, blocks }
}

/** Whether two documents are the same, counting one empty paragraph as an empty document. */
function sameDocument(a: RichTextDocument, b: RichTextDocument): boolean {
  const text = (document: RichTextDocument) =>
    JSON.stringify(
      document.blocks.length === 1 &&
        document.blocks[0]!.type === 'paragraph' &&
        !document.blocks[0]!.content.length
        ? []
        : document.blocks,
    )
  return text(a) === text(b)
}

/** Markdown for content copied from a rich text document. Unlike a conversion it reports no
 *  losses and isn't read back: a copy may lose alignment. */
export function richContentMarkdown(ctx: Ctx, content: Slice): string {
  const { schema } = ctx.get(editorViewCtx).state
  const empty = schema.topNodeType.createAndFill()!
  let doc = new Transform(empty).replace(0, empty.content.size, content).doc
  try {
    doc = richTextToProse(
      schema,
      markdownReady(proseToRichText(doc, false), new Losses()),
    )
  } catch {
    // Content the rich text model can't read is written as it is.
  }
  return serialize(ctx, htmlBreaksInCells(doc))
}

/** `node` with each line break in a table cell written as `<br />`, since a cell is one line of
 *  Markdown. */
function htmlBreaksInCells(node: ProseNode, inCell = false): ProseNode {
  if (node.type.name === 'hardbreak')
    return inCell
      ? node.type.create({ ...node.attrs, isHTML: true }, null, node.marks)
      : node
  if (node.isLeaf) return node
  const role = node.type.spec.tableRole as string | undefined
  const cell = inCell || role === 'cell' || role === 'header_cell'
  const children: ProseNode[] = []
  node.forEach((child) => children.push(htmlBreaksInCells(child, cell)))
  return node.copy(Fragment.fromArray(children))
}
