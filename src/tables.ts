import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  tableBlock,
  tableBlockConfig,
} from '@milkdown/kit/component/table-block'
import {
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
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Transaction } from '@milkdown/kit/prose/state'
import { keymap } from '@milkdown/kit/prose/keymap'
import { $prose } from '@milkdown/kit/utils'
import { clipboardText } from './clipboard'

export type TableCommand =
  | 'insert'
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'deleteTable'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'moveRowUp'
  | 'moveRowDown'
  | 'moveColumnLeft'
  | 'moveColumnRight'
  | 'sortRows'
  | 'exit'
export interface TableOptions {
  rows?: number
  columns?: number
  column?: number
  order?: 'ascending' | 'descending'
  comparison?: 'text' | 'number'
}
const labels = {
  add_row: 'Add row',
  add_col: 'Add column',
  delete_row: 'Delete row',
  delete_col: 'Delete column',
  align_col_left: 'Align left',
  align_col_center: 'Align center',
  align_col_right: 'Align right',
  col_drag_handle: 'Move column',
  row_drag_handle: 'Move row',
}
export const tablePlugins = [
  moveRowCommand,
  moveColCommand,
  tableBlockConfig,
  (ctx: Ctx) => () => {
    ctx.update(tableBlockConfig.key, (config) => ({
      ...config,
      renderButton: (type) =>
        `<span role="img" aria-label="${labels[type]}">${labels[type]}</span>`,
    }))
  },
  tableBlock,
  $prose(() => keymap({ Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1) })),
].flat()

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
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 1 ||
      row > 100 ||
      col < 1 ||
      col > 100
    )
      throw new RangeError('Table dimensions must be integers from 1 to 100')
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
  const actions = {
    addRowBefore,
    addRowAfter,
    addColumnBefore,
    addColumnAfter,
    deleteRow,
    deleteColumn,
    deleteTable,
  }
  return actions[command as keyof typeof actions](view.state, view.dispatch)
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
    if (!Number.isInteger(column) || column < 0 || column >= rect.map.width)
      throw new RangeError('Sort column must identify an existing table column')
    const order = options?.order ?? 'ascending'
    const comparison = options?.comparison ?? 'text'
    if (!['ascending', 'descending'].includes(order))
      throw new RangeError('Sort order must be ascending or descending')
    if (!['text', 'number'].includes(comparison))
      throw new RangeError('Sort comparison must be text or number')
    const body = rows.slice(1).map((row, index) => ({
      row,
      index,
      key: clipboardText(row.child(column).content),
    }))
    if (
      comparison === 'number' &&
      body.some(({ key }) => {
        const value = key.trim()
        return value !== '' && decimalNumber(value) === undefined
      })
    )
      throw new RangeError(
        'Numeric sorting requires finite decimal values or blank cells',
      )
    body.sort(
      (a, b) =>
        compareCells(a.key, b.key, comparison, order) || a.index - b.index,
    )
    if (body.every(({ row }, index) => row === rows[index + 1])) return false
    const activeRow = rows[top]!
    rows.splice(1, rows.length - 1, ...body.map(({ row }) => row))
    top = rows.indexOf(activeRow)
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
