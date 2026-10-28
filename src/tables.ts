import type { TableCommand, TableOptions } from './types'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  createTable,
  insertTableCommand,
  exitTable,
  moveRowCommand,
  moveColCommand,
} from '@milkdown/kit/preset/gfm'
import {
  addRowAfter,
  addRowBefore,
  addColumnAfter,
  addColumnBefore,
  deleteRow,
  deleteColumn,
  deleteTable,
  goToNextCell,
  selectedRect,
  TableMap,
  isInTable,
  CellSelection,
} from '@milkdown/kit/prose/tables'
import {
  Fragment,
  type Mark,
  type Node as ProseNode,
} from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  Selection,
  type Command,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { keymap } from '@milkdown/kit/prose/keymap'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { clipboardText } from './clipboard'
import { removesStructure } from './hidden-comments'
import {
  expectInteger,
  expectOneOf,
  invalidArgument,
  isOmitted,
  optionalRecord,
} from './errors'

export const tableCommands: readonly TableCommand[] = [
  'insert',
  'addRowBefore',
  'addRowAfter',
  'addColumnBefore',
  'addColumnAfter',
  'deleteRow',
  'deleteColumn',
  'deleteTable',
  'alignLeft',
  'alignCenter',
  'alignRight',
  'moveRowUp',
  'moveRowDown',
  'moveColumnLeft',
  'moveColumnRight',
  'sortRows',
  'exit',
]

export function tableContext(state: EditorState):
  | {
      row: number
      column: number
      rows: number
      columns: number
    }
  | undefined {
  if (!isInTable(state)) return undefined
  const rect = selectedRect(state)
  return {
    row: rect.top,
    column: rect.left,
    rows: rect.map.height,
    columns: rect.map.width,
  }
}

/** Checks the same default operations without dispatching a transaction. */
export function tableAvailability(ctx: Ctx): Record<TableCommand, boolean> {
  const view = ctx.get(editorViewCtx)
  const state = view.state
  const commands = ctx.get(commandsCtx)
  const available = Object.fromEntries(
    tableCommands.map((name) => [name, false]),
  ) as Record<TableCommand, boolean>
  available.insert = commands.get(insertTableCommand.key)({ row: 3, col: 2 })(
    state,
  )
  const actions = {
    addRowBefore,
    addRowAfter,
    addColumnBefore,
    addColumnAfter,
    deleteRow,
    deleteColumn,
    deleteTable,
  }
  for (const [name, action] of Object.entries(actions))
    available[name as keyof typeof actions] = action(state)
  available.exit = commands.get(exitTable.key)()(state)
  if (!isInTable(state)) return available
  const rect = selectedRect(state)
  available.alignLeft = available.alignCenter = available.alignRight = true
  if (!editableTable(rect.table)) return available
  available.moveRowUp = rect.top > 1
  available.moveRowDown = rect.top > 0 && rect.bottom < rect.map.height
  available.moveColumnLeft = rect.left > 0
  available.moveColumnRight = rect.right < rect.map.width
  const body: { key: string; index: number }[] = []
  rect.table.forEach((row, _offset, index) => {
    if (index)
      body.push({ key: clipboardText(row.child(rect.left).content), index })
  })
  const sorted = [...body].sort(
    (a, b) =>
      compareCells(a.key, b.key, 'text', 'ascending') || a.index - b.index,
  )
  available.sortRows = sorted.some((row, index) => row !== body[index])
  return available
}

/** Trims the whitespace at both ends of a cell's inline content. */
function trimCell(nodes: ProseNode[]): ProseNode[] {
  const trimmed = [...nodes]
  for (const [edge, trim] of [
    [0, (text: string) => text.trimStart()],
    [-1, (text: string) => text.trimEnd()],
  ] as const) {
    for (;;) {
      const node = trimmed.at(edge)
      if (!node?.text) break
      const text = trim(node.text)
      if (text) {
        trimmed.splice(
          edge < 0 ? trimmed.length - 1 : 0,
          1,
          node.type.schema.text(text, node.marks),
        )
        break
      }
      trimmed.splice(edge < 0 ? trimmed.length - 1 : 0, 1)
    }
  }
  return trimmed
}

/**
 * The cells of a paragraph that is one table row typed as Markdown, such as `| Name | Date |`: it
 * starts and ends with a pipe and holds at least two cells. A pipe written `\|` or inside inline
 * code belongs to its cell. Returns nothing for any other paragraph, including one with a line
 * break or an inline node, which a cell could not hold the same way.
 */
