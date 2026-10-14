import { expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, InkKitError, type ImageAdapter } from '../src/index'

const images: ImageAdapter = {
  presentation: (reference) => ({ url: `blob:image/${reference}` }),
  importImage: async () => ({ reference: 'imported.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
  }),
}

const table =
  '| Name | Size |\n| --- | --- |\n| one | two |\n| three | four |\n'
const pair = [
  { path: 'a.png', alt: 'A' },
  { path: 'b.png', alt: 'B' },
]

interface Harness {
  editor: InkKitEditor
  view: () => EditorView
  changed: ReturnType<typeof vi.fn>
  text: () => string
  /** Position `offset` characters into the first text node containing `find`. */
  at: (find: string, offset?: number) => number
  select: (anchor: number, head?: number) => void
}

async function run(
  text: string,
  body: (harness: Harness) => void | Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const changed = vi.fn()
  const editor = await InkKitEditor.mount(
    root,
    { changed, stateChanged() {}, copy() {}, openLink() {} },
    { images },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  const view = () => ctx.get(editorViewCtx)
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text,
    })
    changed.mockClear()
    await body({
      editor,
      view,
      changed,
      text: () => editor.snapshot().text,
      at(find, offset = find.length) {
        let found = -1
        view().state.doc.descendants((node, pos) => {
          if (found < 0 && node.isText && node.text!.includes(find))
            found = pos + node.text!.indexOf(find) + offset
        })
        expect(found).toBeGreaterThanOrEqual(0)
        return found
      },
      select(anchor, head = anchor) {
        view().dispatch(
          view().state.tr.setSelection(
            TextSelection.create(view().state.doc, anchor, head),
          ),
        )
      },
    })
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function rejects(editor: InkKitEditor, text: () => string, changed: unknown) {
  const before = text()
  let error: unknown
  try {
    editor.insertImages(pair)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(InkKitError)
  expect((error as InkKitError).code).toBe('invalid-range')
  expect(text()).toBe(before)
  expect(changed).not.toHaveBeenCalled()
  expect(editor.undo()).toBe(false)
}

test('a caret in a table cell inserts the image inline and leaves the other cells alone', () =>
  run(table, ({ editor, view, text, at, select }) => {
    select(at('two'))
    editor.insertImages([pair[0]!])
    expect(text()).toBe(
      '| Name | Size |\n| --- | --- |\n| one | two![A](a.png) |\n| three | four |\n',
    )
    expect(view().state.selection.$head.parent.type.name).toBe('paragraph')
    expect(view().state.selection.$head.node(-1).type.name).toBe('table_cell')
    // The caret is after the image, so typing continues in the cell.
    editor.insertText('!', 1)
    expect(text()).toContain('| two![A](a.png)! |')
  }))

test('several images go inline in the cell on one line, in order', () =>
  run(table, ({ editor, text, at, select }) => {
    select(at('one', 1))
    editor.insertImages([...pair, { path: 'c.png', alt: 'C', title: 'Third' }])
    expect(text()).toBe(
      '| Name | Size |\n| --- | --- |\n| o![A](a.png)![B](b.png)![C](c.png "Third")ne | two |\n| three | four |\n',
    )
  }))

test('a selection inside a cell is replaced', () =>
  run(table, ({ editor, text, at, select }) => {
    select(at('three', 0), at('three'))
    editor.insertImages(pair)
    expect(text()).toBe(
      '| Name | Size |\n| --- | --- |\n| one | two |\n| ![A](a.png)![B](b.png) | four |\n',
    )
  }))

test('an empty cell and a header cell take images inline', () =>
  run(
    '| Name | Size |\n| --- | --- |\n|  | two |\n',
    ({ editor, view, text, at, select }) => {
      select(at('Name'))
      editor.insertImages([pair[0]!])
      let empty = -1
      view().state.doc.descendants((node, pos) => {
        if (empty < 0 && node.type.name === 'table_cell' && !node.textContent)
          empty = pos + 2
      })
      select(empty)
      editor.insertImages([pair[1]!])
      // The saved table may pad its columns; it must keep each image in its own cell.
      const [header, , row] = text().split('\n')
      expect(header).toBe('| Name![A](a.png) | Size |')
      expect(row).toMatch(/^\| !\[B\]\(b\.png\) +\| two \|$/)
    },
  ))

test('one undo removes all the images and one redo restores them', () =>
  run(table, ({ editor, text, at, select }) => {
    select(at('four'))
    editor.insertImages(pair)
    const inserted = text()
    expect(inserted).toContain('| three | four![A](a.png)![B](b.png) |')
    expect(editor.undo()).toBe(true)
    expect(text()).toBe(table)
    expect(editor.snapshot().dirty).toBe(false)
    expect(editor.redo()).toBe(true)
    expect(text()).toBe(inserted)
  }))

test('the saved Markdown reopens and saves identically', async () => {
  let saved = ''
  await run(table, ({ editor, text, at, select }) => {
    select(at('two'))
    editor.insertImages(pair)
    saved = text()
  })
  await run(saved, ({ text }) => {
    expect(text()).toBe(saved)
  })
})

test('a table written by hand keeps the spelling of cells that were not edited', async () => {
  const hand = '|Name|  Size |\n|:--|--:|\n|  one |two   |\n|three|  four|\n'
  await run(hand, ({ editor, text, at, select }) => {
    select(at('two'))
    editor.insertImages([pair[0]!])
    expect(text()).toBe(
      '|Name|  Size |\n|:--|--:|\n|  one |two![A](a.png) |\n|three|  four|\n',
    )
  })
})

test('alt text and titles with pipes or line breaks stay on one line in a cell', () =>
  run(table, ({ editor, text, at, select }) => {
    select(at('two'))
    editor.insertImages([
      { path: 'a.png', alt: 'left | right', title: 'first\nsecond' },
    ])
    const [, , row] = text().split('\n')
    expect(row).toBe('| one | two![left \\| right](a.png "first second") |')
  }))

test('a selection that spans cells rejects and changes nothing', () =>
  run(table, ({ editor, view, text, at, select, changed }) => {
    select(at('one', 1), at('three', 2))
    rejects(editor, text, changed)
    let first = -1
    let last = -1
    view().state.doc.descendants((node, pos) => {
      if (node.type.name !== 'table_cell') return
      if (first < 0) first = pos
      last = pos
    })
    view().dispatch(
      view().state.tr.setSelection(
        CellSelection.create(view().state.doc, first, last),
      ),
    )
    rejects(editor, text, changed)
    expect(editor.commandState().commands.insertImages).toBe(false)
  }))

test('a selection from a paragraph into a cell rejects', () =>
  run(`Intro\n\n${table}`, ({ editor, text, at, select, changed }) => {
    select(at('Intro', 2), at('one', 1))
    rejects(editor, text, changed)
  }))

test.each([
  ['a code block', '```js\nconst a = 1\n```\n', 'const', 'const a'],
  ['a Mermaid diagram', '```mermaid\ngraph TD\nA-->B\n```\n', 'graph', 'graph'],
  ['an author comment', 'Text %%note%% more\n', 'note', 'note'],
  ['front matter', '---\ntitle: x\n---\n\nText\n', 'title', 'title'],
])(
  'a caret or selection in %s rejects and changes nothing',
  (_name, source, find, selected) =>
    run(source, ({ editor, text, at, select, changed }) => {
      select(at(find, 1))
      expect(editor.commandState().commands.insertImages).toBe(false)
      rejects(editor, text, changed)
      select(at(selected, 0), at(selected))
      rejects(editor, text, changed)
    }),
)

test('a paragraph, heading and list item still receive images as blocks', () =>
  run('# Title\n\n- item\n', ({ editor, text, at, select }) => {
    select(at('Title'))
    expect(editor.commandState().commands.insertImages).toBe(true)
    editor.insertImages([pair[0]!])
    select(at('item'))
    editor.insertImages([pair[1]!])
    expect(text()).toBe('# Title\n\n![A](a.png)\n\n- item\n\n  ![B](b.png)\n')
  }))

test('availability is true in a cell, and an image after the table still goes below it', () =>
  run(`${table}\nAfter\n`, ({ editor, text, at, select }) => {
    select(at('one'))
    expect(editor.commandState().commands.insertImages).toBe(true)
    select(at('After'))
    editor.insertImages([pair[0]!])
    expect(text()).toBe(`${table}\nAfter\n\n![A](a.png)\n`)
  }))
