import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  DOMParser as ProseParser,
  Fragment,
  type Node as ProseNode,
  type Schema,
} from '@milkdown/kit/prose/model'
import { isInTable, selectedRect } from '@milkdown/kit/prose/tables'
import { InkKitError, type ClipboardInput } from './types'
import { literalCommentSpans } from './comments'
import { normalizeTableAlignment } from './table-alignment'
import {
  dispatchTableOperation,
  editableTable,
  selectTableRectangle,
} from './tables'

type Grid = { cells: Fragment[][]; width: number; alignment?: string[] }

export function pasteSpreadsheet(ctx: Ctx, input: ClipboardInput): boolean {
  const view = ctx.get(editorViewCtx)
  if (input.plainText || input.markdown != null) return false
  const inTable = isInTable(view.state)
  if (
    input.html &&
    /data-inkkit-(?:markdown|reference|footnote|comment)/i.test(input.html)
  ) {
    if (inTable && /<table[\s>]/i.test(input.html)) reject()
    return false
  }
  if (input.images?.length || (input.html && /<img[\s>]/i.test(input.html))) {
    if (!input.html || !/<table[\s>]/i.test(input.html)) return false
    const template = document.createElement('template')
    template.innerHTML = input.html
    for (const image of template.content.querySelectorAll('img'))
      image.replaceWith(
        document.createTextNode(image.getAttribute('alt') ?? 'Image'),
      )
    try {
      htmlGrid(view.state.schema, template.innerHTML)
      return false
    } catch {
      if (!inTable && !standaloneTable(input.html)) return false
    }
  }
  let grid: Grid | undefined
  try {
    grid = input.html?.match(/<table[\s>]/i)
      ? htmlGrid(view.state.schema, input.html)
      : input.text.includes('\t')
        ? textGrid(view.state.schema, input.text)
        : undefined
  } catch (error) {
    if (inTable || !input.html) throw error
    if (!standaloneTable(input.html)) return false
    const schema = view.state.schema
    const children: ProseNode[] = []
    let cursor = 0
    for (const span of literalCommentSpans(input.html)) {
      if (span.start > cursor)
        children.push(schema.text(input.html.slice(cursor, span.start)))
      children.push(
        schema.nodes.comment_inline!.create(
          { syntax: span.syntax, block: Boolean(span.block) },
          span.value ? schema.text(span.value) : null,
        ),
      )
      cursor = span.end
    }
    if (cursor < input.html.length)
      children.push(schema.text(input.html.slice(cursor)))
    const literal = schema.nodes.literal_markdown!.create(null, children)
    const selection = view.state.selection
    const tr =
      selection.$from.parent.type.name === 'paragraph' &&
      selection.empty &&
      selection.$from.parent.content.size === 0
        ? view.state.tr.replaceWith(
            selection.$from.before(),
            selection.$from.after(),
            literal,
          )
        : view.state.tr.replaceSelectionWith(literal)
    dispatchTableOperation(view, tr)
    return true
  }
  if (!grid) return false
  if (!inTable) {
    const schema = view.state.schema
    const rows = grid.cells.map((row, index) =>
      schema.nodes[index ? 'table_row' : 'table_header_row']!.create(
        null,
        row.map((content, column) =>
          schema.nodes[index ? 'table_cell' : 'table_header']!.create(
            { alignment: grid.alignment?.[column] ?? 'left' },
            schema.nodes.paragraph!.create(null, content),
          ),
        ),
      ),
    )
    const table = schema.nodes.table!.create(null, rows)
    const selection = view.state.selection
    const tr =
      selection.$from.parent.type.name === 'paragraph' &&
      selection.empty &&
      selection.$from.parent.content.size === 0
        ? view.state.tr.replaceWith(
            selection.$from.before(),
            selection.$from.after(),
            table,
          )
        : view.state.tr.replaceSelectionWith(table)
    let tableStart = -1
    tr.doc.descendants((node, pos) => {
      if (node === table) tableStart = pos + 1
    })
    if (tableStart < 0) reject()
    selectTableRectangle(
      tr,
      tableStart,
      table,
      0,
      0,
      grid.cells.length,
      grid.width,
    )
    dispatchTableOperation(view, tr)
    return true
  }
  const rect = selectedRect(view.state)
  if (!editableTable(rect.table)) reject()
  const width = Math.max(rect.map.width, rect.left + grid.width)
  const height = Math.max(rect.map.height, rect.top + grid.cells.length)
  if (width > 100 || height > 100) reject()
  const schema = view.state.schema
  const alignment = Array.from({ length: width }, (_, column) =>
    column < rect.map.width
      ? rect.table.firstChild!.child(column).attrs.alignment
      : 'left',
  )
  const rows: ProseNode[] = []
  for (let row = 0; row < height; row++) {
    const cells: ProseNode[] = []
    for (let column = 0; column < width; column++) {
      const existing =
        row < rect.map.height && column < rect.map.width
          ? rect.table.child(row).child(column)
          : undefined
      const incoming = grid.cells[row - rect.top]?.[column - rect.left]
      const cleared =
        row >= rect.top &&
        row < rect.bottom &&
        column >= rect.left &&
        column < rect.right
      if (existing && !incoming && !cleared) cells.push(existing)
      else {
        const type = schema.nodes[row ? 'table_cell' : 'table_header']!
        cells.push(
          type.create(
            { ...(existing?.attrs ?? {}), alignment: alignment[column] },
            schema.nodes.paragraph!.create(null, incoming),
          ),
        )
      }
    }
    rows.push(
      schema.nodes[row ? 'table_row' : 'table_header_row']!.create(
        rect.table.maybeChild(row)?.attrs,
        cells,
      ),
    )
  }
  const table = rect.table.copy(Fragment.fromArray(rows))
  const tr = view.state.tr.replaceWith(
    rect.tableStart - 1,
    rect.tableStart - 1 + rect.table.nodeSize,
    table,
  )
  selectTableRectangle(
    tr,
    rect.tableStart,
    table,
    rect.top,
    rect.left,
    rect.top + grid.cells.length,
    rect.left + grid.width,
  )
  dispatchTableOperation(view, tr)
  return true
}

