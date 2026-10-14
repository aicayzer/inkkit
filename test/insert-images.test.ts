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

/** Inserts at the current selection and expects the images after `block`, with the source around
 *  them and the selection's text untouched. */
function placesAfter(
  { editor, text, view }: Pick<Harness, 'editor' | 'text' | 'view'>,
  expected: string,
) {
  expect(editor.commandState().commands.insertImages).toBe(true)
  const before = text()
  editor.insertImages(pair)
  expect(text()).toBe(expected)
  expect(view().state.selection.empty).toBe(true)
  expect(editor.undo()).toBe(true)
  expect(text()).toBe(before)
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

test('a selection across cells or selecting cells places the images after the table, keeping every cell', () =>
  run(table, (harness) => {
    const { view, at, select } = harness
    select(at('one', 1), at('three', 2))
    placesAfter(harness, `${table}\n![A](a.png)\n\n![B](b.png)\n`)
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
    harness.editor.insertImages(pair)
    expect(harness.text()).toBe(`${table}\n![A](a.png)\n\n![B](b.png)\n`)
  }))

test('a selection from a paragraph into a cell places the images after the table', () =>
  run(`Intro\n\n${table}`, (harness) => {
    harness.select(harness.at('Intro', 2), harness.at('one', 1))
    placesAfter(harness, `Intro\n\n${table}\n![A](a.png)\n\n![B](b.png)\n`)
  }))

test.each([
  [
    'a code block',
    '```js\nconst a = 1\n```\n\nText\n',
    'const',
    '```js\nconst a = 1\n```\n\n![A](a.png)\n\n![B](b.png)\n\nText\n',
  ],
  [
    'a Mermaid diagram',
    '```mermaid\ngraph TD\nA-->B\n```\n',
    'graph',
    '```mermaid\ngraph TD\nA-->B\n```\n\n![A](a.png)\n\n![B](b.png)\n',
  ],
  [
    'an author comment',
    'Text %%note%% more\n',
    'note',
    'Text %%note%% more\n\n![A](a.png)\n\n![B](b.png)\n',
  ],
  [
    'front matter',
    '---\ntitle: x\n---\n\nText\n',
    'title',
    '---\ntitle: x\n---\n\n![A](a.png)\n\n![B](b.png)\n\nText\n',
  ],
  [
    'a paragraph with inline HTML',
    'Press <kbd>Esc</kbd> to leave\n\nNext\n',
    'leave',
    'Press <kbd>Esc</kbd> to leave\n\n![A](a.png)\n\n![B](b.png)\n\nNext\n',
  ],
  [
    'a paragraph with unresolved brackets',
    '[x] done and dusted\n\nNext\n',
    'done',
    '[x] done and dusted\n\n![A](a.png)\n\n![B](b.png)\n\nNext\n',
  ],
  [
    'a table with inline HTML',
    '| Key | Use |\n| --- | --- |\n| <kbd>Esc</kbd> | leave |\n',
    'leave',
    '| Key | Use |\n| --- | --- |\n| <kbd>Esc</kbd> | leave |\n\n![A](a.png)\n\n![B](b.png)\n',
  ],
  [
    'a code block in a list item',
    '- item\n\n  ```\n  code\n  ```\n\nNext\n',
    'code',
    '- item\n\n  ```\n  code\n  ```\n\n  ![A](a.png)\n\n  ![B](b.png)\n\nNext\n',
  ],
  [
    'a code block that opens a list item',
    '- ```\n  code\n  ```\n- two\n',
    'code',
    '- ```\n  code\n  ```\n- two\n\n![A](a.png)\n\n![B](b.png)\n',
  ],
  [
    'a code block that opens an item of a loose list',
    '- ```\n  code\n  ```\n\n- two\n',
    'code',
    '- ```\n  code\n  ```\n\n- two\n\n![A](a.png)\n\n![B](b.png)\n',
  ],
])(
  'a caret or selection in %s places the images after it and splits nothing',
  (_name, source, find, expected) =>
    run(source, (harness) => {
      harness.select(harness.at(find, 1))
      placesAfter(harness, expected)
      harness.select(harness.at(find, 0), harness.at(find))
      const before = harness.text()
      harness.editor.insertImages(pair)
      expect(harness.text()).toBe(expected)
      expect(before).toBe(source)
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
