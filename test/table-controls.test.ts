import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables'
import { undo } from '@milkdown/kit/prose/history'
import { InkKitEditor, type EditorLabels } from '../src/index'

// Escaped pipes, a pipe in code, a link with a title, a hidden author comment
// and a row written without padding: each has to keep its bytes.
const lines = [
  'Intro',
  '',
  '| Name   | Value  |  Note  |',
  '| :----- | -----: | :----: |',
  '| a \\| b | `x\\|y` | [l](u "t") |',
  '| c      | 2      | <!-- c --> |',
  '|  d  |3|e|',
  '',
  'After',
  '',
]
const source = lines.join('\n')
const header = 2,
  delimiter = 3,
  body = 4
const input = { documentId: 'controls', generation: 1, format: 'md' as const }

async function run(
  callback: (
    editor: InkKitEditor,
    ctx: Ctx,
    root: HTMLElement,
    errors: unknown[],
  ) => void | Promise<void>,
  labels: Partial<EditorLabels> = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: unknown[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    },
    { labels },
  )
  const ctx = ctxOf(editor)
  try {
    editor.loadDocument({ ...input, text: source })
    await callback(editor, ctx, root, errors)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

/** Puts the caret in a cell, as a click there would. */
function caret(ctx: Ctx, row: number, column: number) {
  const view = ctx.get(editorViewCtx)
  let pos = -1
  view.state.doc.descendants((node, offset) => {
    if (node.type.name === 'table' && pos < 0) pos = offset
    return pos < 0
  })
  const map = TableMap.get(view.state.doc.nodeAt(pos)!)
  const cell = pos + 1 + map.map[row * map.width + column]!
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, cell + 2)),
  )
}

function control(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [
    ...root.querySelectorAll<HTMLButtonElement>('.inkkit-table-block button'),
  ].filter((button) => button.getAttribute('aria-label') === label)
  expect(found).toHaveLength(1)
  return found[0]!
}

function press(target: HTMLElement, key: string) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
}

const saved = (editor: InkKitEditor) => editor.snapshot().text.split('\n')

/** Saving, reopening and saving again gives the same bytes. */
function reopens(editor: InkKitEditor) {
  const text = editor.snapshot().text
  editor.loadDocument({ ...input, generation: 2, text })
  expect(editor.snapshot().text).toBe(text)
}

/** The cells of a saved row, as authored between its pipes. */
function cells(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())
}

test('the table draws its controls with the label names', () =>
  run(
    (_editor, ctx, root) => {
      caret(ctx, 1, 1)
      const block = root.querySelector('.inkkit-table-block')!
      expect(block.querySelector('table td')).not.toBeNull()
      const names = [...block.querySelectorAll('button')].map((button) =>
        button.getAttribute('aria-label'),
      )
      expect(names.sort()).toEqual(
        [
          'Column',
          'Row',
          'Left',
          'Centre',
          'Right',
          'Add column',
          'Delete column',
          'Add row',
          'Delete row',
        ].sort(),
      )
      for (const button of block.querySelectorAll('button')) {
        expect(button.type).toBe('button')
        expect(button.getAttribute('title')).toBe(
          button.getAttribute('aria-label'),
        )
      }
      expect(
        block
          .querySelector('.inkkit-table-controls')!
          .getAttribute('contenteditable'),
      ).toBe('false')
    },
    {
      tableMoveColumn: 'Column',
      tableMoveRow: 'Row',
      tableAlignLeft: 'Left',
      tableAlignCenter: 'Centre',
      tableAlignRight: 'Right',
    },
  ))

test.each([
  ['Add row', 1, body + 1, 'after'],
  ['Add row', 0, body, 'after the header'],
])(
  '%s on row %i keeps every authored line and inserts one empty row %s',
  (label, row, at) =>
    run((editor, ctx, root) => {
      caret(ctx, row, 0)
      control(root, 'Move row').click()
      control(root, label).click()
      const after = saved(editor)
      expect(after[at]).toMatch(/^\|(?: +\|){3}$/)
      expect([...after.slice(0, at), ...after.slice(at + 1)]).toEqual(lines)
      reopens(editor)
    }),
)

