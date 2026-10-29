import type { Mark, Node as ProseNode, Schema } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import {
  InkKitError,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextInline,
  type RichTextMark,
} from '../types'
import {
  InlineBuilder,
  canonicalMarks,
  maximumListDepth,
} from './rich-text-model'

// The mapping between rich text and the editor's shared schema, in both directions.

/** Editor marks by rich text mark, in canonical order. */
const markNames = {
  bold: 'strong',
  italic: 'emphasis',
  underline: 'underline',
  strikethrough: 'strike_through',
  superscript: 'superscript',
  subscript: 'subscript',
  code: 'inlineCode',
  link: 'link',
} as const satisfies Record<RichTextMark['type'], string>

const richMarks: Readonly<Record<string, RichTextMark['type']>> =
  Object.fromEntries(
    Object.entries(markNames).map(([rich, name]) => [name, rich]),
  ) as Record<string, RichTextMark['type']>

/** The editor nodes an RTF document can hold. */
const allowedNodes = new Set([
  'doc',
  'paragraph',
  'text',
  'hardbreak',
  'bullet_list',
  'ordered_list',
  'list_item',
  'table',
  'table_header_row',
  'table_row',
  'table_header',
  'table_cell',
])

function unrepresentable(what: string): InkKitError {
  return new InkKitError(
    'preservation',
    `The document holds ${what}, which an RTF document cannot hold`,
  )
}

// ---------------------------------------------------------------------------
// Rich text to the editor

function proseMarks(
  schema: Schema,
  marks: readonly RichTextMark[] = [],
): Mark[] {
  return marks.map((mark) =>
    mark.type === 'link'
      ? schema.marks.link!.create({ href: mark.href })
      : schema.marks[markNames[mark.type]]!.create(),
  )
}

function proseInlines(
  schema: Schema,
  content: readonly RichTextInline[],
  around: readonly Mark[],
): ProseNode[] {
  return content.map((inline) => {
    if (inline.type === 'break')
      return schema.nodes.hardbreak!.create({ isInline: false, isHTML: false })
    let marks: Mark[] = [...around]
    for (const mark of proseMarks(schema, inline.marks))
      marks = mark.addToSet(marks) as Mark[]
    return schema.text(inline.text, marks)
  })
}

function proseParagraph(
  schema: Schema,
  content: readonly RichTextInline[],
  around: readonly Mark[],
  align: string | null = null,
): ProseNode {
  return schema.nodes.paragraph!.create(
    { align },
    proseInlines(schema, content, around),
  )
}

/** The editor block for a rich text block. Its text also takes `around`, the marks of text that a
 *  paste replaces. */
export function proseBlock(
  schema: Schema,
  block: RichTextBlock,
  around: readonly Mark[] = [],
): ProseNode {
  switch (block.type) {
    case 'paragraph':
      return proseParagraph(schema, block.content, around, block.align ?? null)
    case 'list': {
      const start = block.start ?? 1
      const items = block.items.map((item, index) =>
        schema.nodes.list_item!.create(
          {
            label: block.ordered ? `${start + index}.` : '•',
            listType: block.ordered ? 'ordered' : 'bullet',
            spread: false,
            checked: null,
          },
          item.blocks.map((child) => proseBlock(schema, child, around)),
        ),
      )
      return block.ordered
        ? schema.nodes.ordered_list!.create(
            { order: start, spread: false },
            items,
          )
        : schema.nodes.bullet_list!.create({ spread: false }, items)
    }
    case 'table': {
      // Inkkit's table always opens with a header row; the first RTF row becomes it, and it is
      // written back as the first row.
      const row = (cells: RichTextBlock & { type: 'table' }, index: number) => {
        const header = index === 0
        return schema.nodes[header ? 'table_header_row' : 'table_row']!.create(
          null,
          cells.rows[index]!.map((cell) =>
            schema.nodes[header ? 'table_header' : 'table_cell']!.create(
              { alignment: null },
              proseParagraph(schema, cell.content, around),
            ),
          ),
        )
      }
      return schema.nodes.table!.create(
        null,
        block.rows.map((_, index) => row(block, index)),
      )
    }
  }
}

/** The editor document for a canonical rich text document. */
export function richTextToProse(
  schema: Schema,
  document: RichTextDocument,
): ProseNode {
  const blocks = document.blocks.map((block) => proseBlock(schema, block))
  // The editor always holds at least one block.
  if (!blocks.length) blocks.push(proseParagraph(schema, [], []))
  return schema.topNodeType.create(null, blocks)
}

