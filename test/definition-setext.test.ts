import { afterEach, expect, test, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { InkKitEditor } from '../src/index'
import { Preservation, PreservationError } from '../src/preserve'

async function run(
  callback: (editor: InkKitEditor, ctx: Ctx, errors: Error[]) => void,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(
    root,
    {
      changed() {},
      stateChanged() {},
      copy() {},
      openLink() {},
      error: (error) => errors.push(error),
    },
    {},
  )
  const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
  try {
    callback(editor, ctx, errors)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

const input = { documentId: 'setext', generation: 1, format: 'md' as const }

// What a reopened document must keep: structure, text, marks and targets.
const content = (doc: ProseNode) =>
  JSON.stringify(doc.toJSON(), (key, value) =>
    key === 'id' ? undefined : value,
  )

// Saves, then reopens the saved text and checks that it reads as the edit.
function reopens(editor: InkKitEditor, ctx: Ctx): string {
  const edited = content(ctx.get(editorViewCtx).state.doc)
  const text = editor.snapshot().text
  editor.loadDocument({ ...input, generation: 2, text })
  expect(content(ctx.get(editorViewCtx).state.doc)).toBe(edited)
  expect(editor.snapshot().text).toBe(text)
  return text
}

function typeAfter(ctx: Ctx, word: string, text: string) {
  const view = ctx.get(editorViewCtx)
  let at = -1
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(word))
      at = pos + node.text!.indexOf(word) + word.length
  })
  expect(at).toBeGreaterThan(0)
  view.dispatch(view.state.tr.insertText(text, at))
}

afterEach(() => {
  vi.restoreAllMocks()
})

const documents = {
  'a definition before a setext heading':
    '[foo]: /url\nbar\n===\n\nText [foo].\n',
  // CommonMark 0.31.2, example 215.
  'the CommonMark example': '[foo]: /url\nbar\n===\n[foo]\n',
  'two definitions before an indented heading':
    '[a]: /a\n[b]: /b\n  bar\n---\n\n[a] and [b]\n',
  'CRLF line endings': '[foo]: /url\r\nbar\r\n===\r\n\r\nText [foo].\r\n',
  'a definition before a heading in a quote':
    '> [foo]: /url\n> bar\n> ===\n\nText [foo].\n',
  'a definition before a heading in a list item':
    '- [foo]: /url\n  bar\n  ===\n\nText [foo].\n',
}

for (const [name, source] of Object.entries(documents)) {
  test(`${name} saves unedited as loaded`, () =>
    run((editor) => {
      editor.loadDocument({ ...input, text: source })
      expect(editor.snapshot().text).toBe(source)
    }))

  test(`${name} keeps its source when the heading is edited`, () =>
    run((editor, ctx, errors) => {
      editor.loadDocument({ ...input, text: source })
      typeAfter(ctx, 'bar', 's')
      expect(errors).toEqual([])
      expect(reopens(editor, ctx)).toBe(source.replace('bar', 'bars'))
    }))

  test(`${name} opens in source mode`, () =>
    run((editor) => {
      editor.loadDocument({ ...input, text: source })
      expect(editor.setEditingMode('source')).toBe(true)
      expect(editor.snapshot().text).toBe(source)
    }))
}

test('a block after the heading is edited without touching the definition', () =>
  run((editor, ctx, errors) => {
    const source = '[foo]: /url\nbar\n===\n\nText [foo].\n'
    editor.loadDocument({ ...input, text: source })
    typeAfter(ctx, 'Text', '!')
    expect(errors).toEqual([])
    expect(reopens(editor, ctx)).toBe(source.replace('Text', 'Text!'))
  }))

test('a definition before a line of equals signs stays a paragraph', () =>
  run((editor, ctx, errors) => {
    // CommonMark 0.31.2, example 216.
    const source = '[foo]: /url\n===\n[foo]\n'
    editor.loadDocument({ ...input, text: source })
    expect(editor.snapshot().text).toBe(source)
    typeAfter(ctx, '===', ' x')
    expect(errors).toEqual([])
    expect(reopens(editor, ctx)).toBe('[foo]: /url\n=== x\n[foo]\n')
  }))

test('a replaceSource that cannot be preserved fails with an InkKitError', () =>
  run((editor) => {
    vi.spyOn(Preservation.prototype, 'serialize').mockImplementation(() => {
      throw new PreservationError('Cannot preserve')
    })
    editor.loadDocument({ ...input, text: 'One\n' })
    expect(() => editor.replaceSource('Two\n')).toThrow(
      expect.objectContaining({ name: 'InkKitError', code: 'preservation' }),
    )
  }))

test('source-mode heading navigation goes to the heading, not the definition before it', () =>
  run((editor) => {
    const source = '[foo]: /url\nbar\n===\n\nText [foo].\n'
    editor.loadDocument({ ...input, text: source })
    editor.setEditingMode('source')
    const [heading] = editor.headings()
    expect(heading?.text).toBe('bar')
    editor.navigateHeading(heading!)
    const plain = document.querySelector('textarea')!
    expect(plain.selectionStart).toBe(source.indexOf('bar'))
  }))
