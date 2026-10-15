import { expect, test } from 'vitest'
import type { Ctx } from '@milkdown/kit/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { redoDepth, undoDepth } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/index'

// A failed facade call changes nothing and sends nothing, whichever of its steps fails. Each
// scenario runs once to count the edits its call checks for preservation, then once for each of
// those edits with that one refused.

const source = `# Title

Hello world and **bold** text[^n] with [a link][ref] and [inline](https://example.net).

- item

| A | B |
| --- | --- |
| 2 | 1 |
| 1 | 2 |

[ref]: https://example.com
[^n]: Note.
`

interface Scenario {
  name: string
  setup?: (editor: InkKitEditor, view: EditorView) => void
  call: (editor: InkKitEditor) => unknown
}

/** Selects `word`, or puts the caret at its start when `caret` is set. */
function select(view: EditorView, word: string, caret = false): void {
  let from = -1
  view.state.doc.descendants((node: ProseNode, pos: number) => {
    if (from < 0 && node.isText && node.text!.includes(word))
      from = pos + node.text!.indexOf(word)
  })
  if (from < 0) throw new Error(`No ${word}`)
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        from,
        caret ? from : from + word.length,
      ),
    ),
  )
}

const words =
  (word: string, caret = false) =>
  (_editor: InkKitEditor, view: EditorView) =>
    select(view, word, caret)
const generation = () => current

let current = 0
const stepCounts = new Map<string, number>()

const scenarios: Scenario[] = [
  ...(
    [
      'bold',
      'italic',
      'strikethrough',
      'highlight',
      'code',
      'codeBlock',
      'quote',
      'bulletList',
      'orderedList',
      'taskList',
    ] as const
  ).map((command) => ({
    name: `format('${command}')`,
    setup: words('world'),
    call: (editor: InkKitEditor) => editor.format(command),
  })),
  {
    name: "format('heading', 2)",
    setup: words('world'),
    call: (editor) => editor.format('heading', 2),
  },
  {
    name: "format('paragraph') in a heading",
    setup: words('Title'),
    call: (editor) => editor.format('paragraph'),
  },
  {
    name: "format('link') at a caret in a link",
    setup: words('nline', true),
    call: (editor) => editor.format('link'),
  },
  {
    name: "format('taskList') in a list",
    setup: words('item'),
    call: (editor) => editor.format('taskList'),
  },
  {
    name: "format('bulletList') in a list",
    setup: words('item'),
    call: (editor) => editor.format('orderedList'),
  },
  {
    name: "format('link', destination)",
    setup: words('world'),
    call: (editor) => editor.format('link', 'https://example.org'),
  },
  {
    name: "format('link') in a reference link",
    setup: words('link', true),
    call: (editor) => editor.format('link', 'https://example.org'),
  },
  ...(
    [
      'addRowAfter',
      'addColumnBefore',
      'deleteRow',
      'deleteColumn',
      'alignRight',
      'moveRowDown',
      'moveColumnRight',
      'sortRows',
      'deleteTable',
    ] as const
  ).map((command) => ({
    name: `table('${command}')`,
    setup: words('2', true),
    call: (editor: InkKitEditor) => editor.table(command),
  })),
  {
    name: "table('insert')",
    setup: words('world'),
    call: (editor) => editor.table('insert'),
  },
  {
    name: 'insertFootnote()',
    setup: words('world'),
    call: (editor) => editor.insertFootnote(),
  },
  {
    name: "insertFootnote('n')",
    setup: words('world'),
    call: (editor) => editor.insertFootnote('n'),
  },
  {
    name: 'editReferenceDefinition',
    call: (editor) =>
      editor.editReferenceDefinition('ref', 'https://example.org', 'Title'),
  },
  {
    name: 'insertImages',
    setup: words('world'),
    call: (editor) =>
      editor.insertImages([
        { path: 'a.png', alt: 'A' },
        { path: 'b.png', alt: 'B' },
      ]),
  },
  {
    name: 'insertPaths',
    call: (editor) => editor.insertPaths(['a.txt', 'b.txt'], 0, 0),
  },
  {
    name: 'pasteAsPlainText',
    setup: words('world'),
    call: (editor) => editor.pasteAsPlainText('one\ntwo'),
  },
  {
    name: 'insertText',
    setup: words('world'),
    call: (editor) => editor.insertText('**x**', generation()),
  },
  {
    name: 'keyDown Enter',
    setup: words('world', true),
    call: (editor) =>
      editor.keyDown(
        'Enter',
        'Enter',
        false,
        false,
        false,
        false,
        generation(),
      ),
  },
  {
    name: 'replace',
    setup: words('Hello', true),
    call: (editor) => editor.replace('world', 'there'),
  },
  {
    name: 'replaceAll',
    call: (editor) => editor.replaceAll('l', 'L'),
  },
  {
    name: 'replaceTextRange',
    call: (editor) => {
      const snapshot = editor.textSnapshot()
      const from = snapshot.text.indexOf('world')
      return editor.replaceTextRange(
        { snapshotId: snapshot.snapshotId, from, to: from + 5 },
        'there',
      )
    },
  },
  {
    name: 'replaceSource',
    call: (editor) => editor.replaceSource('# Other\n\nText\n'),
  },
  {
    name: 'undo',
    setup: (editor) => editor.insertText('x', generation()),
    call: (editor) => editor.undo(),
  },
  {
    name: 'redo',
    setup: (editor) => {
      editor.insertText('x', generation())
      editor.undo()
    },
    call: (editor) => editor.redo(),
  },
  {
    name: 'paste',
    setup: words('world'),
    call: (editor) =>
      editor.paste({ text: 'x', markdown: '**one**\n\n- two\n' }),
  },
]

