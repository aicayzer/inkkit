import { expect, test } from 'vitest'
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { EditorView } from '@milkdown/kit/prose/view'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createDialect, serialize, stringifyOptions } from '../src/dialect'
import { imageView } from '../src/images'
import { PasteController } from '../src/paste'
import { InkKitEditor, type ImageAdapter } from '../src/index'

const images: ImageAdapter = {
  presentation: (reference) => ({ url: `private://image/${reference}` }),
  importImage: async () => ({ reference: 'images/photo.png' }),
  exportImage: async () => ({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
  }),
}

async function withEditor<T>(
  markdown: string,
  run: (editor: Editor, paste: PasteController) => T | Promise<T>,
): Promise<T> {
  const root = document.createElement('div')
  document.body.append(root)
  let editor!: Editor
  const paste = new PasteController({
    ctx: () => editor.ctx,
    context: () => ({ documentId: 'note', generation: 1, operationId: 'p' }),
    adapter: images,
  })
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
      ctx.set(remarkStringifyOptionsCtx, stringifyOptions)
    })
    .use(createDialect(true))
    .use(imageView(images))
    .use(paste.plugin)
    .create()
  try {
    return await run(editor, paste)
  } finally {
    paste.destroy()
    await editor.destroy()
    root.remove()
  }
}

const parsed = (markdown: string) =>
  withEditor(markdown, (editor) => ({
    markdown: serialize(editor.ctx),
    doc: editor.ctx.get(editorViewCtx).state.doc.toJSON(),
  }))

/** The trimmed source of each cell, row by row, skipping the delimiter row. */
function cells(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    )
}

// Each case is the authored cell source and the source it must save as.
const cases: [string, string][] = [
  ['Tiny ![a](s.png)', 'Tiny ![a](s.png)'],
  ['![a](s.png) tiny', '![a](s.png) tiny'],
  ['![a](s.png) ![b](t.png)', '![a](s.png) ![b](t.png)'],
  ['**z** w', '**z** w'],
  ['w **z**', 'w **z**'],
  ['*z* w', '*z* w'],
  ['w *z*', 'w *z*'],
  ['`a` c', '`a` c'],
  ['c `a`', 'c `a`'],
  ['[l](https://example.com) x', '[l](https://example.com) x'],
  ['x [l](https://example.com)', 'x [l](https://example.com)'],
  ['~~s~~ x', '~~s~~ x'],
  ['x ~~s~~', 'x ~~s~~'],
  ['**z**  w', '**z**  w'],
  ['w **a *b* c** x', 'w **a *b* c** x'],
  ['**a *b*** w', '**a *b*** w'],
  ['**z** \\| w', '**z** \\| w'],
  ['a \\| b', 'a \\| b'],
  ['https://example.com x', 'https://example.com x'],
  ['x https://example.com', 'x https://example.com'],
  ['a\t**z**', 'a\t**z**'],
  ['**z**&#x20;', '**z**&#x20;'],
  ['&#x20;*z*', '&#x20;*z*'],
  ['&#x20;a', '&#x20;a'],
  ['b&#x20;', 'b&#x20;'],
  ['&#x20;&#x20;a&#x20;&#x20;', '&#x20;&#x20;a&#x20;&#x20;'],
  ['&#x20;**z** w', '&#x20;**z** w'],
  ['w `a`&#x20;', 'w `a`&#x20;'],
  ['&#x20;![a](s.png)', '&#x20;![a](s.png)'],
  ['![a](s.png)&#x20;', '![a](s.png)&#x20;'],
  ['&#x20;', '&#x20;'],
  ['&#x9;a', '&#x9;a'],
]

for (const [source, saved] of cases)
  test(`a table cell containing ${JSON.stringify(source)} saves only the entities it needs`, async () => {
    const table = `| ${source} | h |\n| --- | --- |\n| ${source} | b |\n`
    const first = await parsed(table)
    expect(cells(first.markdown)).toEqual([
      [saved, 'h'],
      [saved, 'b'],
    ])
    const second = await parsed(first.markdown)
    expect(second.markdown).toBe(first.markdown)
    expect(second.doc).toEqual(first.doc)
  })