test.each([1, 2, 3])(
  'Delete row on row %i keeps every other authored line, the delimiter row included',
  (row) =>
    run((editor, ctx, root, errors) => {
      caret(ctx, row, 2)
      control(root, 'Move row').click()
      control(root, 'Delete row').click()
      const index = body + row - 1
      expect(saved(editor)).toEqual([
        ...lines.slice(0, index),
        ...lines.slice(index + 1),
      ])
      expect(errors).toEqual([])
      reopens(editor)
    }),
)

test('the header row offers Add row and no Delete row', () =>
  run((editor, ctx, root) => {
    caret(ctx, 0, 0)
    control(root, 'Move row').click()
    expect(control(root, 'Delete row').hidden).toBe(true)
    expect(control(root, 'Add row').hidden).toBe(false)
    expect(editor.snapshot().text).toBe(source)
  }))

test.each([
  ['ArrowDown', 1, [body + 1, body, body + 2]],
  ['ArrowUp', 3, [body, body + 2, body + 1]],
])(
  '%s on the row control moves row %i and keeps every row as authored',
  (key, row, order) =>
    run((editor, ctx, root) => {
      caret(ctx, row, 1)
      const grip = control(root, 'Move row')
      grip.focus()
      press(grip, key)
      expect(saved(editor)).toEqual([
        ...lines.slice(0, body),
        ...order.map((index) => lines[index]!),
        ...lines.slice(body + 3),
      ])
      expect(root.ownerDocument.activeElement).toBe(grip)
      reopens(editor)
    }),
)

test('moving the header row or past the table edge changes nothing', () =>
  run((editor, ctx, root) => {
    caret(ctx, 0, 1)
    press(control(root, 'Move row'), 'ArrowDown')
    caret(ctx, 1, 1)
    press(control(root, 'Move row'), 'ArrowUp')
    caret(ctx, 1, 0)
    press(control(root, 'Move column'), 'ArrowLeft')
    caret(ctx, 1, 2)
    press(control(root, 'Move column'), 'ArrowRight')
    expect(editor.snapshot()).toMatchObject({ text: source, revision: 0 })
  }))

// A column change rewrites every row, so cells keep their authored text and
// the table is padded afresh.
function expectColumns(
  editor: InkKitEditor,
  columns: (number | undefined)[],
  delimiters: RegExp[],
) {
  const after = saved(editor)
  expect(after.slice(0, header)).toEqual(lines.slice(0, header))
  expect(after.slice(body + 3)).toEqual(lines.slice(body + 3))
  for (const line of [header, body, body + 1, body + 2]) {
    const authored = cells(lines[line]!)
    expect(cells(after[line]!)).toEqual(
      columns.map((column) => (column === undefined ? '' : authored[column])),
    )
  }
  const written = cells(after[delimiter]!)
  expect(written).toHaveLength(delimiters.length)
  written.forEach((cell, index) => expect(cell).toMatch(delimiters[index]!))
}

test('Add column adds an empty column after the active one', () =>
  run((editor, ctx, root) => {
    caret(ctx, 2, 0)
    control(root, 'Move column').click()
    control(root, 'Add column').click()
    expectColumns(
      editor,
      [0, undefined, 1, 2],
      [/^:-+$/, /^-+$/, /^-+:$/, /^:-+:$/],
    )
    reopens(editor)
  }))

test.each([
  [0, [1, 2], [/^-+:$/, /^:-+:$/]],
  [2, [0, 1], [/^:-+$/, /^-+:$/]],
])(
  'Delete column %i keeps the other columns, their text and alignment',
  (column, kept, alignment) =>
    run((editor, ctx, root, errors) => {
      caret(ctx, 1, column)
      control(root, 'Move column').click()
      control(root, 'Delete column').click()
      expectColumns(editor, kept, alignment)
      expect(errors).toEqual([])
      reopens(editor)
    }),
)

test.each([
  ['Align left', 1, /^:-+$/],
  ['Align center', 0, /^:-+:$/],
  ['Align right', 2, /^-+:$/],
])(
  '%s on column %i changes only that column’s alignment',
  (label, column, pattern) =>
    run((editor, ctx, root) => {
      caret(ctx, 2, column)
      control(root, 'Move column').click()
      control(root, label).click()
      const expected = [/^:-+$/, /^-+:$/, /^:-+:$/]
      expected[column] = pattern
      expectColumns(editor, [0, 1, 2], expected)
      reopens(editor)
    }),
)

