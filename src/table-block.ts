import { commandsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { moveColCommand, moveRowCommand } from '@milkdown/kit/preset/gfm'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables'
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
  type ViewMutationRecord,
} from '@milkdown/kit/prose/view'
import { $ctx, $prose, $view } from '@milkdown/kit/utils'
import { tableNode } from './dialect'
import { editorLabels } from './labels'
import { tableCommand } from './tables'
import type { EditorLabels, TableCommand } from './types'

/** Runs an edit for the person using the controls, as a facade call: it is
 *  refused while read-only, and a refused edit changes nothing. */
export const tableControlCtx = $ctx<
  (operation: () => boolean) => boolean,
  'inkkitTableControl'
>((operation) => operation(), 'inkkitTableControl')

type Axis = 'column' | 'row'
interface Cell {
  row: number
  column: number
}
/** Where a caret was in a cell: its distance from the position before the cell. */
interface Caret {
  cell: Cell
  offset?: number
}

/** The row or column a control acts on, drawn as highlighted cells. It is a
 *  decoration, not a cell selection, so no undo step can bring back a
 *  selected line for the next key to replace. */
interface Line {
  table: number
  axis: Axis
  index: number
}
const lineKey = new PluginKey<Line | null>('inkkitTableLine')

/** Where line `index` is after line `from` moves to `to`. */
function moved(index: number, from: number, to: number): number {
  if (index === from) return to
  if (from < to && index > from && index <= to) return index - 1
  if (to < from && index >= to && index < from) return index + 1
  return index
}

const svg = (paths: string) =>
  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${paths}</svg>`
const dots = (points: [number, number][]) =>
  points
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="currentColor"/>`)
    .join('')
const icons = {
  column: svg(
    dots([
      [4, 6],
      [8, 6],
      [12, 6],
      [4, 10],
      [8, 10],
      [12, 10],
    ]),
  ),
  row: svg(
    dots([
      [6, 4],
      [6, 8],
      [6, 12],
      [10, 4],
      [10, 8],
      [10, 12],
    ]),
  ),
  alignLeft: svg('<path d="M3 4h10M3 8h6M3 12h8"/>'),
  alignCenter: svg('<path d="M3 4h10M5 8h6M4 12h8"/>'),
  alignRight: svg('<path d="M3 4h10M7 8h6M5 12h8"/>'),
  add: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  delete: svg(
    '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>',
  ),
}

interface Action {
  label: keyof EditorLabels
  icon: string
  command: TableCommand
}
const menus: Record<Axis, Action[]> = {
  column: [
    { label: 'tableAlignLeft', icon: icons.alignLeft, command: 'alignLeft' },
    {
      label: 'tableAlignCenter',
      icon: icons.alignCenter,
      command: 'alignCenter',
    },
    { label: 'tableAlignRight', icon: icons.alignRight, command: 'alignRight' },
    { label: 'tableAddColumn', icon: icons.add, command: 'addColumnAfter' },
    {
      label: 'tableDeleteColumn',
      icon: icons.delete,
      command: 'deleteColumn',
    },
  ],
  row: [
    { label: 'tableAddRow', icon: icons.add, command: 'addRowAfter' },
    { label: 'tableDeleteRow', icon: icons.delete, command: 'deleteRow' },
  ],
}
const moves: Record<string, [Axis, TableCommand]> = {
  ArrowLeft: ['column', 'moveColumnLeft'],
  ArrowRight: ['column', 'moveColumnRight'],
  ArrowUp: ['row', 'moveRowUp'],
  ArrowDown: ['row', 'moveRowDown'],
}

function button(label: string, icon: string): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.setAttribute('aria-label', label)
  element.title = label
  element.innerHTML = icon
  return element
}

let menuCount = 0
const views = new WeakMap<EditorView, Set<TableBlockView>>()

/**
 * Draws a table with a control for the active column and row. The active cell
 * is the one under the pointer, else the one holding the selection. Each
 * control is a button: activating it selects its column or row and opens a
 * menu of the operations on it, and the arrow keys or a drag move it. Every
 * operation runs the facade's table command, so it keeps the same source
 * guarantees and refusals.
 */
