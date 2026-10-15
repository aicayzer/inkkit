import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, InkKitError } from '../src/index'
import { semanticSignature } from '../src/preserve'

// A paragraph InkKit cannot edit as formatted text, such as one holding an
// unresolved reference, is kept as literal Markdown: the editor holds its
// source as text. What a person types into it is part of that source.

async function withNote(
  source: string,
  run: (editor: InkKitEditor, view: EditorView) => void | Promise<void>,
): Promise<void> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    await run(editor, ctx.get(editorViewCtx))
  } finally {
    await editor.destroy()
    root.remove()
  }
}

// Puts the caret after the first `text` in a literal block.
function caretAfter(view: EditorView, text: string): void {
  let at = -1
  view.state.doc.descendants((node, pos, parent) => {
    if (
      at < 0 &&
      node.isText &&
      parent?.type.name === 'literal_markdown' &&
      node.text!.includes(text)
    )
      at = pos + node.text!.indexOf(text) + text.length
    return at < 0
  })
  if (at < 0) throw new Error(`No literal ${text}`)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
  )
}

// Types `typed` one character at a time, as keys do, and checks that the
// saved text is `expected` and reopens as the edited document.
function typeAndSave(
  editor: InkKitEditor,
  view: EditorView,
  typed: string,
  expected: string,
): void {
  for (const character of typed)
    expect(editor.insertText(character, 1)).toBe(true)
  const saved = editor.snapshot().text
  expect(saved).toBe(expected)
  const edited = semanticSignature(view.state.doc)
  editor.loadDocument({
    documentId: 'note',
    generation: 2,
    format: 'md',
    text: saved,
  })
  expect(view.state.doc.firstChild?.type.name).toBe('literal_markdown')
  expect(semanticSignature(view.state.doc)).toBe(edited)
  expect(editor.snapshot(2)).toMatchObject({ text: saved, dirty: false })
}

const typed = ['*', '_', '[', ']', '\\', '`', '```', '<', '&amp;', '#', 'ab']

// The first block of each is literal; the others keep their authored syntax.
const notes: Array<[string, string, string]> = [
  ['an unresolved full reference', 'A [full][ref] x.', 'x.'],
  ['an unresolved shortcut reference', 'A [x] box.', 'box.'],
  ['inline HTML', 'Hello <span>x</span> there.', 'there.'],
  ['a list holding inline HTML', '- item <b>x</b> y\n- two', ' y'],
  ['a quote holding inline HTML', '> quote <b>x</b> y', ' y'],
  ['an indented paragraph', '  A [full][ref] x.', 'x.'],
  ['two lines', 'A [full][ref] x.\nsecond line', 'second'],
]

describe('typing Markdown characters into a literal block saves them as typed', () => {
  for (const [name, block, after] of notes)
    for (const [ending, tail] of [
      ['\n', ''],
      ['\n', '\n\n<br />'],
      ['\r\n', ''],
    ])
      test.each(typed)(
        `${name}, ${JSON.stringify(ending)}${tail ? ', ending with an empty paragraph' : ''}: %s`,
        async (characters) => {
          const source =
            `${block}\n\nSome __bold__ and * star\n\n* item _one_${tail}\n`.replaceAll(
              '\n',
              ending!,
            )
          await withNote(source, (editor, view) => {
            expect(view.state.doc.firstChild?.type.name).toBe(
              'literal_markdown',
            )
            caretAfter(view, after)
            const at = source.indexOf(after) + after.length
            typeAndSave(
              editor,
              view,
              characters,
              source.slice(0, at) + characters + source.slice(at),
            )
          })
        },
      )
})

test('typing into a literal footnote definition keeps its source', async () => {
  const source = 'Note[^1] here.\n\n[^1]: A [full][ref] x.\n\nAfter.\n'
  await withNote(source, (editor, view) => {
    caretAfter(view, 'x.')
    for (const character of '*`[<') editor.insertText(character, 1)
    expect(editor.snapshot().text).toBe(source.replace('x.', 'x.*`[<'))
  })
})

test('typing into an unsupported callout keeps quote markers in its comment', async () => {
  const source =
    '> [!UNSUPPORTED]\n> %%\n> private\n>\n> hidden\n> %%\n> visible\n\nAfter.\n'
  await withNote(source, (editor, view) => {
    caretAfter(view, 'visible')
    for (const character of ' *x*') editor.insertText(character, 1)
    expect(editor.snapshot().text).toBe(
      source.replace('visible', 'visible *x*'),
    )
    caretAfter(view, 'UNSUPPORTED')
    for (const character of '_`') editor.insertText(character, 1)
    expect(editor.snapshot().text).toBe(
      source
        .replace('UNSUPPORTED', 'UNSUPPORTED_`')
        .replace('visible', 'visible *x*'),
    )
  })
})