test('ArrowRight on the column control moves the column with its cells and alignment', () =>
  run((editor, ctx, root) => {
    caret(ctx, 3, 0)
    press(control(root, 'Move column'), 'ArrowRight')
    expectColumns(editor, [1, 0, 2], [/^-+:$/, /^:-+$/, /^:-+:$/])
    reopens(editor)
  }))

test('each control action is one undo step back to the authored bytes', () =>
  run((editor, ctx, root) => {
    const view = ctx.get(editorViewCtx)
    for (const [axis, label] of [
      ['Move row', 'Delete row'],
      ['Move row', 'Add row'],
      ['Move column', 'Align center'],
      ['Move column', 'Add column'],
      ['Move column', 'Delete column'],
    ] as const) {
      caret(ctx, 2, 1)
      control(root, axis).click()
      control(root, label).click()
      expect(editor.snapshot().text).not.toBe(source)
      undo(view.state, view.dispatch)
      expect(editor.snapshot().text).toBe(source)
    }
  }))

test('a read-only editor draws no controls and the controls change nothing', () =>
  run((editor, ctx, root) => {
    caret(ctx, 1, 1)
    editor.setEditable(false)
    const controls = root.querySelector<HTMLElement>('.inkkit-table-controls')!
    expect(controls.hidden).toBe(true)
    control(root, 'Move row').click()
    control(root, 'Delete row').click()
    press(control(root, 'Move column'), 'ArrowRight')
    expect(editor.snapshot()).toMatchObject({ text: source, revision: 0 })
  }))

test('Escape closes a menu and returns focus to the text', () =>
  run((editor, ctx, root) => {
    caret(ctx, 1, 1)
    const grip = control(root, 'Move column')
    grip.focus()
    grip.click()
    expect(grip.getAttribute('aria-expanded')).toBe('true')
    const align = control(root, 'Align left')
    expect(align.closest('[hidden]')).toBeNull()
    press(align, 'Escape')
    expect(grip.getAttribute('aria-expanded')).toBe('false')
    expect(root.ownerDocument.activeElement).toBe(ctx.get(editorViewCtx).dom)
    expect(editor.snapshot().text).toBe(source)
  }))

// The delimiter row sits between the header and the first body row, so a row
// added or removed there must not rewrite it.
test.each([
  {
    name: 'CRLF line endings',
    text: 'Intro\r\n\r\n| a  |  b |\r\n|:---|---:|\r\n| 1  |  2 |\r\n| 3  |  4 |\r\n',
    row: 1,
    command: 'deleteRow' as const,
    saved: 'Intro\r\n\r\n| a  |  b |\r\n|:---|---:|\r\n| 3  |  4 |\r\n',
  },
  {
    name: 'a quote',
    text: '> | a | b |\n> |:--|--:|\n> | 1 | 2 |\n> | 3 | 4 |\n',
    row: 1,
    command: 'deleteRow' as const,
    saved: '> | a | b |\n> |:--|--:|\n> | 3 | 4 |\n',
  },
  {
    name: 'its only body row',
    text: '| a | b |\n|:--|--:|\n| 1 | 2 |\n\nAfter\n',
    row: 1,
    command: 'deleteRow' as const,
    saved: '| a | b |\n|:--|--:|\n\nAfter\n',
  },
  {
    name: 'a header-only table',
    text: '| a | b |\n|:--|--:|\n\nAfter\n',
    row: 0,
    command: 'addRowAfter' as const,
    saved: /^\| a \| b \|\n\|:--\|--:\|\n\| +\| +\|\n\nAfter\n$/,
  },
])(
  'a row change after the header keeps the delimiter row in $name',
  ({ text, row, command, saved: expected }) =>
    run(async (editor, ctx) => {
      editor.loadDocument({ ...input, generation: 2, text })
      caret(ctx, row, 0)
      expect(editor.table(command)).toBe(true)
      const written = editor.snapshot().text
      if (typeof expected === 'string') expect(written).toBe(expected)
      else expect(written).toMatch(expected)
      editor.loadDocument({ ...input, generation: 3, text: written })
      expect(editor.snapshot().text).toBe(written)
    }),
)

