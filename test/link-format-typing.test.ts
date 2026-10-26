import { afterEach, beforeEach, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/index'
import { semanticSignature } from '../src/preserve'

let root: HTMLElement
let editor: InkKitEditor
let reader: InkKitEditor
let readerRoot: HTMLElement
let view: EditorView

const viewOf = (target: InkKitEditor) =>
  (target as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(editorViewCtx)

beforeEach(async () => {
  const host = { changed() {}, copy() {}, openLink() {} }
  root = document.createElement('div')
  readerRoot = document.createElement('div')
  document.body.append(root, readerRoot)
  editor = await InkKitEditor.mount(root, host)
  reader = await InkKitEditor.mount(readerRoot, host)
  view = viewOf(editor)
})

afterEach(async () => {
  await editor.destroy()
  await reader.destroy()
  root.remove()
  readerRoot.remove()
})

let generation = 0
const load = (text: string) => {
  editor.loadDocument({
    documentId: 'note',
    generation: ++generation,
    format: 'md',
    text,
  })
  return generation
}

// Puts the caret `offset` characters into the first text node holding `text`.
function caret(text: string, offset: number) {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0
    const index = node.text!.indexOf(text)
    if (index >= 0) found = pos + index + offset
    return false
  })
  if (found < 0) throw new Error(`No ${text}`)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found)),
  )
}

// The saved text, which must reopen as the document the editor shows.
function saved(): string {
  const text = editor.snapshot().text
  reader.loadDocument({
    documentId: 'reader',
    generation: ++generation,
    format: 'md',
    text,
  })
  expect(semanticSignature(viewOf(reader).state.doc)).toEqual(
    semanticSignature(view.state.doc),
  )
  return text
}

const wrappers = ['**', '__', '*', '_', '~~', '==']

test.each(wrappers)(
  'typing inside %s around a whole inline link keeps the delimiters outside',
  (mark) => {
    const source = `See ${mark}[a b](u)${mark} now\n`
    for (const [offset, expected] of [
      [1, `See ${mark}[aX b](u)${mark} now\n`],
      [3, `See ${mark}[a bX](u)${mark} now\n`],
    ] as const) {
      const at = load(source)
      caret('a b', offset)
      expect(editor.insertText('X', at)).toBe(true)
      expect(saved()).toBe(expected)
      expect(editor.undo(at)).toBe(true)
      expect(editor.snapshot().text).toBe(source)
      expect(editor.redo(at)).toBe(true)
      expect(saved()).toBe(expected)
    }
  },
)

test.each(wrappers)(
  'typing inside %s around a whole reference link keeps its source',
  (mark) => {
    const source = `See ${mark}[a b][r]${mark} now\n\n[r]: https://example.com\n`
    const at = load(source)
    caret('a b', 1)
    expect(editor.insertText('X', at)).toBe(true)
    expect(saved()).toBe(
      `See ${mark}[aX b][r]${mark} now\n\n[r]: https://example.com\n`,
    )
  },
)

test('text typed against the opening delimiter moves it inside the link', () => {
  // `X**[` cannot open strong text, since the delimiter sits between a letter
  // and punctuation, so the formatting is written inside the link.
  const at = load('See **[a b](u)** now\n')
  caret('a b', 0)
  expect(editor.insertText('X', at)).toBe(true)
  expect(saved()).toBe('See X[**a b**](u) now\n')
})

test('nested formatting around a link keeps both delimiters outside', () => {
  const at = load('See **_[a b](u)_** now\n')
  caret('a b', 1)
  expect(editor.insertText('X', at)).toBe(true)
  expect(saved()).toBe('See **_[aX b](u)_** now\n')
})

test('CRLF and Unicode labels keep their formatting and line endings', () => {
  const source = 'Před ~~[café 🎉 b](u "T")~~ po\r\n\r\nNext __[ü](v)__\r\n'
  const at = load(source)
  caret('café 🎉 b', 5)
  expect(editor.insertText('ñ', at)).toBe(true)
  caret('ü', 1)
  expect(editor.insertText('文字', at)).toBe(true)
  expect(saved()).toBe(
    'Před ~~[café ñ🎉 b](u "T")~~ po\r\n\r\nNext __[ü文字](v)__\r\n',
  )
  expect(editor.undo(at)).toBe(true)
  expect(editor.undo(at)).toBe(true)
  expect(editor.snapshot().text).toBe(source)
})

test('a stale generation types nothing', () => {
  const source = 'See **[a b](u)** now\n'
  const at = load(source)
  caret('a b', 1)
  expect(() => editor.insertText('X', at - 1)).toThrow()
  expect(editor.snapshot().text).toBe(source)
})

test('changing formatting inside the label is still written afresh', () => {
  // The link no longer covers exactly the formatted text, so the source
  // cannot keep the delimiters outside it.
  const at = load('See **[a b](u)** now\n')
  caret('a b', 3)
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        view.state.selection.from - 1,
        view.state.selection.from,
      ),
    ),
  )
  expect(editor.format('italic', undefined, at)).toBe(true)
  const text = saved()
  expect(text).not.toBe('See **[a b](u)** now\n')
})