function standaloneTable(html: string): boolean {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const metadata of template.content.querySelectorAll('meta[charset]'))
    metadata.remove()
  const elements = [...template.content.childNodes].filter(
    (node) => node.nodeType !== 3 || node.textContent?.trim(),
  )
  return elements.length === 1 && elements[0] instanceof HTMLTableElement
}

function reject(): never {
  throw new InkKitError(
    'preservation',
    'This spreadsheet cannot be represented safely in a Markdown table. Paste as plain text outside the table to retain its source.',
  )
}

function textGrid(schema: Schema, input: string): Grid {
  const text = input.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  const rows: string[][] = [[]]
  let value = '',
    quoted = false,
    closed = false,
    start = true
  for (let index = 0; index <= text.length; index++) {
    const character = text[index]
    if (quoted) {
      if (character == null) reject()
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"'
          index++
        } else {
          quoted = false
          closed = true
        }
      } else value += character
      continue
    }
    if (character === '"' && start) {
      quoted = true
      start = false
    } else if (character === '\t' || character === '\n' || character == null) {
      rows.at(-1)!.push(value)
      value = ''
      start = true
      closed = false
      if (character === '\n') rows.push([])
    } else {
      if (closed) reject()
      value += character
      start = false
    }
  }
  const width = Math.max(...rows.map((row) => row.length))
  if (width > 100 || rows.length > 100) reject()
  if (rows.some((row) => row.some((value) => /[\n\t]/.test(value)))) reject()
  return {
    width,
    cells: rows.map((row) =>
      Array.from({ length: width }, (_, column) => {
        const value = row[column] ?? ''
        return value ? Fragment.from(schema.text(value)) : Fragment.empty
      }),
    ),
  }
}

function htmlGrid(schema: Schema, html: string): Grid {
  const template = document.createElement('template')
  template.innerHTML = html
  const fragment = template.content
  for (const metadata of fragment.querySelectorAll('meta[charset]'))
    metadata.remove()
  const table = fragment.querySelector('table')
  if (!table || fragment.querySelectorAll('table').length !== 1) reject()
  const wrapper = table.parentElement
  if (wrapper && wrapper.tagName !== 'BODY') reject()
  for (const sibling of fragment.childNodes)
    if (
      sibling !== table &&
      (sibling.textContent?.trim() || sibling.nodeType !== 3)
    )
      reject()
  const rows = [...table.querySelectorAll('tr')]
  if (document.createTreeWalker(table, NodeFilter.SHOW_COMMENT).nextNode())
    reject()
  for (const element of table.children) {
    if (!['TR', 'THEAD', 'TBODY', 'TFOOT'].includes(element.tagName)) reject()
    if (element.tagName !== 'TR')
      for (const row of element.children) if (row.tagName !== 'TR') reject()
  }
  const width = rows[0]?.children.length ?? 0
  if (!width || width > 100 || !rows.length || rows.length > 100) reject()
  const parser = ProseParser.fromSchema(schema)
  const inline = new Set([
    'STRONG',
    'B',
    'EM',
    'I',
    'S',
    'DEL',
    'STRIKE',
    'CODE',
    'A',
    'MARK',
    'SPAN',
  ])
  const cells = rows.map((row) => {
    if (row.children.length !== width) reject()
    return [...row.children].map((cell) => {
      if (!['TH', 'TD'].includes(cell.tagName)) reject()
      if (
        (cell.hasAttribute('rowspan') &&
          cell.getAttribute('rowspan') !== '1') ||
        (cell.hasAttribute('colspan') && cell.getAttribute('colspan') !== '1')
      )
        reject()
      for (const element of cell.querySelectorAll('*'))
        if (
          !inline.has(element.tagName) &&
          !(
            element.tagName === 'P' &&
            element.parentElement === cell &&
            cell.children.length === 1
          )
        )
          reject()
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_COMMENT)
      if (walker.nextNode()) reject()
      if (/[\n\r\t]/.test(cell.textContent ?? '')) reject()
      for (const link of cell.querySelectorAll('a'))
        if (!link.hasAttribute('href')) reject()
      const parsed = parser.parse(cell, { preserveWhitespace: true })
      if (parsed.childCount === 0) return Fragment.empty
      if (
        parsed.childCount !== 1 ||
        parsed.firstChild!.type.name !== 'paragraph'
      )
        reject()
      return parsed.firstChild!.content
    })
  })
  const alignment = [...rows[0]!.children].map(
    (cell) => normalizeTableAlignment(cell as HTMLElement) ?? 'left',
  )
  return { width, cells, alignment }
}
