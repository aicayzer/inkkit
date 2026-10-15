import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { InkKitEditor } from '../src/index'
import { roundTrip } from './harness'

/** Edits `text` through the editor and checks that the saved Markdown reopens and saves identically,
 *  and that Undo restores the exact source. */
async function edit(
  text: string,
  body: (editor: InkKitEditor, view: EditorView) => void,
): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: string[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error.message),
    },
    {
      images: {
        presentation: (reference) => ({ url: `private://${reference}` }),
        importImage: async () => ({ reference: 'a.png' }),
        exportImage: async () => ({
          bytes: new Uint8Array([1]),
          mimeType: 'image/png',
        }),
      },
    },
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    editor.loadDocument({
      documentId: 'list',
      generation: 1,
      format: 'md',
      text,
    })
    body(editor, ctx.get(editorViewCtx))
    expect(errors).toEqual([])
    const saved = editor.snapshot().text
    expect(editor.snapshot().dirty).toBe(saved !== text)
    for (let step = 0; step < 4; step++) editor.undo(1)
    expect(editor.snapshot().text).toBe(text)
    expect(editor.snapshot().dirty).toBe(false)
    editor.loadDocument({
      documentId: 'list',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot().text).toBe(saved)
    return saved
  } finally {
    await editor.destroy()
    root.remove()
  }
}

/** Types `insert` after the first occurrence of `after`. */
function typeAfter(
  editor: InkKitEditor,
  view: EditorView,
  after: string,
  insert: string,
) {
  let position = -1
  view.state.doc.descendants((node, from) => {
    if (position < 0 && node.isText && node.text!.includes(after))
      position = from + node.text!.indexOf(after) + after.length
    return position < 0
  })
  expect(position).toBeGreaterThanOrEqual(0)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, position)),
  )
  expect(editor.insertText(insert, 1)).toBe(true)
}

const tight = '- ```\n  code\n  ```\n- two\n'
const loose = '- ```\n  code\n  ```\n\n- two\n'
const ordered = '1. ```js\n   code\n   ```\n2. two\n'

for (const [name, source] of [
  ['a tight', tight],
  ['a loose', loose],
  ['an ordered', ordered],
] as const) {
  test(`typing in a code fence that opens ${name} list item keeps the item's first line`, async () => {
    expect(
      await edit(source, (editor, view) =>
        typeAfter(editor, view, 'code', 'Z'),
      ),
    ).toBe(source.replace('code', 'codeZ'))
  })

  test(`typing in the item after ${name} list item that opens with a fence keeps it`, async () => {
    expect(
      await edit(source, (editor, view) => typeAfter(editor, view, 'two', 'Z')),
    ).toBe(source.replace('two', 'twoZ'))
  })

  test(`${name} list item that opens with a fence saves in its authored form`, async () => {
    expect(await roundTrip(source)).not.toContain('<br />')
  })
}

test('typing in a paragraph after the fence inside the item keeps the first line', async () => {
  const source = '- ```\n  code\n  ```\n\n  after\n- two\n'
  expect(
    await edit(source, (editor, view) => typeAfter(editor, view, 'after', 'Z')),
  ).toBe(source.replace('after', 'afterZ'))
})

test('a list item that opens with a heading or a nested list saves in its authored form', async () => {
  for (const source of ['- # Title\n  text\n', '- - inner\n- outer\n'])
    expect(await roundTrip(source)).toBe(source)
})

test('an empty first line followed by text in a list item stays a spacer', async () => {
  const source = '- <br />\n  text\n'
  expect(await roundTrip(source)).toBe(source)
})

test('an authored <br /> line before a fence that opens a list item is kept', async () => {
  for (const source of [
    '- <br />\n\n  ```\n  code\n  ```\n- two\n',
    '- <br>\n\n  ```\n  code\n  ```\n\n- two\n',
  ])
    expect(
      await edit(source, (editor, view) =>
        typeAfter(editor, view, 'code', 'Z'),
      ),
    ).toBe(source.replace('code', 'codeZ'))
})