function typedRowCells(paragraph: ProseNode): ProseNode[][] | undefined {
  const rows: ProseNode[][] = [[]]
  for (let index = 0; index < paragraph.childCount; index++) {
    const child = paragraph.child(index)
    if (!child.isText || /[\r\n]/.test(child.text!)) return undefined
    if (child.marks.some((mark: Mark) => mark.type.spec.code)) {
      rows.at(-1)!.push(child)
      continue
    }
    let piece = '',
      slashes = 0
    const flush = () => {
      if (piece) rows.at(-1)!.push(child.type.schema.text(piece, child.marks))
      piece = ''
    }
    for (const character of child.text!) {
      if (character !== '|') {
        slashes = character === '\\' ? slashes + 1 : 0
        piece += character
      } else if (slashes % 2) {
        piece = piece.slice(0, -1) + character
        slashes = 0
      } else {
        flush()
        rows.push([])
        slashes = 0
      }
    }
    flush()
  }
  const blank = (cell: ProseNode[]) =>
    cell.every((node) => node.isText && !node.text!.trim())
  if (rows.length < 4 || !blank(rows[0]!) || !blank(rows.at(-1)!))
    return undefined
  const cells = rows.slice(1, -1)
  return cells.length <= 100 ? cells.map(trimCell) : undefined
}

/**
 * Turns the paragraph holding the caret at its end into a table when it is a typed table row: the
 * typed cells are the header, one empty row follows, and the caret is in its first cell. It builds
 * the table `table('insert')` does and replaces the paragraph in one undo step of its own, so Undo
 * restores the typed line with the caret at its end.
 */
function typedRowToTable(ctx: Ctx): Command {
  return (state, dispatch) => {
    const view = ctx.get(editorViewCtx)
    const { $cursor } = state.selection as { $cursor?: Selection['$from'] }
    if (
      !$cursor ||
      !view.editable ||
      view.composing ||
      $cursor.parent.type.name !== 'paragraph' ||
      $cursor.parentOffset !== $cursor.parent.content.size ||
      $cursor.depth < 1
    )
      return false
    const cells = typedRowCells($cursor.parent)
    if (!cells) return false
    const template = createTable(ctx, 2, cells.length) as ProseNode
    const [head, ...rest] = [template.child(0), template.child(1)]
    const paragraph = state.schema.nodes.paragraph!
    let table: ProseNode
    try {
      table = template.copy(
        Fragment.from([
          head!.copy(
            Fragment.fromArray(
              cells.map((cell, column) => {
                const header = head!.child(column)
                return header.copy(Fragment.from(paragraph.create(null, cell)))
              }),
            ),
          ),
          ...rest,
        ]),
      )
      table.check()
    } catch {
      return false
    }
    // A list item opens with a paragraph, which stays, empty, above the table.
    const index = $cursor.index(-1),
      parent = $cursor.node(-1)
    const replaces = parent.canReplaceWith(index, index + 1, table.type)
    // A task item would be written with a spacer line beside its checkbox.
    if (
      !replaces &&
      (parent.attrs.checked != null ||
        !parent.canReplaceWith(index + 1, index + 1, table.type))
    )
      return false
    if (dispatch) {
      const tr = state.tr
      if (replaces) tr.replaceWith($cursor.before(), $cursor.after(), table)
      else {
        tr.delete($cursor.start(), $cursor.end())
        tr.insert($cursor.start() + 1, table)
      }
      const start = replaces ? $cursor.before() : $cursor.start() + 1
      const body = start + 1 + table.child(0).nodeSize
      tr.setSelection(Selection.findFrom(tr.doc.resolve(body), 1, true)!)
      dispatchTableOperation(view, tr)
    }
    return true
  }
}

// Above the list keys, so Tab in a list item that holds a typed row makes the table.
const typedRowKeymap = $shortcut((ctx) => ({
  Enter: { key: 'Enter', onRun: () => typedRowToTable(ctx), priority: 60 },
  Tab: { key: 'Tab', onRun: () => typedRowToTable(ctx), priority: 60 },
}))

export const tablePlugins = [
  moveRowCommand,
  moveColCommand,
  typedRowKeymap,
  $prose(() => keymap({ Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1) })),
].flat()

/** Checks a table call's command and options, with `null` as omitted, and returns the options to
 *  use. Each option belongs to one command; any other throws `invalid-argument`. */
export function tableOptions(
  command: unknown,
  options: unknown,
): TableOptions | undefined {
  expectOneOf(command, tableCommands, 'command')
  const allowed =
    command === 'insert'
      ? ['rows', 'columns']
      : command === 'sortRows'
        ? ['column', 'order', 'comparison']
        : []
  const record = optionalRecord(options, 'options', allowed)
  if (!record) return undefined
  const size = { min: 1, max: 100 }
  const checked: TableOptions = {
    rows: isOmitted(record.rows)
      ? undefined
      : expectInteger(record.rows, 'options.rows', size),
    columns: isOmitted(record.columns)
      ? undefined
      : expectInteger(record.columns, 'options.columns', size),
    column: isOmitted(record.column)
      ? undefined
      : expectInteger(record.column, 'options.column', { min: 0 }),
    order: isOmitted(record.order)
      ? undefined
      : expectOneOf(record.order, sortOrders, 'options.order'),
    comparison: isOmitted(record.comparison)
      ? undefined
      : expectOneOf(record.comparison, sortComparisons, 'options.comparison'),
  }
  return checked
}