test('a table cell keeps the text it holds after saving and reopening', async () => {
  const { doc } = await parsed(
    '| h |\n| --- |\n| &#x20;&#x20;**z** w ![a](s.png) x&#x20; |\n',
  )
  const cell = doc.content[0].content[1].content[0].content[0].content
  expect(cell.map((node: { text?: string }) => node.text ?? '[image]')).toEqual(
    ['  ', 'z', ' w ', '[image]', ' x '],
  )
})

test('the same text in a paragraph is unchanged', async () => {
  for (const source of [
    '**z** w and `a` c\n',
    'w *z* and [l](https://example.com) x ~~s~~\n',
    'Tiny ![a](s.png) tiny\n',
  ])
    expect((await parsed(source)).markdown).toBe(source)
})

async function pastedHTML(html: string): Promise<string> {
  return withEditor('', async (editor, paste) => {
    await paste.paste({ text: 'plain', html })
    return serialize(editor.ctx)
  })
}

test('pasted table cells with formatted text save plain spaces', async () => {
  const markdown = await pastedHTML(
    '<table><tr><th>h</th><th>i</th></tr><tr><td><b>z</b> w</td><td><code>a</code> c</td></tr><tr><td>w <b>z</b></td><td><em>z</em> w</td></tr></table>',
  )
  expect(markdown).not.toContain('&#x20;')
  expect(cells(markdown)).toEqual([
    ['h', 'i'],
    ['**z** w', '`a` c'],
    ['w **z**', '*z* w'],
  ])
  expect((await parsed(markdown)).markdown).toBe(markdown)
})

function cellTexts(view: EditorView): string[] {
  const texts: string[] = []
  view.state.doc.descendants((node) => {
    if (node.type.name !== 'table_cell' && node.type.name !== 'table_header')
      return true
    texts.push(node.textContent)
    return false
  })
  return texts
}

async function typed(
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
    body(editor, view)
    expect(errors).toEqual([])
    const saved = editor.snapshot().text
    const edited = cellTexts(view)
    editor.loadDocument({
      documentId: 'cells',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot().text).toBe(saved)
    // Whitespace typed at a mark boundary may reopen outside the mark, which the
    // editor's own preservation check already treats as the same document.
    expect(cellTexts(ctx.get(editorViewCtx))).toEqual(edited)
    return saved
  } finally {
    await editor.destroy()
    root.remove()
  }
}

/** Places the caret at an offset into the text node that contains `text`, or beside the nth image. */
function caret(
  view: EditorView,
  at:
    | { text: string; offset: number }
    | { image: number; side: 'before' | 'after' },
) {
  let position = -1
  let images = 0
  view.state.doc.descendants((node, from) => {
    if (position >= 0) return false
    if ('text' in at && node.isText && node.text!.includes(at.text))
      position = from + node.text!.indexOf(at.text) + at.offset
    if ('image' in at && node.type.name === 'image' && images++ === at.image)
      position = at.side === 'before' ? from : from + node.nodeSize
    return true
  })
  expect(position).toBeGreaterThanOrEqual(0)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, position)),
  )
}

test('typing a space before or after an image in a table cell saves a space', async () => {
  const table = '| H | Other |\n| --- | --- |\n| Tiny![a](s.png)tail | b |\n'
  expect(
    await typed(table, (editor, view) => {
      caret(view, { image: 0, side: 'before' })
      editor.insertText(' ', 1)
      caret(view, { image: 0, side: 'after' })
      editor.insertText(' ', 1)
    }),
  ).toBe('| H | Other |\n| --- | --- |\n| Tiny ![a](s.png) tail | b |\n')
})

