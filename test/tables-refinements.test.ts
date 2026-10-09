import { expect, test } from 'vitest'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import { InkKitEditor, type ImageAdapter } from '../src/index'
import { pasteSpreadsheet } from '../src/spreadsheet'
import { moveRowCommand, moveColCommand } from '@milkdown/kit/preset/gfm'
import { configureTableMovement } from '../src/tables'

async function run(
  callback: (editor: InkKitEditor, ctx: Ctx) => void | Promise<void>,
  images?: ImageAdapter,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
    },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    await callback(editor, ctx)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const input = { documentId: 'tables', generation: 1, format: 'md' as const }
const source =
  '| Key | Value | Third |\n| :--- | ---: | :---: |\n| **z** | [link](/z) | `code` |\n| a | ~~strike~~ | ==highlight== |\n| b | last | end |\n'
function current(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  let pos = -1
  view.state.doc.descendants((node, offset) => {
    if (node.type.name === 'table' && pos < 0) pos = offset
  })
  const table = view.state.doc.nodeAt(pos)!
  return { view, pos, table, map: TableMap.get(table) }
}
function select(
  ctx: Ctx,
  top: number,
  left: number,
  bottom = top + 1,
  right = left + 1,
  text = false,
) {
  const { view, pos, map } = current(ctx)
  const start = pos + 1 + map.map[top * map.width + left]!
  view.dispatch(
    view.state.tr.setSelection(
      text
        ? TextSelection.create(view.state.doc, start + 2)
        : CellSelection.create(
            view.state.doc,
            start,
            pos + 1 + map.map[(bottom - 1) * map.width + right - 1]!,
          ),
    ),
  )
}
function values(ctx: Ctx) {
  const { table } = current(ctx)
  const rows: string[][] = []
  table.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(cell.textContent))
    rows.push(cells)
  })
  return rows
}
function alignments(ctx: Ctx) {
  const { table } = current(ctx)
  const result: string[][] = []
  table.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(cell.attrs.alignment))
    result.push(cells)
  })
  return result
}
function reopen(editor: InkKitEditor, ctx: Ctx) {
  const before = values(ctx)
  const saved = editor.snapshot().text
  editor.loadDocument({ ...input, generation: 2, text: saved })
  expect(editor.snapshot().text).toBe(saved)
  expect(values(ctx)).toEqual(before)
}

test('row movement retains complete marked cell content, fixed header, selected block and isolated undo', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: source })
    select(ctx, 0, 0)
    expect(editor.table('moveRowDown')).toBe(false)
    select(ctx, 1, 0)
    expect(editor.table('moveRowUp')).toBe(false)
    select(ctx, 1, 0, 3, 3)
    expect(editor.table('moveRowDown')).toBe(true)
    expect(values(ctx).map((row) => row[0])).toEqual(['Key', 'b', 'z', 'a'])
    expect(editor.snapshot().text).toContain('**z**')
    expect(editor.snapshot().text).toContain('[link](/z)')
    expect(editor.snapshot().text).toContain('==highlight==')
    const view = ctx.get(editorViewCtx)
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    select(ctx, 2, 0, 3, 3)
    expect(editor.table('moveRowUp')).toBe(true)
    reopen(editor, ctx)
  }))

test('whole columns move complete content and alignment together, including header', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: source })
    select(ctx, 2, 1, 3, 3)
    expect(editor.table('moveColumnLeft')).toBe(true)
    expect(values(ctx)[0]).toEqual(['Value', 'Third', 'Key'])
    expect(
      alignments(ctx).every(
        (row) =>
          JSON.stringify(row) === JSON.stringify(['right', 'center', 'left']),
      ),
    ).toBe(true)
    expect(editor.table('moveColumnLeft')).toBe(false)
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    select(ctx, 1, 0)
    expect(editor.table('moveColumnRight')).toBe(true)
    reopen(editor, ctx)
  }))

