import { expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor } from '../src/editor'
import { crossCheck, preservationWork } from '../src/preserve'
import { generateParagraphs } from '../playground/generate'

// Far less than the note, and more than the few blocks an edit touches.
const LIMIT = 10_000

// Loads a long note and returns how many characters preservation reads and
// writes for each action, which must not grow with the note.
async function measure(
  source: string,
  actions: Array<(editor: InkKitEditor, view: EditorView) => void>,
): Promise<{ work: number[]; saved: string }> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: Error[] = []
  // The saved bytes are checked here; comparing every keystroke with the
  // whole-document path would only make the test slow.
  const checking = crossCheck.enabled
  crossCheck.enabled = false
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(error),
  })
  try {
    editor.loadDocument({
      documentId: 'long',
      generation: 1,
      format: 'md',
      text: source,
    })
    const ctx = (editor as unknown as { editor: { ctx: Ctx } }).editor.ctx
    const view = ctx.get(editorViewCtx)
    const work = actions.map((action) => {
      const before = preservationWork.characters
      action(editor, view)
      return preservationWork.characters - before
    })
    expect(errors).toEqual([])
    return { work, saved: editor.snapshot().text }
  } finally {
    crossCheck.enabled = checking
    await editor.destroy()
    root.remove()
  }
}

// Puts the caret just after `text`, which starts a paragraph.
const caretAfter = (view: EditorView, text: string) => {
  let found = -1
  view.state.doc.forEach((node, offset) => {
    if (found < 0 && node.textContent.startsWith(text))
      found = offset + 1 + text.length
  })
  if (found < 0) throw Error(`No ${text}`)
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, found)),
  )
}

const type =
  (at: string, text: string) => (editor: InkKitEditor, view: EditorView) => {
    caretAfter(view, at)
    expect(editor.insertText(text, 1)).toBe(true)
  }

test('typing in a long note reads only the block it changes', async () => {
  const source = generateParagraphs(5000)
  const { work, saved } = await measure(source, [
    type('Paragraph 2500:', ' typed'),
    type('Paragraph 4000:', ' more'),
  ])
  expect(saved).toBe(
    source
      .replace('Paragraph 2500:', 'Paragraph 2500: typed')
      .replace('Paragraph 4000:', 'Paragraph 4000: more'),
  )
  for (const characters of work) expect(characters).toBeLessThan(LIMIT)
}, 60_000)