// ---------------------------------------------------------------------------
// The editor to rich text

function richMarksOf(marks: readonly Mark[]): RichTextMark[] {
  const result: RichTextMark[] = []
  for (const mark of marks) {
    const type = richMarks[mark.type.name]
    if (!type) throw unrepresentable(`the ${mark.type.name} mark`)
    result.push(
      type === 'link'
        ? { type: 'link', href: String(mark.attrs.href ?? '') }
        : { type },
    )
  }
  return canonicalMarks(result)
}

const forbiddenText = /[\u0000\n\r\u000b\u000c\u0085\u2028\u2029\ufffc]/

function richInlines(node: ProseNode): RichTextInline[] {
  const builder = new InlineBuilder()
  node.forEach((child) => {
    if (child.type.name === 'hardbreak') builder.break()
    else if (child.isText) {
      const text = child.text!
      if (forbiddenText.test(text))
        throw unrepresentable('a separator in its text')
      const marks = richMarksOf(child.marks)
      if (marks.some((mark) => mark.type === 'link' && !mark.href))
        throw unrepresentable('a link without an address')
      builder.text(text, marks)
    } else throw unrepresentable(`a ${child.type.name}`)
  })
  return builder.finish()
}

function richParagraph(node: ProseNode, aligned: boolean): RichTextBlock {
  if (node.type.name !== 'paragraph')
    throw unrepresentable(`a ${node.type.name}`)
  const align = node.attrs.align as string | null
  if (align != null && !aligned) throw unrepresentable('an aligned table cell')
  if (
    align != null &&
    align !== 'center' &&
    align !== 'right' &&
    align !== 'justify'
  )
    throw unrepresentable(`${align} alignment`)
  const content = richInlines(node)
  return align == null
    ? { type: 'paragraph', content }
    : { type: 'paragraph', align, content }
}

function richBlock(node: ProseNode, listDepth: number): RichTextBlock {
  switch (node.type.name) {
    case 'paragraph':
      return richParagraph(node, true)
    case 'bullet_list':
    case 'ordered_list': {
      const depth = listDepth + 1
      if (depth > maximumListDepth)
        throw unrepresentable(`lists deeper than ${maximumListDepth} levels`)
      const ordered = node.type.name === 'ordered_list'
      const items: { blocks: RichTextBlock[] }[] = []
      node.forEach((item) => {
        if (item.type.name !== 'list_item')
          throw unrepresentable(`a ${item.type.name}`)
        if (item.attrs.checked != null) throw unrepresentable('a task')
        const blocks: RichTextBlock[] = []
        item.forEach((child, _offset, index) => {
          if (index === 0) blocks.push(richParagraph(child, true))
          else if (/^(bullet|ordered)_list$/.test(child.type.name))
            blocks.push(richBlock(child, depth))
          else throw unrepresentable(`a ${child.type.name} in a list item`)
        })
        items.push({ blocks })
      })
      const start = Number(node.attrs.order ?? 1)
      if (ordered && (!Number.isSafeInteger(start) || start < 1))
        throw unrepresentable('a list that starts below 1')
      return ordered && start !== 1
        ? { type: 'list', ordered, start, items }
        : { type: 'list', ordered, items }
    }
    case 'table': {
      if (listDepth > 0) throw unrepresentable('a table in a list')
      const rows: { content: RichTextInline[] }[][] = []
      node.forEach((row) => {
        const cells: { content: RichTextInline[] }[] = []
        row.forEach((cell) => {
          if (
            cell.attrs.alignment != null ||
            Number(cell.attrs.colspan ?? 1) !== 1 ||
            Number(cell.attrs.rowspan ?? 1) !== 1
          )
            throw unrepresentable('an aligned or merged table cell')
          if (cell.childCount !== 1)
            throw unrepresentable('a cell of several blocks')
          const paragraph = richParagraph(cell.firstChild!, false)
          cells.push({
            content: (paragraph as { content: RichTextInline[] }).content,
          })
        })
        rows.push(cells)
      })
      if (
        !rows.length ||
        !rows[0]!.length ||
        rows.some((row) => row.length !== rows[0]!.length)
      )
        throw unrepresentable('a table with uneven rows')
      return { type: 'table', rows }
    }
    default:
      throw unrepresentable(`a ${node.type.name}`)
  }
}

/** The canonical rich text document for an editor document. Throws `preservation` when the
 *  document holds something RTF cannot. The editor always holds a block, so its one empty
 *  paragraph is an empty document when `emptyAsNone`, as it is when the document loaded empty. */