test('sort preserves complete rows, header and alignment; text order is explicit and stable', () =>
  run((editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: '| Key | Identity |\n| --- | ---: |\n| b | first |\n| A | upper |\n| a | lower |\n| b | second |\n| | blank |\n',
    })
    select(ctx, 1, 1)
    expect(editor.table('sortRows', { column: 0 })).toBe(true)
    expect(values(ctx).map((row) => row[1])).toEqual([
      'Identity',
      'upper',
      'lower',
      'first',
      'second',
      'blank',
    ])
    expect(alignments(ctx).every((row) => row[1] === 'right')).toBe(true)
    expect(editor.table('sortRows', { column: 0 })).toBe(false)
    expect(editor.table('sortRows', { column: 0, order: 'descending' })).toBe(
      true,
    )
    expect(values(ctx).map((row) => row[1])).toEqual([
      'Identity',
      'first',
      'second',
      'lower',
      'upper',
      'blank',
    ])
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(values(ctx).map((row) => row[1])).toEqual([
      'Identity',
      'upper',
      'lower',
      'first',
      'second',
      'blank',
    ])
    undo(view.state, view.dispatch)
    expect(values(ctx).map((row) => row[1])).toEqual([
      'Identity',
      'first',
      'upper',
      'lower',
      'second',
      'blank',
    ])
    select(ctx, 1, 0)
    editor.table('sortRows')
    reopen(editor, ctx)
  }))

test('numeric ordering supports finite decimals and exponents, stable ties and blanks last', () =>
  run((editor, ctx) => {
    editor.loadDocument({
      ...input,
      text: '| N | ID |\n| --- | --- |\n| 10 | ten |\n| 2e0 | first |\n| +2.0 | second |\n| -.5 | half |\n| | blank |\n',
    })
    select(ctx, 1, 0)
    expect(editor.table('sortRows', { comparison: 'number' })).toBe(true)
    expect(values(ctx).map((row) => row[1])).toEqual([
      'ID',
      'half',
      'first',
      'second',
      'ten',
      'blank',
    ])
    expect(
      editor.table('sortRows', { comparison: 'number', order: 'descending' }),
    ).toBe(true)
    expect(values(ctx).map((row) => row[1])).toEqual([
      'ID',
      'ten',
      'first',
      'second',
      'half',
      'blank',
    ])
    reopen(editor, ctx)
  }))

test.each(['NaN', 'Infinity', '1,000', '2kg', '0x10', '1e999'])(
  'numeric sort rejects %s even beside blanks before modifying source',
  (invalid) =>
    run((editor, ctx) => {
      const text = `| N |\n| --- |\n| |\n| ${invalid} |\n`
      editor.loadDocument({ ...input, text })
      select(ctx, 1, 0)
      expect(() => editor.table('sortRows', { comparison: 'number' })).toThrow(
        RangeError,
      )
      expect(editor.snapshot()).toMatchObject({
        text,
        revision: 0,
        dirty: false,
      })
    }),
)

test('sort validates options and no active table returns false', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: 'Paragraph' })
    expect(editor.table('sortRows')).toBe(false)
    editor.loadDocument({ ...input, generation: 2, text: source })
    select(ctx, 1, 0)
    expect(() => editor.table('sortRows', { column: 99 })).toThrow(RangeError)
    expect(() =>
      editor.table('sortRows', { comparison: 'locale' as 'text' }),
    ).toThrow(RangeError)
    expect(() =>
      editor.table('sortRows', { order: 'random' as 'ascending' }),
    ).toThrow(RangeError)
  }))

test('spreadsheet TSV paste retains cells, quoted values and trailing empty cells while growing the table', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: source })
    select(ctx, 3, 1, 4, 2, true)
    expect(
      pasteSpreadsheet(ctx, { text: '"a ""quote"""\tb\t\r\nx\ty\tlast\r\n' }),
    ).toBe(true)
    expect(values(ctx).slice(3)).toEqual([
      ['b', 'a "quote"', 'b', ''],
      ['', 'x', 'y', 'last'],
    ])
    expect(
      alignments(ctx).every((row) => row[1] === 'right' && row[3] === 'left'),
    ).toBe(true)
    const clip = await editor.clipboardSnapshot()
    expect(clip.text).toContain('a "quote"')
    expect(clip.html).toContain('<table')
    const saved = editor.snapshot().text
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(values(ctx).slice(3)).toEqual([
      ['b', 'a "quote"', 'b', ''],
      ['', 'x', 'y', 'last'],
    ])
  }))

test('spreadsheet selection replacement clears uncovered cells and pads ragged text rows', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: source })
    select(ctx, 1, 0, 3, 3)
    expect(pasteSpreadsheet(ctx, { text: 'one\ttwo\nthree' })).toBe(true)
    expect(values(ctx)).toEqual([
      ['Key', 'Value', 'Third'],
      ['one', 'two', ''],
      ['three', '', ''],
      ['b', 'last', 'end'],
    ])
    reopen(editor, ctx)
  }))