const sortOrders = ['ascending', 'descending'] as const
const sortComparisons = ['text', 'number'] as const

export function tableCommand(
  ctx: Ctx,
  command: TableCommand,
  options?: TableOptions,
): boolean {
  const view = ctx.get(editorViewCtx)
  const commands = ctx.get(commandsCtx)
  if (command === 'insert') {
    const row = options?.rows ?? 3,
      col = options?.columns ?? 2
    return commands.call(insertTableCommand.key, { row, col })
  }
  if (command === 'exit') return commands.call(exitTable.key)
  if (command.startsWith('move') || command === 'sortRows')
    return refineTable(view, command, options)
  if (
    command === 'alignLeft' ||
    command === 'alignCenter' ||
    command === 'alignRight'
  ) {
    if (!isInTable(view.state)) return false
    const rect = selectedRect(view.state),
      map = TableMap.get(rect.table)
    const alignment =
      command === 'alignLeft'
        ? 'left'
        : command === 'alignRight'
          ? 'right'
          : 'center'
    const tr = view.state.tr
    // GFM stores alignment on the header; apply it to the entire column so
    // editing a body cell does not disappear when Markdown is saved.
    const positions = new Set<number>()
    for (let row = 0; row < map.height; row++)
      for (let col = rect.left; col < rect.right; col++)
        positions.add(map.map[row * map.width + col]!)
    for (const offset of positions) {
      const pos = rect.tableStart + offset,
        cell = tr.doc.nodeAt(pos)!
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment })
    }
    view.dispatch(tr)
    return true
  }
  if (command === 'addRowBefore' || command === 'addRowAfter') {
    if (!isInTable(view.state)) return false
    const { tableStart } = selectedRect(view.state)
    const add = command === 'addRowBefore' ? addRowBefore : addRowAfter
    return add(view.state, (tr) => {
      // GFM keeps alignment once per column, so a new row's cells take the
      // header's; otherwise they read back aligned and the edit is refused.
      const table = tr.doc.nodeAt(tableStart - 1)!
      const map = TableMap.get(table)
      for (let row = 1; row < map.height; row++)
        for (let col = 0; col < map.width; col++) {
          const offset = map.map[row * map.width + col]!
          const cell = table.nodeAt(offset)!
          const { alignment } = table.nodeAt(map.map[col]!)!.attrs
          if (cell.attrs.alignment !== alignment)
            tr.setNodeMarkup(tableStart + offset, undefined, {
              ...cell.attrs,
              alignment,
            })
        }
      view.dispatch(tr)
    })
  }
  const actions = {
    addColumnBefore,
    addColumnAfter,
    deleteRow,
    deleteColumn,
    deleteTable,
  }
  // Removing a row, column or table removes any hidden comments in it.
  return actions[command as keyof typeof actions](view.state, (tr) =>
    view.dispatch(tr.setMeta(removesStructure, true)),
  )
}

export function dispatchTableOperation(
  view: EditorView,
  tr: Transaction,
): void {
  view.dispatch(closeHistory(tr).scrollIntoView())
  view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
}

export function configureTableMovement(ctx: Ctx, canEdit: () => boolean): void {
  const commands = ctx.get(commandsCtx)
  for (const [key, rowMovement] of [
    [moveRowCommand.key, true],
    [moveColCommand.key, false],
  ] as const) {
    commands.remove(key)
    commands.create(key, (options = {}) => () => {
      const view = ctx.get(editorViewCtx)
      if (
        !canEdit() ||
        !view.editable ||
        view.composing ||
        !isInTable(view.state)
      )
        return false
      const rect = selectedRect(view.state)
      const from = options.from ?? 0,
        to = options.to ?? 0
      const length = rowMovement ? rect.map.height : rect.map.width
      if (
        !editableTable(rect.table) ||
        (options.pos != null && options.pos !== rect.tableStart) ||
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        to < 0 ||
        from >= length ||
        to >= length ||
        from === to ||
        (rowMovement && (from === 0 || to === 0))
      )
        return false
      const rows: ProseNode[] = []
      rect.table.forEach((row) => rows.push(row))
      if (rowMovement) {
        const moved = rows.splice(from, 1)[0]!
        rows.splice(to, 0, moved)
      } else {
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]!,
            cells: ProseNode[] = []
          row.forEach((cell) => cells.push(cell))
          cells.splice(to, 0, cells.splice(from, 1)[0]!)
          rows[index] = row.copy(Fragment.fromArray(cells))
        }
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
        rowMovement ? to : 0,
        rowMovement ? 0 : to,
        rowMovement ? to + 1 : rect.map.height,
        rowMovement ? rect.map.width : to + 1,
      )
      dispatchTableOperation(view, tr)
      return true
    })
  }
}

