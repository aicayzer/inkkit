import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/index'
import { semanticSignature } from '../src/preserve'

const input = { documentId: 'text-input', format: 'md' as const }

interface Session {
  editor: InkKitEditor
  view: EditorView
  errors: Error[]
  // Saves, reopens the saved text in another editor and returns whether it
  // reads back the same.
  save: () => { saved: string; same: boolean }
}

async function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  const view = ctxOf(editor).get(editorViewCtx)
  return { root, editor, view, errors }
}

async function session(source: string, run: (session: Session) => void) {
  const main = await mount()
  const other = await mount()
  let saves = 0
  try {
    main.editor.loadDocument({ ...input, generation: 1, text: source })
    run({
      ...main,
      save() {
        const saved = main.editor.snapshot().text
        other.editor.loadDocument({
          ...input,
          generation: ++saves,
          text: saved,
        })
        return {
          saved,
          same:
            JSON.stringify(semanticSignature(other.view.state.doc)) ===
            JSON.stringify(semanticSignature(main.view.state.doc)),
        }
      },
    })
  } finally {
    for (const { editor, root } of [main, other]) {
      await editor.destroy()
      root.remove()
    }
  }
}

// Puts the caret just after the first `text`, or at its start.
function caret(view: EditorView, text: string, after = true) {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0
    const index = node.text!.indexOf(text)
    if (index >= 0) found = pos + index + (after ? text.length : 0)
    return false
  })
  if (found < 0) throw new Error(`No ${text}`)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found)),
  )
}

function expectSaves(s: Session, expected: string) {
  expect(s.errors).toEqual([])
  const { saved, same } = s.save()
  expect(saved).toBe(expected)
  expect(same).toBe(true)
}

// [what, source, caret after, whether after (or before) it, text, saved]
const chunks: [string, string, string, boolean, string, string][] = [
  [
    'a URL and a space after other text',
    'Plain words here\n',
    'Plain ',
    true,
    'https://example.com ',
    'Plain https://example.com words here\n',
  ],
  [
    'a URL and a space at the end of a block after another block',
    'First line\n\nSecond\n',
    'Second',
    true,
    ' see https://example.com ',
    'First line\n\nSecond see <https://example.com>&#x20;\n',
  ],
  [
    'a URL and a space in a block after another block',
    'First line\n\nSecond words\n',
    'Second ',
    true,
    'https://example.com ',
    'First line\n\nSecond https://example.com words\n',
  ],
  [
    'strong emphasis',
    'Plain words here\n',
    'Plain ',
    true,
    '**x**',
    'Plain **x**words here\n',
  ],
  [
    'strong emphasis after another block',
    'First line\n\nSecond words\n',
    'Second ',
    true,
    '**x**',
    'First line\n\nSecond **x**words\n',
  ],
  [
    'strikethrough',
    'Plain words here\n',
    'Plain ',
    true,
    '~~x~~',
    'Plain ~~x~~words here\n',
  ],
  [
    'strikethrough after another block',
    'First line\n\nSecond words\n',
    'Second ',
    true,
    '~~x~~',
    'First line\n\nSecond ~~x~~words\n',
  ],
  // The emphasis rule runs on the closing asterisk, which is not last here.
  [
    'emphasis and a space',
    'Plain words here\n',
    'Plain ',
    true,
    '*x* ',
    'Plain \\*x\\* words here\n',
  ],
  [
    'emphasis and a space after another block',
    'First line\n\nSecond words\n',
    'Second ',
    true,
    '*x* ',
    'First line\n\nSecond \\*x\\* words\n',
  ],
  [
    'a heading marker inside a line',
    'Plain words here\n',
    'Plain ',
    true,
    '# ',
    'Plain # words here\n',
  ],
  [
    'a heading marker inside a line after another block',
    'First line\n\nSecond words\n',
    'Second ',
    true,
    '# ',
    'First line\n\nSecond # words\n',
  ],
  // As if the space had been typed after `#`.
  [
    'a heading marker at the start of a block after another block',
    'First line\n\nSecond words\n',
    'Second',
    false,
    '# ',
    'First line\n\n# Second words\n',
  ],
  [
    'text ending in a character outside the Basic Multilingual Plane',
    'Plain words here\n',
    'Plain ',
    true,
    'a😀',
    'Plain a😀words here\n',
  ],
]