test('HTML spreadsheet paste retains inline marks and empties, uses destination alignment and can replace headers', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: source })
    select(ctx, 0, 0)
    expect(
      pasteSpreadsheet(ctx, {
        text: 'fallback',
        html: '<meta charset="utf-8"><table><tr><td><strong>Rich</strong></td><td></td></tr><tr><td><a href="/target">Link</a> <em>italic</em></td><td><p>two</p></td></tr></table>',
      }),
    ).toBe(true)
    expect(values(ctx).slice(0, 2)).toEqual([
      ['Rich', '', 'Third'],
      ['Link italic', 'two', 'code'],
    ])
    const saved = editor.snapshot().text
    expect(saved).toContain('**Rich**')
    expect(saved).toContain('[Link](/target)')
    expect(alignments(ctx)[0]).toEqual(['left', 'right', 'center'])
    reopen(editor, ctx)
  }))

test.each([
  { text: '"unfinished\tcell' },
  { text: '"closed"tail\tx' },
  { text: '"multi\nline"\tx' },
  { text: '"tab\tinside"\tx' },
  { text: '', html: '<table><tr><td colspan="2">merged</td></tr></table>' },
  {
    text: '',
    html: '<table><tr><td>a</td><td>b</td></tr><tr><td>ragged</td></tr></table>',
  },
  {
    text: '',
    html: '<table><tr><td><p>first</p><p>second</p></td></tr></table>',
  },
  {
    text: '',
    html: '<table><caption>authored</caption><tr><td>cell</td></tr></table>',
  },
  {
    text: '',
    html: '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>',
  },
  { text: '', html: '<table><tr><td><!--retain-->cell</td></tr></table>' },
  { text: '', html: '<table><tr><td><u>unsupported</u></td></tr></table>' },
])(
  'unsupported spreadsheet input rejects without losing original table: %j',
  (clipboard) =>
    run((editor, ctx) => {
      editor.loadDocument({ ...input, text: source })
      select(ctx, 1, 0)
      expect(() => pasteSpreadsheet(ctx, clipboard)).toThrow(
        'cannot be represented safely',
      )
      expect(editor.snapshot()).toMatchObject({
        text: source,
        dirty: false,
        revision: 0,
      })
    }),
)

test('spreadsheet rejects excessive growth and explicit/plain-text paths are left to normal paste', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: source })
    select(ctx, 1, 0)
    expect(() =>
      pasteSpreadsheet(ctx, { text: Array(101).fill('x').join('\t') }),
    ).toThrow()
    expect(() =>
      pasteSpreadsheet(ctx, { text: Array(101).fill('x\ty').join('\n') }),
    ).toThrow()
    expect(pasteSpreadsheet(ctx, { text: 'x\ty', plainText: true })).toBe(false)
    expect(pasteSpreadsheet(ctx, { text: 'x\ty', markdown: 'explicit' })).toBe(
      false,
    )
    expect(editor.snapshot().text).toBe(source)
  }))

test('public paste creates a TSV table with literal edge whitespace and punctuation and isolated undo', () =>
  run(async (editor, ctx) => {
    const text = 'Before\n\n\n'
    editor.loadDocument({ ...input, text })
    const view = ctx.get(editorViewCtx)
    view.dispatch(
      view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
    )
    await editor.paste({
      text: ' Header \tSecond\n **literal** | pipe \t&amp;\n',
    })
    expect(values(ctx)).toEqual([
      [' Header ', 'Second'],
      [' **literal** | pipe ', '&amp;'],
    ])
    const saved = editor.snapshot().text
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(text)
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(values(ctx)).toEqual([
      [' Header ', 'Second'],
      [' **literal** | pipe ', '&amp;'],
    ])
  }))

test('public HTML spreadsheet paste creates a complete table and preserves header column alignment', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: '' })
    await editor.paste({
      text: 'H\tN\na\t2',
      html: '<table><tr><td style="text-align:center">H</td><td align="right">N</td></tr><tr><td>a</td><td>2</td></tr></table>',
    })
    expect(values(ctx)).toEqual([
      ['H', 'N'],
      ['a', '2'],
    ])
    expect(alignments(ctx)).toEqual([
      ['center', 'right'],
      ['center', 'right'],
    ])
    const saved = editor.snapshot().text
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe('')
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(alignments(ctx)).toEqual([
      ['center', 'right'],
      ['center', 'right'],
    ])
  }))

test('one-row TSV retains exactly its header row without inventing body cells', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: '' })
    await editor.paste({ text: 'one\ttwo\t' })
    expect(values(ctx)).toEqual([['one', 'two', '']])
    reopen(editor, ctx)
  }))

