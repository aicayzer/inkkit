import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  tableBlock,
  tableBlockConfig,
} from '@milkdown/kit/component/table-block'
import { insertTableCommand, exitTable } from '@milkdown/kit/preset/gfm'
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
} from '@milkdown/kit/prose/tables'
import { keymap } from '@milkdown/kit/prose/keymap'
import { $prose } from '@milkdown/kit/utils'

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
  | 'exit'
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
  options?: { rows?: number; columns?: number },
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
  return actions[command](view.state, view.dispatch)
}
