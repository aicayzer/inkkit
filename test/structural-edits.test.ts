import { ctxOf } from './editor-access'
import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/editor'
import { semanticSignature } from '../src/preserve'

type Step =
  | { caret: string; at: 'after' | 'start' | 'end' }
  | { key: string }
  | { type: string }
  | { paste: string }
  | 'undo'

// Runs steps as a person would, then returns what the editor saves. The
// saved text must reopen as the document the steps made.
async function edit(source: string, steps: Step[]): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    editor.loadDocument({
      documentId: 'structure',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = ctxOf(editor)
    const view = ctx.get(editorViewCtx)
    for (const step of steps) {
      if (step === 'undo') undo(view.state, view.dispatch)
      else if ('caret' in step) caret(view, step.caret, step.at)
      else if ('key' in step)
        expect(editor.keyDown({ key: step.key }, 1)).toBe(true)
      else if ('type' in step)
        expect(editor.insertText(step.type, 1)).toBe(true)
      else await editor.paste({ text: step.paste, markdown: step.paste }, 1)
    }
    expect(errors).toEqual([])
    const saved = editor.snapshot().text
    const edited = semanticSignature(view.state.doc)
    editor.loadDocument({
      documentId: 'structure',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
    expect(semanticSignature(view.state.doc)).toBe(edited)
    return saved
  } finally {
    await editor.destroy()
    root.remove()
  }
}

// Puts the caret after `text`, or at the start or end of the textblock that
// starts with it.
function caret(view: EditorView, text: string, at: 'after' | 'start' | 'end') {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.startsWith(text))
      found =
        pos +
        1 +
        (at === 'start' ? 0 : at === 'end' ? node.content.size : text.length)
    return found < 0
  })
  if (found < 0) throw Error(`No ${text}`)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found)),
  )
}

const source = [
  '__Intro__ with *marks*  ',
  'Split.Here with __bold__ and [a link](/l "T")',
  '* item __one__\n* item _two_',
  'Join *this*',
  'to __that__ one',
  '1) first\n2) second',
  '```js\nconst x = 1\n```',
  'Last _words_ &amp; more',
]
  .join('\n\n')
  .replaceAll('\n', '\r\n')

test.each<[string, Step[], string]>([
  [
    'Enter in the middle of a paragraph',
    [{ caret: 'Split.', at: 'after' }, { key: 'Enter' }],
    source.replace('Split.Here', 'Split.\r\n\r\nHere'),
  ],
  [
    'Enter at the end of a paragraph, then typing',
    [{ caret: 'Join', at: 'end' }, { key: 'Enter' }, { type: 'New words' }],
    source.replace('Join *this*', 'Join *this*\r\n\r\nNew words'),
  ],
  [
    'Enter at the end of a paragraph',
    [{ caret: 'Join', at: 'end' }, { key: 'Enter' }],
    source.replace('Join *this*', 'Join *this*\r\n\r\n<br />'),
  ],
  [
    'Backspace at the start of a paragraph',
    [{ caret: 'to', at: 'start' }, { key: 'Backspace' }],
    source.replace('Join *this*\r\n\r\nto', 'Join *this*to'),
  ],
  [
    'Delete at the end of a paragraph',
    [{ caret: 'Join', at: 'end' }, { key: 'Delete' }],
    source.replace('Join *this*\r\n\r\nto', 'Join *this*to'),
  ],
  [
    'Enter twice at the end of a list',
    [{ caret: 'item two', at: 'end' }, { key: 'Enter' }, { key: 'Enter' }],
    source.replace('* item _two_', '* item _two_\r\n\r\n<br />'),
  ],
  [
    'pasting Markdown blocks',
    [{ caret: 'Join', at: 'end' }, { paste: 'Pasted __one__\n\n## Two' }],
    source.replace('Join *this*', 'Join *this*Pasted **one**\r\n\r\n## Two'),
  ],
  [
    'undo after Enter',
    [{ caret: 'Split.', at: 'after' }, { key: 'Enter' }, 'undo'],
    source,
  ],
  [
    'Enter, then typing far away',
    [
      { caret: 'Split.', at: 'after' },
      { key: 'Enter' },
      { caret: 'Last', at: 'after' },
      { type: '!' },
    ],
    source
      .replace('Split.Here', 'Split.\r\n\r\nHere')
      .replace('Last _words_', 'Last! _words_'),
  ],
])(
  '%s keeps the authored text of every block it did not reach',
  async (_, steps, saved) => expect(await edit(source, steps)).toBe(saved),
)

test('an edit in a note that ends with an empty paragraph keeps its authored syntax', async () => {
  // The writer drops an empty paragraph at the end of a document, which made
  // the edited blocks of such a note lose their authored syntax.
  const authored = 'Some __bold__ words\n\nEnd _here_\n'
  expect(
    await edit(authored, [
      { caret: 'End', at: 'end' },
      { key: 'Enter' },
      { caret: 'Some', at: 'after' },
      { type: ' typed' },
    ]),
  ).toBe('Some typed __bold__ words\n\nEnd _here_\n\n<br />\n')
})

test.each([
  ['an HTML block', '<div>\nhtml\n</div>'],
  ['a comment', '%%\nhidden\n%%'],
  ['a definition', '[ref]: /target'],
  ['a quote', '> quoted __text__'],
])(
  'Enter beside %s saves what the whole-document path saves',
  async (_, block) => {
    const authored = `First __one__\n\n${block}\n\nSecond [ref] _two_\n`
    const saved = await edit(authored, [
      { caret: 'First', at: 'end' },
      { key: 'Enter' },
      { type: 'x' },
    ])
    expect(saved).toBe(authored.replace('First __one__', 'First __one__\n\nx'))
  },
)