test('deleting an authored <br /> line in a list item saves without it', async () => {
  const source = '- <br />\n\n  text\n- two\n'
  expect(
    await edit(source, (_editor, view) => {
      let from = -1
      view.state.doc.descendants((node, position) => {
        if (from < 0 && node.type.name === 'paragraph' && !node.content.size)
          from = position
        return from < 0
      })
      expect(from).toBeGreaterThanOrEqual(0)
      view.dispatch(view.state.tr.delete(from, from + 2))
    }),
  ).not.toContain('<br')
})

test('deleting the text before a fence in a task item keeps its checkbox', async () => {
  const source = '- [ ] eps\n\n  ```\n  code\n  ```\n'
  const saved = await edit(source, (_editor, view) => {
    let from = -1
    view.state.doc.descendants((node, position) => {
      if (from < 0 && node.isText && node.text === 'eps') from = position
      return from < 0
    })
    view.dispatch(view.state.tr.delete(from, from + 3))
  })
  expect(saved.startsWith('- [ ]')).toBe(true)
  expect(saved).toContain('  ```\n  code\n  ```\n')
})

test('a task item with an empty first line before a block keeps its checkbox', async () => {
  for (const source of [
    '- [x] <br />\n  - inner\n',
    '- [ ] <br />\n\n  ```\n  code\n  ```\n',
  ])
    expect(await roundTrip(source)).toContain(source.slice(0, 5))
  const list = '- [ ] <br />\n\n  ```\n  code\n  ```\n- two\n'
  expect(
    await edit(list, (editor, view) => typeAfter(editor, view, 'two', 'Z')),
  ).toBe(list.replace('two', 'twoZ'))
})

for (const [name, block] of [
  ['setext heading', 'Title\n  ===\n'],
  ['indented code', '    code\n'],
  ['table', '| a  |  b |\n  |:---|---:|\n  | x  |  y |\n'],
] as const)
  test(`emptying the first line of a loose item keeps its ${name} as authored`, async () => {
    const source = `- first\n\n  ${block}- two\n`
    const saved = await edit(source, (_editor, view) => {
      let from = -1
      view.state.doc.descendants((node, position) => {
        if (from < 0 && node.isText && node.text === 'first') from = position
        return from < 0
      })
      view.dispatch(view.state.tr.delete(from, from + 5))
    })
    expect(saved).toBe(`- <br />\n\n  ${block}- two\n`)
  })

for (const [name, source] of [
  ['a tight', '- ```\n  ```\n- two\n'],
  ['a loose', '- ```\n  ```\n\n- two\n'],
] as const) {
  test(`${name} list item that opens with an empty fence saves in its authored form`, async () => {
    expect(await roundTrip(source)).toBe(source)
    expect(
      await edit(source, (editor, view) => typeAfter(editor, view, 'two', 'Z')),
    ).toBe(source.replace('two', 'twoZ'))
  })

  test(`typing into an empty fence that opens ${name} list item keeps the item's first line`, async () => {
    expect(
      await edit(source, (editor, view) => {
        let position = -1
        view.state.doc.descendants((node, from) => {
          if (position < 0 && node.type.name === 'code_block')
            position = from + 1
          return position < 0
        })
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, position),
          ),
        )
        expect(editor.insertText('x', 1)).toBe(true)
      }),
    ).toBe(source.replace('```\n  ```', '```\n  x\n  ```'))
  })

  test(`clearing the fence that opens ${name} list item leaves it empty`, async () => {
    const filled = source.replace('```\n  ```', '```\n  code\n  ```')
    expect(
      await edit(filled, (_editor, view) => {
        let from = -1
        view.state.doc.descendants((node, position) => {
          if (from < 0 && node.isText && node.text === 'code') from = position
          return from < 0
        })
        view.dispatch(view.state.tr.delete(from, from + 4))
      }),
    ).toBe(source)
  })
}
