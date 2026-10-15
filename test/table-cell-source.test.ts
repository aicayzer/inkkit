import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor, type ImageAdapter } from '../src/index'

const images: ImageAdapter = {
  presentation: (reference) => ({ url: `private://image/${reference}` }),
  importImage: async () => ({ reference: 'images/photo.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
  }),
}

interface Session {
  editor: InkKitEditor
  view: EditorView
  /** Places the caret at an offset into the first text node containing `text`. */
  at(text: string, offset?: number): void
  /** Places the caret at the start of a cell's content. */
  cell(row: number, column: number): void
  type(text: string): void
}

/** Edits `text` through the editor, then checks that the saved Markdown reopens and saves identically,
 *  and that Undo restores the exact source. */
async function edit(
  text: string,
  body: (session: Session) => void,
): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error.message),
    },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    editor.loadDocument({
      documentId: 'cells',
      generation: 1,
      format: 'md',
      text,
    })
    const view = ctx.get(editorViewCtx)
    const select = (position: number) =>
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, position),
        ),
      )
    let steps = 0
    body({
      editor,
      view,
      at(search, offset = search.length) {
        let position = -1
        view.state.doc.descendants((node, from) => {
          if (position < 0 && node.isText && node.text!.includes(search))
            position = from + node.text!.indexOf(search) + offset
          return position < 0
        })
        expect(position, search).toBeGreaterThanOrEqual(0)
        select(position)
      },
      cell(row, column) {
        let rows = -1
        let position = -1
        view.state.doc.descendants((node, from) => {
          if (position >= 0) return false
          if (!node.type.name.endsWith('_row')) return true
          if (++rows === row) {
            position = from + 1
            for (let index = 0; index < column; index++)
              position += node.child(index).nodeSize
          }
          return false
        })
        expect(position).toBeGreaterThanOrEqual(0)
        select(position + 2)
      },
      type(input) {
        expect(editor.insertText(input, 1)).toBe(true)
        steps++
      },
    })
    expect(errors).toEqual([])
    const saved = editor.snapshot().text
    expect(editor.snapshot().dirty).toBe(saved !== text)
    for (let step = 0; step < Math.max(steps, 1) + 2; step++) editor.undo(1)
    expect(editor.snapshot().text).toBe(text)
    expect(editor.snapshot().dirty).toBe(false)
    editor.loadDocument({
      documentId: 'cells',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot().text).toBe(saved)
    expect(errors).toEqual([])
    return saved
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const breaks = [
  '<br>',
  '<br/>',
  '<br />',
  '<br >',
  ' <br> ',
  '  <br/>',
  '<br />  ',
]

for (const spelling of breaks) {
  test(`typing in a table cell keeps ${JSON.stringify(spelling)} in that cell`, async () => {
    const table = `| a | b |\n| - | - |\n| x${spelling}y | q |\n`
    expect(await edit(table, ({ at, type }) => (at('y'), type('Z')))).toBe(
      `| a | b |\n| - | - |\n| x${spelling}yZ | q |\n`,
    )
  })

  test(`typing in another table cell keeps ${JSON.stringify(spelling)}`, async () => {
    const table = `| a${spelling}b | c |\n| - | - |\n| x${spelling}y | q |\n| ${spelling} | x${spelling} |\n`
    expect(await edit(table, ({ at, type }) => (at('q'), type('Z')))).toBe(
      table.replace('| q |', '| qZ |'),
    )
  })
}

test('editing before a line break in a table cell keeps it', async () => {
  const table = '| a | b |\n| - | - |\n| x<br>y | q |\n'
  expect(await edit(table, ({ at, type }) => (at('x', 0), type('Z')))).toBe(
    '| a | b |\n| - | - |\n| Zx<br>y | q |\n',
  )
})

test('deleting text beside a line break in a table cell keeps it', async () => {
  const table = '| a | b |\n| - | - |\n| xx<br/>yy | q |\n'
  expect(
    await edit(table, ({ at, view }) => {
      at('yy', 0)
      const { from } = view.state.selection
      view.dispatch(view.state.tr.delete(from, from + 1))
    }),
  ).toBe('| a | b |\n| - | - |\n| xx<br/>y | q |\n')
})

test('inserting an image in a table cell keeps its line break', async () => {
  const table = '| a | b |\n| - | - |\n| x<br>y | q |\n'
  expect(
    await edit(table, ({ at, view }) => {
      at('y')
      const image = view.state.schema.nodes.image!.create({
        src: 'images/photo.png',
        alt: 'p',
      })
      view.dispatch(view.state.tr.replaceSelectionWith(image))
    }),
  ).toBe('| a | b |\n| - | - |\n| x<br>y![p](images/photo.png) | q |\n')
})

test('a line break in a table cell is part of the editable document', async () => {
  await edit('| a |\n| - |\n| x<br>y |\n', ({ view }) => {
    const cell: string[] = []
    view.state.doc.descendants((node) => {
      if (node.type.name === 'hardbreak') cell.push('break')
      else if (node.isText) cell.push(node.text!)
      return true
    })
    expect(cell).toEqual(['a', 'x', 'break', 'y'])
  })
})

// GFM ignores cells past the header's count, so the grid cannot show or edit them.
const long = '| a | b |\n| - | - |\n| `p | q` | r |\n| s | t |\n'

test('a table with a row longer than its header stays as authored source', async () => {
  await edit(long, ({ view }) => {
    expect(view.state.doc.firstChild!.type.name).toBe('literal_markdown')
    expect(view.state.doc.textContent).toBe(long.slice(0, -1))
  })
})

for (const [search, edited] of [
  ['r', '| `p | q` | rZ |'],
  ['`p', '| `pZ | q` | r |'],
  ['a', '| aZ | b |'],
  ['t', '| s | tZ |'],
] as const)
  test(`typing after ${search} in a table with a long row changes only that text`, async () => {
    const saved = await edit(long, ({ at, type }) => (at(search), type('Z')))
    const expected = long.split('\n')
    const line = expected.findIndex(
      (value) => value.replace(/Z/g, '') === edited.replace(/Z/g, ''),
    )
    expected[line] = edited
    expect(saved).toBe(expected.join('\n'))
  })

const short = '| a | b |\n| - | - |\n| x |\n| y | z |\n'

test('typing in a full row of a table with a short row keeps the short row', async () => {
  expect(await edit(short, ({ at, type }) => (at('z'), type('Z')))).toBe(
    '| a | b |\n| - | - |\n| x |\n| y | zZ |\n',
  )
})

test('typing in a short row keeps it short', async () => {
  expect(await edit(short, ({ at, type }) => (at('x'), type('Z')))).toBe(
    '| a | b |\n| - | - |\n| xZ |\n| y | z |\n',
  )
})

test('typing in the header of a table with a short row keeps the short row', async () => {
  expect(await edit(short, ({ at, type }) => (at('b'), type('Z')))).toBe(
    '| a | bZ |\n| - | - |\n| x |\n| y | z |\n',
  )
})

test('typing in a cell missing from a short row adds only that cell', async () => {
  expect(await edit(short, ({ cell, type }) => (cell(1, 1), type('Z')))).toBe(
    '| a | b |\n| - | - |\n| x | Z |\n| y | z |\n',
  )
})

test('short rows without outer pipes keep their source', async () => {
  const bare = 'a | b | c\n--- | --- | ---\n__x__\ny | z | w\n'
  expect(await edit(bare, ({ at, type }) => (at('w'), type('Z')))).toBe(
    'a | b | c\n--- | --- | ---\n__x__\ny | z | wZ\n',
  )
  expect(await edit(bare, ({ cell, type }) => (cell(1, 2), type('Z')))).toBe(
    'a | b | c\n--- | --- | ---\n__x__ |   | Z\ny | z | w\n',
  )
})

test('a short row reads as a full row of the editable table', async () => {
  await edit(short, ({ view }) => {
    const table = view.state.doc.firstChild!
    expect(table.type.name).toBe('table')
    table.forEach((row) => expect(row.childCount).toBe(2))
  })
})

const mixed =
  '| a | b | c |\n| - | - | - |\n| x<br>1 |\n| y | z |\n| w | v | u |\n'

for (const [command, expected] of [
  [
    'moveRowDown',
    '| a | b | c |\n| - | - | - |\n| y | z |\n| x<br>1 |\n| w | v | u |\n',
  ],
  [
    'sortRows',
    '| a | b | c |\n| - | - | - |\n| y | z |\n| x<br>1 |\n| w | v | u |\n',
  ],
  [
    'moveColumnRight',
    '| b | a | c |\n| - | - | - |\n| | x<br>1 |\n| z | y |\n| v | w | u |\n',
  ],
] as const)
  test(`${command} keeps short rows short`, async () => {
    expect(
      await edit(mixed, ({ editor, at }) => {
        at('x')
        expect(
          editor.table(
            command,
            command === 'sortRows' ? { order: 'descending' } : undefined,
          ),
        ).toBe(true)
      }),
    ).toBe(expected)
  })

test('short rows in a quoted table keep their source', async () => {
  const quoted = '> | a | b |\n> | - | - |\n> | x |\n> | y | z |\n'
  expect(await edit(quoted, ({ at, type }) => (at('x'), type('Z')))).toBe(
    '> | a | b |\n> | - | - |\n> | xZ |\n> | y | z |\n',
  )
  expect(await edit(quoted, ({ cell, type }) => (cell(1, 1), type('Z')))).toBe(
    '> | a | b |\n> | - | - |\n> | x | Z |\n> | y | z |\n',
  )
})

test('clearing a table cell leaves it empty rather than a line break', async () => {
  expect(
    await edit('| a | b |\n| - | - |\n| x | y |\n', ({ at, view }) => {
      at('x', 0)
      const { from } = view.state.selection
      view.dispatch(view.state.tr.delete(from, from + 1))
    }),
  ).toBe('| a | b |\n| - | - |\n|   | y |\n')
})

const empty = '| a | b |\n| - | - |\n| x |  |\n| y | z |\n'

test('typing in another row keeps an authored empty cell empty', async () => {
  expect(await edit(empty, ({ at, type }) => (at('y'), type('Z')))).toBe(
    '| a | b |\n| - | - |\n| x |  |\n| yZ | z |\n',
  )
})

test('typing beside an authored empty cell keeps it empty', async () => {
  expect(await edit(empty, ({ at, type }) => (at('x'), type('Z')))).toBe(
    '| a | b |\n| - | - |\n| xZ |  |\n| y | z |\n',
  )
})

test('a new row saves its cells empty', async () => {
  const saved = await edit(empty, ({ editor, at }) => {
    at('y')
    expect(editor.table('addRowAfter')).toBe(true)
  })
  expect(saved).not.toContain('<br')
  expect(saved.split('\n').slice(0, 4).join('\n')).toBe(
    empty.split('\n').slice(0, 4).join('\n'),
  )
})

const shiftEnter = (editor: InkKitEditor) =>
  editor.keyDown({ key: 'Enter', code: 'Enter', shiftKey: true }, 1)

for (const [name, offset, saved] of [
  ['in the middle of', 1, '| a | b |\n| - | - |\n| x<br />y | q |\n'],
  ['at the start of', 0, '| a | b |\n| - | - |\n| <br />xy | q |\n'],
  ['at the end of', 2, '| a | b |\n| - | - |\n| xy<br /> | q |\n'],
] as const)
  test(`a hard break typed ${name} a table cell saves as <br />`, async () => {
    expect(
      await edit('| a | b |\n| - | - |\n| xy | q |\n', ({ editor, at }) => {
        at('xy', offset)
        shiftEnter(editor)
      }),
    ).toBe(saved)
  })

test('a line break inserted as text at the start of a table cell saves as <br />', async () => {
  expect(
    await edit('| a | b |\n| - | - |\n| xy | q |\n', ({ at, type }) => {
      at('xy', 0)
      type('\n')
    }),
  ).toBe('| a | b |\n| - | - |\n| <br />xy | q |\n')
})

test('an edit keeps the spelling of an unchanged row that matches another', async () => {
  const table = '| *i* |\n| - |\n| _i_ |\n'
  expect(await edit(table, ({ at, type }) => (at('i'), type('Z')))).toBe(
    '| *iZ* |\n| - |\n| _i_ |\n',
  )
})

test('an edit keeps the spelling of an unchanged cell that matches another', async () => {
  const table = '| a | b |\n| - | - |\n| *i* | _i_ |\n'
  expect(await edit(table, ({ at, type }) => (at('i'), type('Z')))).toBe(
    '| a | b |\n| - | - |\n| *iZ* | _i_ |\n',
  )
})

for (const [name, at, saved] of [
  [
    'after a break that ends a table cell',
    ['x', 1],
    '| a | x<br><br /> |\n| - | - |\n',
  ],
  [
    'in a table cell that holds only a break',
    null,
    '| a | <br><br /> |\n| - | - |\n',
  ],
] as const)
  test(`Shift-Enter ${name} keeps the table's shape`, async () => {
    const table =
      at == null ? '| a | <br> |\n| - | - |\n' : '| a | x<br> |\n| - | - |\n'
    expect(
      await edit(table, ({ editor, view, at: place, cell }) => {
        if (at == null) {
          cell(0, 1)
          const $pos = view.state.selection.$from
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, $pos.end()),
            ),
          )
        } else {
          place(at[0], at[1])
          const $pos = view.state.selection.$from
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, $pos.end()),
            ),
          )
        }
        shiftEnter(editor)
      }),
    ).toBe(saved)
  })