for (const [name, source, anchor, after, text, saved] of chunks)
  test(`insertText with ${name} inserts exactly its text`, () =>
    session(source, (s) => {
      caret(s.view, anchor, after)
      expect(s.editor.insertText(text, 1)).toBe(true)
      expectSaves(s, saved)
      expect(s.editor.undo(1)).toBe(true)
      expectSaves(s, source)
    }))

test('the issue example: buffered strong emphasis keeps the words after it', () =>
  session('Plain words here\n', (s) => {
    caret(s.view, 'Plain ')
    s.editor.insertText('**x**', 1)
    expectSaves(s, 'Plain **x**words here\n')
    expect(s.view.state.selection.from).toBe(
      s.view.state.doc.textContent.indexOf('words') + 1,
    )
  }))

test('a buffered selection replacement runs the input rule on its last character', () =>
  session('Plain words here\n', (s) => {
    s.editor.find('words')
    s.editor.insertText('**x**', 1)
    expectSaves(s, 'Plain **x** here\n')
    s.editor.undo(1)
    expectSaves(s, 'Plain words here\n')
  }))

test('Backspace after a buffered input rule leaves its text as typed', () =>
  session('Plain words here\n', (s) => {
    caret(s.view, 'Plain ')
    s.editor.insertText('**x**', 1)
    s.editor.keyDown({ key: 'Backspace', code: 'Backspace' }, 1)
    expectSaves(s, 'Plain \\*\\*x\\*\\*words here\n')
  }))

const press = (s: Session, key: string) =>
  s.editor.keyDown({ key, code: key }, 1)

// A chunk over a selection replaces it, joining the blocks it spans, and the
// input rule runs at the joined position.
test('insertText over a selection across blocks inserts exactly its text', () =>
  session('First words here\n\nSecond words there\n', (s) => {
    let from = -1
    let to = -1
    s.view.state.doc.descendants((node, pos) => {
      if (!node.isText) return true
      if (node.text!.startsWith('First ')) from = pos + 'First '.length
      if (node.text!.startsWith('Second ')) to = pos + 'Second '.length
      return false
    })
    s.view.dispatch(
      s.view.state.tr.setSelection(
        TextSelection.create(s.view.state.doc, from, to),
      ),
    )
    s.editor.insertText('**x**', 1)
    expectSaves(s, 'First **x**words there\n')
    s.editor.undo(1)
    expectSaves(s, 'First words here\n\nSecond words there\n')
  }))

test('insertText after Select All inserts exactly its text', () =>
  session('First words here\n\nSecond words there\n', (s) => {
    s.view.dispatch(
      s.view.state.tr.setSelection(new AllSelection(s.view.state.doc)),
    )
    s.editor.insertText('**x**', 1)
    expectSaves(s, '**x**\n')
    s.editor.undo(1)
    expectSaves(s, 'First words here\n\nSecond words there\n')
  }))

// [what, source, caret after, saved after Enter]
const splits: [string, string, string, string][] = [
  [
    'after a URL in the middle of a line',
    'See https://example.com today\n',
    'example.com',
    'See https://example.com\n\n&#x20;today\n',
  ],
  [
    'after a word in the middle of a line',
    'See example today\n',
    'example',
    'See example\n\n&#x20;today\n',
  ],
]

for (const [name, source, anchor, saved] of splits)
  test(`Enter ${name} and Backspace restore the text exactly`, () =>
    session(source, (s) => {
      caret(s.view, anchor)
      expect(press(s, 'Enter')).toBe(true)
      expectSaves(s, saved)
      expect(press(s, 'Backspace')).toBe(true)
      expectSaves(s, source)
    }))

test('Enter inside an inline code span keeps the code text', () =>
  session('Run `foo  bar` now\n', (s) => {
    caret(s.view, 'foo')
    press(s, 'Enter')
    expectSaves(s, 'Run `foo`\n\n`  bar` now\n')
  }))