export function editableTable(table: ProseNode): boolean {
  const map = TableMap.get(table)
  if (map.problems?.length || map.width > 100 || map.height > 100) return false
  let valid = table.firstChild?.type.name === 'table_header_row'
  table.forEach((row, _offset, index) => {
    valid &&= row.type.name === (index ? 'table_row' : 'table_header_row')
    valid &&= row.childCount === map.width
    row.forEach((cell) => {
      valid &&= cell.attrs.colspan === 1 && cell.attrs.rowspan === 1
    })
  })
  return Boolean(valid)
}

function refineTable(
  view: EditorView,
  command: TableCommand,
  options?: TableOptions,
): boolean {
  if (!isInTable(view.state)) return false
  const rect = selectedRect(view.state)
  if (!editableTable(rect.table)) return false
  const rows: ProseNode[] = []
  rect.table.forEach((row) => rows.push(row))
  let top = rect.top,
    bottom = rect.bottom,
    left = rect.left,
    right = rect.right
  if (command === 'sortRows') {
    const column = options?.column ?? rect.left
    if (column >= rect.map.width)
      throw invalidArgument(
        'options.column must identify an existing table column',
      )
    const order = options?.order ?? 'ascending'
    const comparison = options?.comparison ?? 'text'
    const body = rows.slice(1).map((row, index) => ({
      row,
      index,
      key: clipboardText(row.child(column).content),
    }))
    // Cells that are not numbers leave nothing to sort by; the table stays as it is.
    if (
      comparison === 'number' &&
      body.some(({ key }) => {
        const value = key.trim()
        return value !== '' && decimalNumber(value) === undefined
      })
    )
      return false
    body.sort(
      (a, b) =>
        compareCells(a.key, b.key, comparison, order) || a.index - b.index,
    )
    if (body.every(({ row }, index) => row === rows[index + 1])) return false
    const activeIndex = top - 1
    rows.splice(1, rows.length - 1, ...body.map(({ row }) => row))
    top =
      top === 0 ? 0 : body.findIndex(({ index }) => index === activeIndex) + 1
    bottom = top + 1
  } else if (command === 'moveRowUp' || command === 'moveRowDown') {
    const up = command === 'moveRowUp'
    if (top === 0 || (up ? top === 1 : bottom === rows.length)) return false
    const moved = rows.splice(top, bottom - top)
    const destination = top + (up ? -1 : 1)
    rows.splice(destination, 0, ...moved)
    top = destination
    bottom += up ? -1 : 1
  } else {
    const backward = command === 'moveColumnLeft'
    if (backward ? left === 0 : right === rect.map.width) return false
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!
      const cells: ProseNode[] = []
      row.forEach((cell) => cells.push(cell))
      const moved = cells.splice(left, right - left)
      cells.splice(left + (backward ? -1 : 1), 0, ...moved)
      rows[index] = row.copy(Fragment.fromArray(cells))
    }
    left += backward ? -1 : 1
    right += backward ? -1 : 1
  }
  const table = rect.table.copy(Fragment.fromArray(rows))
  const tr = view.state.tr.replaceWith(
    rect.tableStart - 1,
    rect.tableStart - 1 + rect.table.nodeSize,
    table,
  )
  selectTableRectangle(tr, rect.tableStart, table, top, left, bottom, right)
  dispatchTableOperation(view, tr)
  return true
}

export function selectTableRectangle(
  tr: Transaction,
  tableStart: number,
  table: ProseNode,
  top: number,
  left: number,
  bottom: number,
  right: number,
): void {
  const map = TableMap.get(table)
  tr.setSelection(
    CellSelection.create(
      tr.doc,
      tableStart + map.map[top * map.width + left]!,
      tableStart + map.map[(bottom - 1) * map.width + right - 1]!,
    ),
  )
}

function compareCells(
  a: string,
  b: string,
  comparison: 'text' | 'number',
  order: 'ascending' | 'descending',
): number {
  const x = a.trim(),
    y = b.trim()
  if (!x || !y) return x === y ? 0 : x ? -1 : 1
  const direction = order === 'ascending' ? 1 : -1
  const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  if (comparison === 'text') return direction * text(a, b)
  const nx = decimalNumber(x)!,
    ny = decimalNumber(y)!
  return direction * (nx < ny ? -1 : nx > ny ? 1 : 0)
}

function decimalNumber(value: string): number | undefined {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value))
    ? Number(value)
    : undefined
}