test('the controls highlight a line and never select one', () =>
  run((_editor, ctx, root) => {
    const view = ctx.get(editorViewCtx)
    const collapsed = () => {
      const { selection } = view.state
      expect(selection).toBeInstanceOf(TextSelection)
      expect(selection.empty).toBe(true)
    }
    const highlighted = () =>
      [...root.querySelectorAll('.inkkit-table-line')].map(
        (cell) => cell.textContent,
      )
    for (const [axis, label, line] of [
      ['Move row', 'Add row', ['c', '2', ' c ']],
      ['Move row', 'Delete row', ['c', '2', ' c ']],
      // The rows added and deleted above leave an empty cell in column 1.
      ['Move column', 'Align right', ['Value', 'x|y', '', '3']],
      ['Move column', 'Add column', ['Value', 'x|y', '', '3']],
      ['Move column', 'Delete column', ['Value', 'x|y', '', '3']],
    ] as const) {
      caret(ctx, 2, 1)
      control(root, axis).click()
      collapsed()
      expect(highlighted()).toEqual(line)
      control(root, label).click()
      collapsed()
      expect(highlighted()).toEqual([])
      expect(view.state.selection).not.toBeInstanceOf(CellSelection)
    }
    caret(ctx, 1, 0)
    const grip = control(root, 'Move row')
    grip.click()
    press(grip, 'Escape')
    collapsed()
    expect(highlighted()).toEqual([])
    grip.focus()
    press(grip, 'ArrowDown')
    collapsed()
    expect(highlighted()[0]).toBe('a | b')
    grip.blur()
    collapsed()
    expect(highlighted()).toEqual([])
  }))

// The facade call's events go out before a control returns, so the caret has
// to be in place inside the call: a host that edits from `changed` must not
// meet the move command's selected row.
const grid =
  '| A | B | C |\n| - | - | - |\n| a | b | c |\n| d | e | f |\n| g | h | i |\n'

async function mountGrid(
  onChanged: (editor: InkKitEditor, ctx: Ctx) => void = () => {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const seen: string[] = []
  let editor!: InkKitEditor
  let ctx!: Ctx
  const record = () => {
    const { selection } = ctx.get(editorViewCtx).state
    seen.push(
      selection instanceof TextSelection && selection.empty
        ? 'caret'
        : selection.constructor.name,
    )
  }
  editor = await InkKitEditor.mount(root, {
    changed() {
      record()
      onChanged(editor, ctx)
    },
    commandStateChanged: () => record(),
  })
  ctx = ctxOf(editor)
  editor.loadDocument({ ...input, generation: 5, text: grid })
  seen.length = 0
  return {
    root,
    editor,
    ctx,
    seen,
    async destroy() {
      await editor.destroy()
      root.remove()
    },
  }
}

/** The caret at the start of a cell's text. */
function caretAtStart(ctx: Ctx, row: number, column: number) {
  caret(ctx, row, column)
  const view = ctx.get(editorViewCtx)
  const { $head } = view.state.selection
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, $head.start()),
    ),
  )
}

test('the events of an arrow-key move see a caret, so an edit from changed types into one cell', async () => {
  let inserted = false
  const grid = await mountGrid((editor) => {
    // Once, for the move's own change.
    if (inserted) return
    inserted = true
    editor.insertText('Z', editor.snapshot().generation)
  })
  try {
    caretAtStart(grid.ctx, 3, 1)
    const row = control(grid.root, 'Move row')
    row.focus()
    grid.seen.length = 0
    inserted = false
    press(row, 'ArrowUp')
    expect(grid.seen.length).toBeGreaterThan(0)
    expect(grid.seen.every((kind) => kind === 'caret')).toBe(true)
    expect(grid.editor.snapshot().text).toBe(
      '| A | B | C |\n| - | - | - |\n| a | b | c |\n| g | Zh | i |\n| d | e | f |\n',
    )
  } finally {
    await grid.destroy()
  }
})

test('the events of a drag see a caret', async () => {
  const grid = await mountGrid()
  try {
    caretAtStart(grid.ctx, 1, 1)
    const row = control(grid.root, 'Move row')
    const pointer = (type: string, clientY: number) =>
      row.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 0,
          clientY,
        }),
      )
    grid.seen.length = 0
    pointer('pointerdown', 0)
    // Without layout every row is at 0, so a drag downwards ends below the last.
    pointer('pointermove', 50)
    pointer('pointerup', 50)
    expect(grid.editor.snapshot().text).toBe(
      '| A | B | C |\n| - | - | - |\n| d | e | f |\n| g | h | i |\n| a | b | c |\n',
    )
    expect(grid.seen.length).toBeGreaterThan(0)
    expect(grid.seen.every((kind) => kind === 'caret')).toBe(true)
  } finally {
    await grid.destroy()
  }
})