test('public malformed TSV rejects outside a table without interpreting Markdown punctuation', () =>
  run(async (editor) => {
    editor.loadDocument({ ...input, text: 'untouched' })
    await expect(
      editor.paste({ text: '"**unfinished\tcell' }),
    ).rejects.toMatchObject({ code: 'preservation' })
    expect(editor.snapshot()).toMatchObject({
      text: 'untouched',
      dirty: false,
      revision: 0,
    })
  }))

test('drag commands use fixed-header complete-content movement, follow selection and isolate undo', () =>
  run((editor, ctx) => {
    editor.loadDocument({ ...input, text: source })
    select(ctx, 1, 0)
    const commands = ctx.get(commandsCtx)
    expect(commands.call(moveRowCommand.key, { from: 0, to: 2 })).toBe(false)
    expect(commands.call(moveRowCommand.key, { from: 2, to: 0 })).toBe(false)
    expect(
      commands.call(moveRowCommand.key, {
        from: 1,
        to: 3,
        pos: current(ctx).pos + 1,
      }),
    ).toBe(true)
    expect(values(ctx).map((row) => row[0])).toEqual(['Key', 'a', 'b', 'z'])
    expect(editor.snapshot().text).toContain('[link](/z)')
    expect(current(ctx).view.state.selection).toBeInstanceOf(CellSelection)
    expect(commands.call(moveColCommand.key, { from: 2, to: 0 })).toBe(true)
    expect(values(ctx)[0]).toEqual(['Third', 'Key', 'Value'])
    expect(
      alignments(ctx).every(
        (row) =>
          JSON.stringify(row) === JSON.stringify(['center', 'left', 'right']),
      ),
    ).toBe(true)
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(values(ctx)[0]).toEqual(['Key', 'Value', 'Third'])
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe(source)
    configureTableMovement(ctx, () => false)
    expect(commands.call(moveRowCommand.key, { from: 1, to: 2 })).toBe(false)
    expect(editor.snapshot().text).toBe(source)
  }))

test('sort keys use readable clipboard content excluding author comments and retaining inline atom labels', () =>
  run(
    (editor, ctx) => {
      editor.loadDocument({
        ...input,
        text: '| N | ID |\n| --- | --- |\n| 10%%secret%% | ten |\n| 2<!--note--> | two |\n| %%blank%% | empty |\n',
      })
      select(ctx, 1, 0)
      expect(editor.table('sortRows', { comparison: 'number' })).toBe(true)
      expect(values(ctx).map((row) => row[1])).toEqual([
        'ID',
        'two',
        'ten',
        'empty',
      ])
      expect(editor.snapshot().text).toContain('%%secret%%')
      expect(editor.snapshot().text).toContain('<!--note-->')
      const view = ctx.get(editorViewCtx)
      undo(view.state, view.dispatch)
      editor.loadDocument({
        ...input,
        generation: 2,
        text: '| N | ID |\n| --- | --- |\n| ![z](/image) | image |\n| a | text |\n| [^a] | footnote |\n\n[^a]: body\n',
      })
      select(ctx, 1, 0)
      expect(editor.table('sortRows')).toBe(true)
      expect(values(ctx).map((row) => row[1])).toEqual([
        'ID',
        'footnote',
        'text',
        'image',
      ])
      expect(editor.snapshot().text).toContain('![z](/image)')
      expect(editor.snapshot().text).toContain('[^a]: body')
    },
    {
      presentation: () => undefined,
      async importImage() {
        return { reference: '/image' }
      },
      async exportImage() {
        return { bytes: new Uint8Array([1]), mimeType: 'image/png' }
      },
    },
  ))

test('unsupported HTML table outside a table retains complete captured source, comments and coherent undo', () =>
  run(async (editor, ctx) => {
    editor.loadDocument({ ...input, text: '' })
    const html =
      '<table><caption>Do not drop</caption><colgroup><col span="2"></colgroup><tr><td>first</td><td>second<!--private--></td></tr></table>'
    await editor.paste({ text: 'first\tsecond', html })
    expect(editor.snapshot().text).toContain(html)
    const copied = await editor.clipboardSnapshot()
    expect(copied.markdown).toContain(html)
    expect(copied.text).not.toContain('private')
    expect(copied.html).not.toContain('private')
    const saved = editor.snapshot().text
    const view = ctx.get(editorViewCtx)
    undo(view.state, view.dispatch)
    expect(editor.snapshot().text).toBe('')
    editor.loadDocument({ ...input, generation: 2, text: saved })
    expect(editor.snapshot().text).toBe(saved)
  }))