test.each(scenarios)(
  '$name that fails at any step changes nothing and sends nothing',
  async ({ name, setup, call }) => {
    const root = document.createElement('div')
    document.body.append(root)
    const sent: string[] = []
    const editor = await InkKitEditor.mount(
      root,
      {
        changed: () => sent.push('changed'),
        stateChanged: () => sent.push('stateChanged'),
        commandStateChanged: () => sent.push('commandStateChanged'),
        error: (error) => sent.push(`error ${error.code}`),
        copy() {},
        openLink() {},
      },
      {
        images: {
          presentation: () => undefined,
          importImage: async () => ({ reference: 'x.png' }),
          exportImage: async () => ({
            bytes: new Uint8Array(),
            mimeType: 'image/png',
          }),
        },
      },
    )
    const view = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx.get(
      editorViewCtx,
    )
    const internals = editor as unknown as {
      assertPreserved(
        before: ProseNode,
        after: ProseNode,
        written?: boolean,
      ): void
    }
    const assertPreserved = internals.assertPreserved
    // Counts each check of a real edit, and refuses the one numbered `refuse`.
    let checks = 0
    let refuse = 0
    let counting = false
    internals.assertPreserved = function (before, after, written) {
      if (counting && !after.eq(before) && ++checks === refuse)
        throw new Error('Refused for the test')
      return assertPreserved.call(this, before, after, written)
    }
    const prepare = () => {
      editor.loadDocument({
        documentId: 'failed-calls',
        generation: ++current,
        format: 'md',
        text: source,
      })
      // History to keep: an edit before the call.
      counting = false
      editor.insertText('Z', current)
      setup?.(editor, view)
      checks = 0
      sent.length = 0
      counting = true
    }
    try {
      prepare()
      await call(editor)
      const steps = checks
      stepCounts.set(name, steps)
      expect(steps).toBeGreaterThan(0)
      for (refuse = 1; refuse <= steps; refuse++) {
        prepare()
        const state = view.state
        const snapshot = editor.snapshot()
        const undo = undoDepth(state)
        const redo = redoDepth(state)
        let failure: unknown
        try {
          await call(editor)
        } catch (error) {
          failure = error
        }
        const label = `step ${refuse} of ${steps}`
        expect(failure, label).toMatchObject({ code: 'preservation' })
        expect(view.state, label).toBe(state)
        expect(editor.snapshot(), label).toEqual(snapshot)
        expect(undoDepth(view.state), label).toBe(undo)
        expect(redoDepth(view.state), label).toBe(redo)
        expect(sent, label).toEqual([])
      }
      refuse = 0
      // The editor stays usable: the same call succeeds afterwards.
      prepare()
      await call(editor)
      expect(editor.snapshot().revision).toBeGreaterThan(1)
    } finally {
      await editor.destroy()
      root.remove()
    }
  },
)

test('the commands that take more than one step are among those refused at each step', () => {
  // format('taskList') wraps and then marks the items; a heading change runs two commands too.
  expect(stepCounts.get("format('taskList')")).toBe(2)
  expect(stepCounts.get("format('heading', 2)")).toBe(2)
})