describe('an edit to a literal block that cannot reopen as typed is refused', () => {
  function refused(call: () => unknown): void {
    try {
      call()
    } catch (error) {
      expect(error).toBeInstanceOf(InkKitError)
      expect((error as InkKitError).code).toBe('preservation')
      return
    }
    throw new Error('The edit was saved')
  }

  test('a line that would become a heading', async () => {
    const source = 'A [full][ref] x.\nnext line\n\nAfter.\n'
    await withNote(source, (editor, view) => {
      caretAfter(view, 'x.\n')
      expect(editor.insertText('#', 1)).toBe(true)
      const saved = source.replace('\nnext', '\n#next')
      expect(editor.snapshot().text).toBe(saved)
      const before = view.state.doc
      refused(() => editor.insertText(' ', 1))
      expect(view.state.doc.eq(before)).toBe(true)
      expect(editor.snapshot().text).toBe(saved)
    })
  })

  test.each([
    ['a top-level block', 'A [full][ref] x.\n\nAfter.\n', 'x.'],
    [
      'a footnote definition',
      'N[^1].\n\n[^1]: A [full][ref] x.\n\nAfter.\n',
      'x.',
    ],
    ['a quote', '> quote\n>\n> > [!BOGUS]\n> > body\n\nAfter.\n', 'body'],
  ])(
    'a line ending at the end of the block, in %s',
    async (_name, source, at) => {
      await withNote(source, (editor, view) => {
        caretAfter(view, at)
        const before = view.state.doc
        refused(() => editor.keyDown({ key: 'Enter' }, 1))
        expect(view.state.doc.eq(before)).toBe(true)
        expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
      })
    },
  )
})

test('a paste that makes a paragraph literal saves as pasted', async () => {
  const source = 'Hello\n   world\n\nAfter.\n'
  await withNote(source, async (editor, view) => {
    const paragraph = view.state.doc.firstChild!
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 1, 1 + paragraph.content.size),
      ),
    )
    const pasted = 'Hello <b>x</b>\nworld'
    await editor.paste({ text: pasted, markdown: pasted }, 1)
    expect(editor.snapshot().text).toBe(`${pasted}\n\nAfter.\n`)
  })
})

test('a space typed at the start of an indented literal line is kept', async () => {
  for (const indent of ['    ', '\t']) {
    const source = `N[^1].\n\n[^1]: A [full][ref] x.\n${indent}more\n\nAfter.\n`
    await withNote(source, (editor, view) => {
      caretAfter(view, 'x.\n')
      expect(editor.insertText(' ', 1)).toBe(true)
      expect(editor.snapshot().text).toBe(
        source.replace(`${indent}more`, `${indent} more`),
      )
    })
  }
})

test('a line of a literal block keeps a lone carriage return', async () => {
  const source = 'A [x] b.\rline2\rline3\n\nAfter.\n'
  await withNote(source, (editor, view) => {
    caretAfter(view, 'line2')
    for (const character of '*`') editor.insertText(character, 1)
    expect(editor.snapshot().text).toBe(source.replace('line2', 'line2*`'))
  })
})

// The canonical writer indents a container's blocks its own way, which the
// literal blocks inside must not take from it.
test.each([
  [
    'a callout in a list item',
    '-   one\n\n    > [!BOGUS]\n    > body\n\nAfter.\n',
    'one',
    'body',
  ],
  [
    'a footnote definition',
    'Note[^1].\n\n[^1]: First line.\n\n\tA [full][ref] x.\n\tmore *x*\n\nAfter.\n',
    'First line.',
    'x.',
  ],
])(
  'a literal block in %s keeps its indentation',
  async (_name, source, beside, inside) => {
    await withNote(source, (editor, view) => {
      const after = (text: string) => {
        let at = -1
        view.state.doc.descendants((node, pos) => {
          if (at < 0 && node.isText && node.text!.includes(text))
            at = pos + node.text!.indexOf(text) + text.length
          return at < 0
        })
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
        )
      }
      after(beside)
      expect(editor.insertText('!', 1)).toBe(true)
      let saved = source.replace(beside, `${beside}!`)
      expect(editor.snapshot().text).toBe(saved)
      after(inside)
      for (const character of ' *`[') editor.insertText(character, 1)
      saved = saved.replace(inside, `${inside} *\`[`)
      expect(editor.snapshot().text).toBe(saved)
    })
  },
)

test('undo and redo restore a literal block as typed', async () => {
  const source = 'Intro __bold__.\n\nA [full][ref] x.\n\n<br />\n'
  await withNote(source, (editor, view) => {
    caretAfter(view, 'x.')
    for (const character of ' `*[') editor.insertText(character, 1)
    const typed = source.replace('x.', 'x. `*[')
    expect(editor.snapshot().text).toBe(typed)
    while (editor.undo(1));
    expect(editor.snapshot()).toMatchObject({ text: source, dirty: false })
    while (editor.redo(1));
    expect(editor.snapshot().text).toBe(typed)
  })
})