export class TableBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLTableSectionElement
  private readonly scroller: HTMLElement
  private readonly table: HTMLTableElement
  private readonly controls: HTMLElement
  private readonly grips: Record<Axis, HTMLButtonElement>
  private readonly menus: Record<Axis, HTMLElement>
  private readonly marker: HTMLElement
  private readonly buttons: { axis: Axis; element: HTMLButtonElement }[] = []
  private hover?: Cell
  // Held while a menu is open or focus is in the controls, so the controls
  // stay on their cell when the pointer moves on.
  private pinned?: Cell
  private open?: Axis
  // The caret to put back when focus returns to the text, so typing never
  // lands on a selected row or column.
  private origin?: Caret
  private frame = 0
  private drag?: {
    origin?: Caret
    axis: Axis
    from: number
    pointer: number
    start: [number, number]
    to?: number
  }
  private suppressClick = false
  private readonly resize?: ResizeObserver

  constructor(
    private readonly ctx: Ctx,
    private node: ProseNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    const labels = editorLabels(ctx)
    this.dom = document.createElement('div')
    this.dom.className = 'inkkit-table-block'
    this.scroller = document.createElement('div')
    this.scroller.className = 'inkkit-table-scroll'
    this.table = document.createElement('table')
    this.contentDOM = document.createElement('tbody')
    this.table.append(this.contentDOM)
    this.scroller.append(this.table)

    this.controls = document.createElement('div')
    this.controls.className = 'inkkit-table-controls'
    this.controls.setAttribute('contenteditable', 'false')
    this.controls.hidden = true
    this.marker = document.createElement('div')
    this.marker.className = 'inkkit-table-marker'
    this.marker.hidden = true
    const grip = (axis: Axis) => {
      const element = button(
        labels[axis === 'column' ? 'tableMoveColumn' : 'tableMoveRow'],
        icons[axis],
      )
      element.className = 'inkkit-table-grip'
      element.dataset.inkkitAxis = axis
      element.setAttribute('aria-expanded', 'false')
      element.setAttribute(
        'aria-keyshortcuts',
        axis === 'column' ? 'ArrowLeft ArrowRight' : 'ArrowUp ArrowDown',
      )
      element.addEventListener('click', () => this.toggle(axis))
      element.addEventListener('pointerdown', (event) =>
        this.startDrag(axis, event),
      )
      return element
    }
    this.grips = { column: grip('column'), row: grip('row') }
    const menu = (axis: Axis) => {
      const element = document.createElement('div')
      element.className = 'inkkit-table-menu'
      element.dataset.inkkitAxis = axis
      element.setAttribute('role', 'group')
      element.id = `inkkit-table-menu-${++menuCount}`
      element.hidden = true
      this.grips[axis].setAttribute('aria-controls', element.id)
      for (const action of menus[axis]) {
        const entry = button(labels[action.label], action.icon)
        entry.dataset.inkkitCommand = action.command
        entry.addEventListener('click', () => this.perform(axis, action))
        this.buttons.push({ axis, element: entry })
        element.append(entry)
      }
      return element
    }
    this.menus = { column: menu('column'), row: menu('row') }
    this.controls.append(
      this.grips.column,
      this.menus.column,
      this.grips.row,
      this.menus.row,
      this.marker,
    )
    this.dom.append(this.scroller, this.controls)

    // A press on a control leaves focus and the selection in the text.
    this.controls.addEventListener('mousedown', (event) =>
      event.preventDefault(),
    )
    this.controls.addEventListener('keydown', (event) => this.key(event))
    this.controls.addEventListener('focusin', () => this.engage())
    this.controls.addEventListener('focusout', (event) => {
      if (this.controls.contains(event.relatedTarget as Node | null)) return
      this.close()
      this.highlight(undefined)
      this.pinned = undefined
      this.origin = undefined
      this.refresh()
    })
    this.dom.addEventListener('pointermove', (event) => this.point(event))
    this.dom.addEventListener('pointerleave', () => {
      if (!this.hover) return
      this.hover = undefined
      this.refresh()
    })
    this.scroller.addEventListener('scroll', () => this.place())
    if (typeof ResizeObserver === 'function') {
      this.resize = new ResizeObserver(() => this.place())
      this.resize.observe(this.table)
    }

    let registered = views.get(view)
    if (!registered) views.set(view, (registered = new Set()))
    registered.add(this)
    this.refresh()
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.refresh()
    return true
  }

  stopEvent(event: Event): boolean {
    return this.controls.contains(event.target as Node)
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false
    return !this.contentDOM.contains(mutation.target)
  }

  destroy(): void {
    if (this.frame && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(this.frame)
    this.resize?.disconnect()
    views.get(this.view)?.delete(this)
  }

  private get tableStart(): number | undefined {
    const pos = this.getPos()
    return pos === undefined ? undefined : pos + 1
  }

  private get focused(): boolean {
    return this.controls.contains(this.dom.ownerDocument.activeElement)
  }

  private get editable(): boolean {
    return this.view.editable && !this.view.composing
  }

  /** The cell that holds the selection head, when it is in this table. */
  private selected(): Cell | undefined {
    const pos = this.getPos()
    if (pos === undefined) return undefined
    const { selection } = this.view.state
    // A cell selection's head is the position before its cell.
    const cellSelection = selection instanceof CellSelection
    const $head = cellSelection ? selection.$headCell : selection.$head
    for (let depth = $head.depth; depth > 0; depth--) {
      if (
        $head.node(depth).type !== this.node.type ||
        $head.before(depth) !== pos
      )
        continue
      const cell =
        cellSelection && $head.depth === depth + 1
          ? $head.pos
          : depth + 2 <= $head.depth
            ? $head.before(depth + 2)
            : undefined
      if (cell === undefined) return undefined
      const rect = TableMap.get(this.node).findCell(cell - pos - 1)
      return { row: rect.top, column: rect.left }
    }
    return undefined
  }

  private active(): Cell | undefined {
    return this.pinned ?? this.hover ?? this.selected()
  }

  /** Brings the controls in line with the document, selection and pointer. */
  refresh(): void {
    const map = TableMap.get(this.node)
    const fits = (cell?: Cell) =>
      cell && cell.row < map.height && cell.column < map.width
        ? cell
        : undefined
    this.pinned = fits(this.pinned)
    this.hover = fits(this.hover)
    // A hold lasts while a menu is open or focus is in the controls.
    if (!this.open && !this.focused) {
      this.pinned = undefined
      this.origin = undefined
    }
    if (this.open && !this.pinned) this.close()
    const active = this.active()
    const hidden = !this.editable || !active
    // Refreshed on every transaction, so only changes reach the DOM.
    if (this.controls.hidden !== hidden) this.controls.hidden = hidden
    if (hidden) {
      this.close()
      return
    }
    const shown = this.hover || this.pinned ? 'true' : 'false'
    if (this.controls.dataset.inkkitShown !== shown)
      this.controls.dataset.inkkitShown = shown
    const header = active!.row === 0
    for (const { axis, element } of this.buttons)
      if (axis === 'row' && element.dataset.inkkitCommand === 'deleteRow') {
        if (element.hidden !== header) element.hidden = header
      } else if (element.dataset.inkkitCommand === 'deleteColumn') {
        if (element.disabled !== map.width < 2) element.disabled = map.width < 2
      }
    this.place()
  }

  private place(): void {
    if (this.frame) return
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (callback: FrameRequestCallback) => setTimeout(callback, 16)
    this.frame = schedule(() => {
      this.frame = 0
      this.position()
    }) as number
  }

  private position(): void {
    const active = this.active()
    if (this.controls.hidden || !active) return
    const row = this.contentDOM.rows[active.row]
    const cell = row?.cells[active.column]
    if (!row || !cell) return
    const origin = this.dom.getBoundingClientRect()
    const table = this.table.getBoundingClientRect()
    const visible = this.scroller.getBoundingClientRect()
    const box = cell.getBoundingClientRect()
    const column = box.left + box.width / 2
    const inside = column >= visible.left && column <= visible.right
    this.grips.column.hidden = !inside
    this.put(this.grips.column, column - origin.left, table.top - origin.top)
    const rowBox = row.getBoundingClientRect()
    const left = Math.max(table.left, visible.left)
    const middle = rowBox.top + rowBox.height / 2
    this.put(this.grips.row, left - origin.left, middle - origin.top)
    if (this.open === 'column')
      this.placeMenu(
        this.menus.column,
        column - origin.left,
        table.top - origin.top,
        origin.width,
      )
    if (this.open === 'row')
      this.placeMenu(
        this.menus.row,
        left - origin.left,
        middle - origin.top,
        origin.width,
      )
  }

  private put(element: HTMLElement, x: number, y: number): void {
    element.style.left = `${x}px`
    element.style.top = `${y}px`
  }

  private placeMenu(
    menu: HTMLElement,
    x: number,
    y: number,
    width: number,
  ): void {
    const axis = menu.dataset.inkkitAxis as Axis
    const size = menu.getBoundingClientRect()
    // Below the column control or beside the row control, kept inside the block.
    const left =
      axis === 'column' ? x - size.width / 2 : x + this.grips.row.offsetWidth
    menu.style.left = `${Math.max(0, Math.min(left, width - size.width))}px`
    menu.style.top =
      axis === 'column'
        ? `${y + this.grips.column.offsetHeight}px`
        : `${y - size.height / 2}px`
  }

  private point(event: PointerEvent): void {
    if (this.drag || event.pointerType === 'touch') return
    const target = event.target as Element | null
    if (!target || this.controls.contains(target)) return
    const cell = target.closest('td, th')
    const row = cell?.parentElement
    if (
      !cell ||
      !(row instanceof HTMLTableRowElement) ||
      row.parentElement !== this.contentDOM
    )
      return
    const next = {
      row: row.sectionRowIndex,
      column: (cell as HTMLTableCellElement).cellIndex,
    }
    if (next.row === this.hover?.row && next.column === this.hover.column)
      return
    this.hover = next
    this.refresh()
  }

  /** Starts using the controls: holds the active cell and the caret. */
  private engage(): Cell | undefined {
    this.pinned ??= this.active()
    this.origin ??= this.caret()
    return this.pinned
  }

  /** The caret in this table, when the selection is one. */
  private caret(): Caret | undefined {
    const { selection } = this.view.state
    const cell = this.selected()
    const start = this.tableStart
    if (selection instanceof CellSelection || !cell || start === undefined)
      return undefined
    const map = TableMap.get(this.node)
    const offset =
      selection.head - (start + map.map[cell.row * map.width + cell.column]!)
    return { cell, offset }
  }

  /** Puts a collapsed caret in a cell, at its offset or the end of its text. */
  private collapse(caret: Caret): void {
    const start = this.tableStart
    if (start === undefined) return
    const map = TableMap.get(this.node)
    const row = Math.max(0, Math.min(caret.cell.row, map.height - 1))
    const column = Math.max(0, Math.min(caret.cell.column, map.width - 1))
    const at = start + map.map[row * map.width + column]!
    const { doc } = this.view.state
    const end = at + doc.nodeAt(at)!.nodeSize - 1
    const pos =
      caret.offset === undefined
        ? end
        : Math.max(at + 1, Math.min(at + caret.offset, end))
    const selection = Selection.near(doc.resolve(pos), -1)
    if (!this.view.state.selection.eq(selection))
      this.view.dispatch(this.view.state.tr.setSelection(selection))
  }

  /** Ends using the controls: the caret goes back and the text has focus. */
  private returnToText(caret: Caret | undefined): void {
    this.close()
    this.pinned = undefined
    this.origin = undefined
    this.highlight(undefined)
    if (caret) this.collapse(caret)
    this.view.focus()
    this.refresh()
  }

  /** Highlights a row or column of this table, or none. */
  private highlight(line: { axis: Axis; index: number } | undefined): void {
    const table = this.getPos()
    const next = line && table !== undefined ? { table, ...line } : null
    const current = lineKey.getState(this.view.state) ?? null
    if (
      current === next ||
      (current &&
        next &&
        current.table === next.table &&
        current.axis === next.axis &&
        current.index === next.index)
    )
      return
    this.view.dispatch(
      this.view.state.tr.setMeta(lineKey, next).setMeta('addToHistory', false),
    )
  }

  /** Puts the caret in `cell` to run a command on its row or column; the
   *  caret keeps its place when it is already in that cell. */
  private from(cell: Cell): void {
    const origin = this.origin
    this.collapse(
      origin &&
        origin.cell.row === cell.row &&
        origin.cell.column === cell.column
        ? origin
        : { cell },
    )
  }

  private toggle(axis: Axis): void {
    if (this.suppressClick) {
      this.suppressClick = false
      return
    }
    if (!this.editable) return
    if (this.open === axis) {
      this.returnToText(this.origin ?? (this.pinned && { cell: this.pinned }))
      return
    }
    this.close()
    const cell = this.engage()
    if (!cell) return
    this.open = axis
    this.highlight({
      axis,
      index: axis === 'column' ? cell.column : cell.row,
    })
    this.menus[axis].hidden = false
    this.grips[axis].setAttribute('aria-expanded', 'true')
    // A pointer press leaves focus in the text; the menu takes it, so Escape
    // reaches it and typing can't replace the selected line.
    this.grips[axis].focus({ preventScroll: true })
    this.refresh()
  }

  private close(): void {
    if (!this.open) return
    this.menus[this.open].hidden = true
    this.grips[this.open].setAttribute('aria-expanded', 'false')
    this.open = undefined
  }

  private perform(axis: Axis, action: Action): void {
    const cell = this.pinned ?? this.active()
    if (!this.editable || !cell) return
    const base = this.origin ?? { cell }
    this.close()
    this.highlight(undefined)
    this.from(cell)
    const target = this.after(action.command, cell, base)
    const done = this.run(() =>
      this.then(tableCommand(this.ctx, action.command), target),
    )
    this.returnToText(done ? target : base)
  }

  /** Where the caret goes after a menu command on the line through `cell`:
   *  into the new line after an addition, else back to its own cell. */
  private after(command: TableCommand, cell: Cell, base: Caret): Caret {
    const { row, column } = base.cell
    switch (command) {
      case 'addRowAfter':
        return { cell: { row: cell.row + 1, column } }
      case 'addColumnAfter':
        return { cell: { row, column: cell.column + 1 } }
      case 'deleteRow':
        return row === cell.row
          ? { cell: { row, column } }
          : { ...base, cell: { row: row > cell.row ? row - 1 : row, column } }
      case 'deleteColumn':
        return column === cell.column
          ? { cell: { row, column } }
          : {
              ...base,
              cell: { row, column: column > cell.column ? column - 1 : column },
            }
      default:
        return base
    }
  }

  /** After a command that applied, puts the caret in place within the same
   *  facade call, so its events and any host edit they prompt see a caret,
   *  never the cells a move command selects. */
  private then(applied: boolean, caret: Caret): boolean {
    if (applied) this.collapse(caret)
    return applied
  }

  private run(operation: () => boolean): boolean {
    return this.ctx.get(tableControlCtx.key)(operation)
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      const cell = this.pinned ?? this.active()
      this.returnToText(this.origin ?? (cell && { cell }))
      return
    }
    const target = event.target as HTMLElement
    const move = moves[event.key]
    if (!move || event.altKey || event.metaKey || event.ctrlKey) return
    const [axis, command] = move
    if (target !== this.grips[axis]) return
    event.preventDefault()
    const cell = this.engage()
    if (!this.editable || !cell) return
    this.from(cell)
    // The control, the highlight and the caret follow the moved line.
    const index = axis === 'column' ? 'column' : 'row'
    const to = cell[index] + (/Up|Left/.test(command) ? -1 : 1)
    const origin = this.origin ?? { cell }
    const caret = {
      ...origin,
      cell: {
        ...origin.cell,
        [index]: moved(origin.cell[index], cell[index], to),
      },
    }
    if (!this.run(() => this.then(tableCommand(this.ctx, command), caret)))
      return
    this.pinned = { ...cell, [index]: to }
    this.origin = caret
    this.highlight({ axis, index: to })
    this.refresh()
  }

  private startDrag(axis: Axis, event: PointerEvent): void {
    const cell = this.active()
    if (
      !this.editable ||
      !cell ||
      event.button !== 0 ||
      (axis === 'row' && cell.row === 0)
    )
      return
    const origin = this.caret()
    this.drag = {
      origin,
      axis,
      from: axis === 'column' ? cell.column : cell.row,
      pointer: event.pointerId,
      start: [event.clientX, event.clientY],
    }
    const grip = this.grips[axis]
    grip.setPointerCapture?.(event.pointerId)
    const moved = (next: PointerEvent) => this.dragTo(next)
    const ended = (next: PointerEvent) => {
      grip.removeEventListener('pointermove', moved)
      grip.removeEventListener('pointerup', ended)
      grip.removeEventListener('pointercancel', ended)
      this.endDrag(next.type === 'pointerup')
    }
    grip.addEventListener('pointermove', moved)
    grip.addEventListener('pointerup', ended)
    grip.addEventListener('pointercancel', ended)
  }

  private dragTo(event: PointerEvent): void {
    const drag = this.drag
    if (!drag || event.pointerId !== drag.pointer) return
    const [x, y] = drag.start
    if (
      drag.to === undefined &&
      Math.hypot(event.clientX - x, event.clientY - y) < 4
    )
      return
    const lines =
      drag.axis === 'column'
        ? [...(this.contentDOM.rows[0]?.cells ?? [])]
        : [...this.contentDOM.rows]
    const boxes = lines.map((line) => line.getBoundingClientRect())
    const point = drag.axis === 'column' ? event.clientX : event.clientY
    // The boundary the pointer is nearest to; the header row stays first.
    let boundary = boxes.filter((box) =>
      drag.axis === 'column'
        ? box.left + box.width / 2 < point
        : box.top + box.height / 2 < point,
    ).length
    if (drag.axis === 'row') boundary = Math.max(boundary, 1)
    drag.to = boundary > drag.from ? boundary - 1 : boundary
    const origin = this.dom.getBoundingClientRect()
    const table = this.table.getBoundingClientRect()
    const edge = (index: number) => {
      const box = boxes[Math.min(index, boxes.length - 1)]!
      if (drag.axis === 'column')
        return index < boxes.length ? box.left : box.right
      return index < boxes.length ? box.top : box.bottom
    }
    this.marker.hidden = false
    this.marker.dataset.inkkitAxis = drag.axis
    if (drag.axis === 'column') {
      this.put(
        this.marker,
        edge(boundary) - origin.left,
        table.top - origin.top,
      )
      this.marker.style.height = `${table.height}px`
      this.marker.style.width = ''
    } else {
      this.put(
        this.marker,
        table.left - origin.left,
        edge(boundary) - origin.top,
      )
      this.marker.style.width = `${table.width}px`
      this.marker.style.height = ''
    }
  }

  private endDrag(drop: boolean): void {
    const drag = this.drag
    this.drag = undefined
    this.marker.hidden = true
    if (!drag || drag.to === undefined) return
    // The press was a drag, so the click that follows opens no menu.
    this.suppressClick = true
    setTimeout(() => (this.suppressClick = false))
    const start = this.tableStart
    if (!drop || drag.to === drag.from || start === undefined || !this.editable)
      return
    const cell =
      drag.axis === 'column'
        ? { row: drag.origin?.cell.row ?? 0, column: drag.from }
        : { row: drag.from, column: drag.origin?.cell.column ?? 0 }
    this.close()
    this.highlight(undefined)
    this.origin = drag.origin
    this.from(cell)
    const move = drag.axis === 'column' ? moveColCommand : moveRowCommand
    const index = drag.axis === 'column' ? 'column' : 'row'
    const base = drag.origin ?? { cell }
    const caret = {
      ...base,
      cell: {
        ...base.cell,
        [index]: moved(base.cell[index], drag.from, drag.to),
      },
    }
    const done = this.run(() =>
      this.then(
        this.ctx
          .get(commandsCtx)
          .call(move.key, { from: drag.from, to: drag.to, pos: start }),
        caret,
      ),
    )
    this.hover = undefined
    this.returnToText(done ? caret : base)
  }
}