export function proseToRichText(
  doc: ProseNode,
  emptyAsNone = true,
): RichTextDocument {
  const blocks: RichTextBlock[] = []
  doc.forEach((node) => blocks.push(richBlock(node, 0)))
  if (
    emptyAsNone &&
    blocks.length === 1 &&
    blocks[0]!.type === 'paragraph' &&
    !blocks[0]!.align &&
    !blocks[0]!.content.length
  )
    blocks.length = 0
  return { version: 1, blocks }
}

// ---------------------------------------------------------------------------
// What an edit may introduce

/** Why `node` cannot be in an RTF document at `$depth` lists deep, or undefined. Checks the node
 *  itself and its direct children, not its descendants. */
function refusal(
  node: ProseNode,
  listDepth: number,
  inCell: boolean,
): string | undefined {
  const name = node.type.name
  if (!allowedNodes.has(name)) return name
  for (const mark of node.marks)
    if (!richMarks[mark.type.name]) return mark.type.name
  if (node.isText && forbiddenText.test(node.text!)) return 'a separator'
  if (name === 'paragraph' && node.attrs.align != null && inCell)
    return 'aligned cell'
  if (name === 'list_item') {
    if (node.attrs.checked != null) return 'task'
    for (let index = 1; index < node.childCount; index++)
      if (!/^(bullet|ordered)_list$/.test(node.child(index).type.name))
        return 'list item block'
  }
  if (
    (name === 'bullet_list' || name === 'ordered_list') &&
    listDepth > maximumListDepth
  )
    return 'list depth'
  if (name === 'ordered_list' && !(Number(node.attrs.order) >= 1))
    return 'list start'
  if (name === 'table' && listDepth > 0) return 'table in list'
  if (
    (name === 'table_cell' || name === 'table_header') &&
    (node.attrs.alignment != null ||
      Number(node.attrs.colspan ?? 1) !== 1 ||
      Number(node.attrs.rowspan ?? 1) !== 1)
  )
    return 'cell'
  return undefined
}

/** Whether the document a transaction reaches holds only what RTF can, read in the part it
 *  changed and that part's ancestors. */
export function richTextAllows(tr: Transaction, before: EditorState): boolean {
  if (!tr.docChanged) return true
  const doc = tr.doc
  const start = before.doc.content.findDiffStart(doc.content)
  if (start == null) return true
  const end = before.doc.content.findDiffEnd(doc.content)
  const to = Math.max(start, end?.b ?? doc.content.size)
  let allowed = true
  const $start = doc.resolve(start)
  // Ancestors of the change, whose children it may have changed.
  let lists = 0
  for (let depth = 1; depth <= $start.depth; depth++) {
    const node = $start.node(depth)
    if (/^(bullet|ordered)_list$/.test(node.type.name)) lists++
    if (refusal(node, lists, false)) return false
  }
  doc.nodesBetween(start, Math.min(to, doc.content.size), (node, pos) => {
    if (!allowed) return false
    const $pos = doc.resolve(pos)
    let depth = /^(bullet|ordered)_list$/.test(node.type.name) ? 1 : 0
    let inCell = false
    for (let level = $pos.depth; level > 0; level--) {
      const name = $pos.node(level).type.name
      if (/^(bullet|ordered)_list$/.test(name)) depth++
      if (name === 'table_cell' || name === 'table_header') inCell = true
    }
    if (refusal(node, depth, inCell)) allowed = false
    return allowed
  })
  return allowed
}

/** The ranges of runs that have both a link and underline, which canonical form removes the
 *  underline from, in the part of `doc` from `from` to `to`. */
export function linkedUnderlines(
  doc: ProseNode,
  from: number,
  to: number,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  const { link, underline } = doc.type.schema.marks
  if (!link || !underline) return ranges
  doc.nodesBetween(from, to, (node, pos) => {
    if (
      node.isText &&
      link.isInSet(node.marks) &&
      underline.isInSet(node.marks)
    )
      ranges.push({ from: pos, to: pos + node.nodeSize })
  })
  return ranges
}

/** Whether every character from `from` to `to`, or the caret's marks, is in a link. */
export function inLink(state: EditorState): boolean {
  const { link } = state.schema.marks
  if (!link) return false
  const { from, to, empty, $from } = state.selection
  if (empty) return Boolean(link.isInSet(state.storedMarks ?? $from.marks()))
  let text = false
  let all = true
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    text = true
    if (!link.isInSet(node.marks)) all = false
    return all
  })
  return text && all
}