test('typing a space beside formatted text in a table cell saves a space', async () => {
  const table = '| H | Other |\n| --- | --- |\n| **z**w | x`a` |\n'
  expect(
    await typed(table, (editor, view) => {
      caret(view, { text: 'w', offset: 0 })
      editor.insertText(' ', 1)
      caret(view, { text: 'x', offset: 1 })
      editor.insertText(' ', 1)
    }),
  ).toBe('| H | Other |\n| --- | --- |\n| **z** w | x `a` |\n')
})

test('typing a space at the edge of a table cell saves an entity', async () => {
  const table = '| H | Other |\n| --- | --- |\n| **z** w | `a` |\n'
  expect(
    await typed(table, (editor, view) => {
      caret(view, { text: ' w', offset: 2 })
      editor.insertText(' ', 1)
    }),
  ).toBe('| H | Other |\n| --- | --- |\n| **z** w&#x20; | `a` |\n')
})

test('authored entities beside formatting survive an edit elsewhere in the table', async () => {
  const table =
    '| H | Other |\n| --- | --- |\n| **z**&#x20;w | `a`&#x20;c |\n| x | y |\n'
  expect(
    await typed(table, (editor, view) => {
      caret(view, { text: 'y', offset: 1 })
      editor.insertText('z', 1)
    }),
  ).toBe(
    '| H | Other |\n| --- | --- |\n| **z**&#x20;w | `a`&#x20;c |\n| x | yz |\n',
  )
})

test('authored entities beside formatting survive an edit in the same cell', async () => {
  const table = '| H | Other |\n| --- | --- |\n| **z**&#x20;w | b |\n'
  expect(
    await typed(table, (editor, view) => {
      caret(view, { text: ' w', offset: 2 })
      editor.insertText('x', 1)
    }),
  ).toBe('| H | Other |\n| --- | --- |\n| **z**&#x20;wx | b |\n')
})

test('a space left at the edge of a table cell by a deletion keeps an entity', async () => {
  const table =
    '| H | Other |\n| --- | --- |\n| ![a](s.png) tail | **z** w |\n| head ![b](t.png) | w `c` |\n'
  expect(
    await typed(table, (_editor, view) => {
      const remove = (at: Parameters<typeof caret>[1], size = 1) => {
        caret(view, at)
        const { from } = view.state.selection
        view.dispatch(view.state.tr.delete(from, from + size))
      }
      remove({ image: 0, side: 'before' })
      remove({ text: 'z', offset: 0 })
      remove({ image: 0, side: 'before' })
      remove({ text: 'c', offset: 0 })
    }),
  ).toBe(
    '| H | Other |\n| --- | --- |\n| &#x20;tail | &#x20;w |\n| head&#x20; | w&#x20; |\n',
  )
})

test('typing a space at the start of a table cell before an image saves an entity', async () => {
  const table = '| H | Other |\n| --- | --- |\n| ![a](s.png) | b |\n'
  expect(
    await typed(table, (editor, view) => {
      caret(view, { image: 0, side: 'before' })
      editor.insertText(' ', 1)
      caret(view, { image: 0, side: 'after' })
      editor.insertText(' ', 1)
    }),
  ).toBe('| H | Other |\n| --- | --- |\n| &#x20;![a](s.png)&#x20; | b |\n')
})

test('a space typed after a URL at the end of a table cell saves without joining the URL', async () => {
  const table = '| H | Other |\n| --- | --- |\n| see | b |\n'
  expect(
    await typed(table, (_editor, view) => {
      caret(view, { text: 'see', offset: 3 })
      // What the autolink input rule leaves after a URL and a space.
      const { schema } = view.state
      const link = schema.marks.link!.create({ href: 'https://example.com' })
      view.dispatch(
        view.state.tr.insert(view.state.selection.from, [
          schema.text(' '),
          schema.text('https://example.com', [link]),
          schema.text(' '),
        ]),
      )
    }),
  ).toBe(
    '| H | Other |\n| --- | --- |\n| see <https://example.com>&#x20; | b |\n',
  )
})