test('repeated Shift-Enter in a table cell adds one break each time', async () => {
  expect(
    await edit('| a | b |\n| - | - |\n| xy | q |\n', ({ editor, at }) => {
      at('xy', 0)
      shiftEnter(editor)
      shiftEnter(editor)
      at('y', 0)
      shiftEnter(editor)
      shiftEnter(editor)
      at('q')
      shiftEnter(editor)
      shiftEnter(editor)
    }),
  ).toBe(
    '| a | b |\n| - | - |\n| <br /><br />x<br /><br />y | q<br /><br /> |\n',
  )
})

test('an edited row does not take the source of a later row it now matches', async () => {
  const table = '| a | b |\n| - | - |\n| x<br/>y | bb |\n| x<br />y |  |\n'
  expect(
    await edit(table, ({ at, view }) => {
      at('bb', 0)
      const { from } = view.state.selection
      view.dispatch(view.state.tr.delete(from, from + 2))
    }),
  ).toBe('| a | b |\n| - | - |\n| x<br/>y |   |\n| x<br />y |  |\n')
})

test('a cleared short row without outer pipes keeps its cells when a missing cell is filled', async () => {
  const bare = 'a | b | c\n--- | --- | ---\nx\ny | z | w\n'
  const saved = await edit(bare, ({ at, view, cell, type }) => {
    at('x', 0)
    const { from } = view.state.selection
    view.dispatch(view.state.tr.delete(from, from + 1))
    cell(1, 2)
    type('Z')
  })
  expect(saved.split('\n')[3]).toBe('y | z | w')
  expect(saved.split('\n').slice(0, 2)).toEqual(bare.split('\n').slice(0, 2))
})