const tableBlockView = $view(
  tableNode.node,
  (ctx) => (node, view, getPos) => new TableBlockView(ctx, node, view, getPos),
)

/** Node views see document changes only; this passes on selection and
 *  editability changes too. */
const tableControlsPlugin = $prose(
  () =>
    new Plugin<Line | null>({
      key: lineKey,
      state: {
        init: () => null,
        apply: (tr, line) => {
          const next = tr.getMeta(lineKey) as Line | null | undefined
          if (next !== undefined) return next
          if (!line || !tr.docChanged) return line
          const mapped = tr.mapping.mapResult(line.table, -1)
          return mapped.deleted ? null : { ...line, table: mapped.pos }
        },
      },
      props: {
        decorations: (state) => {
          const line = lineKey.getState(state)
          const table = line && state.doc.nodeAt(line.table)
          if (!line || table?.type.name !== 'table') return null
          const map = TableMap.get(table)
          const length = line.axis === 'column' ? map.height : map.width
          if (line.index >= (line.axis === 'column' ? map.width : map.height))
            return null
          const cells = Array.from({ length }, (_, at) => {
            const pos =
              line.table +
              1 +
              map.map[
                line.axis === 'column'
                  ? at * map.width + line.index
                  : line.index * map.width + at
              ]!
            return Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, {
              class: 'inkkit-table-line',
            })
          })
          return DecorationSet.create(state.doc, cells)
        },
      },
      view: (view) => ({
        update: () => {
          for (const table of views.get(view) ?? []) table.refresh()
        },
      }),
    }),
)

export const tableBlock = [
  tableControlCtx,
  tableBlockView,
  tableControlsPlugin,
].flat()