for (const table of [
  '| a | b | c |\n| - | - | - |\n|| c |\n',
  '| a | b | c |\n| - | - | - |\n|  | c |\n',
  '| a | b | c |\n| - | - | - |\n| x |  | c |\n',
  '| a | b |\n| - | - |\n|  |  |\n',
])
  test(`typing a space into an empty cell of ${JSON.stringify(table)} saves it`, async () => {
    const saved = await edit(table, ({ cell, type }) => {
      cell(1, table.includes('| x |') ? 1 : 0)
      type(' ')
    })
    expect(saved).toContain('&#x20;')
  })

for (const [cellSource, find, offset, saved] of [
  ['**bold**', 'bold', 2, '**bo**<br />**ld**'],
  ['**bold**', 'bold', 0, '<br />**bold**'],
  ['**bold**', 'bold', 4, '**bold**<br />'],
  ['x _i_ y', 'i', 0, 'x <br />_i_ y'],
  ['x _i_ y', 'i', 1, 'x _i_<br /> y'],
  [
    '[link](https://e.com)',
    'link',
    2,
    '[li](https://e.com)<br />[nk](https://e.com)',
  ],
  ['[link](https://e.com) z', 'link', 4, '[link](https://e.com)<br /> z'],
] as const)
  test(`Shift-Enter at ${offset} in ${JSON.stringify(find)} of a cell holding ${JSON.stringify(cellSource)} saves a break outside the formatting`, async () => {
    const table = `| a | b |\n| - | - |\n| ${cellSource} | q |\n`
    expect(
      await edit(table, ({ editor, at }) => {
        at(find, offset)
        shiftEnter(editor)
      }),
    ).toBe(`| a | b |\n| - | - |\n| ${saved} | q |\n`)
  })

for (const table of [
  '| a |\n|--:|\n| x |\n',
  '| a |\n| - |\n| x |\n',
  '| a |\n| --- |\n| x |\n| y |\n',
  '| a | b |\n|--:|:-:|\n| x | y |\n',
])
  test(`adding a row to the table ${JSON.stringify(table)} saves it`, async () => {
    const saved = await edit(table, ({ editor, at }) => {
      at('x')
      expect(editor.table('addRowAfter')).toBe(true)
    })
    expect(saved.startsWith(table.split('\n').slice(0, 3).join('\n'))).toBe(
      true,
    )
    expect(saved.split('\n').filter(Boolean)).toHaveLength(
      table.split('\n').filter(Boolean).length + 1,
    )
  })
