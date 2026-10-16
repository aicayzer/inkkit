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
  actions: Array<
    (editor: InkKitEditor, view: EditorView) => void | Promise<void>
  >,
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
    const work: number[] = []
    for (const action of actions) {
      const before = preservationWork.characters
      await action(editor, view)
      work.push(preservationWork.characters - before)
    }
    expect(errors).toEqual([])
    return { work, saved: editor.snapshot().text }
  } finally {
    crossCheck.enabled = checking
    await editor.destroy()
    root.remove()
  }
}

// Puts the caret just after `text`, which starts a paragraph, or at the
// start or end of that paragraph.
const caretAfter = (
  view: EditorView,
  text: string,
  where: 'after' | 'start' | 'end' = 'after',
) => {
  let found = -1
  view.state.doc.forEach((node, offset) => {
    if (found < 0 && node.textContent.startsWith(text))
      found =
        offset +
        1 +
        (where === 'start'
          ? 0
          : where === 'end'
            ? node.content.size
            : text.length)
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

const press =
  (at: string, where: 'after' | 'start' | 'end', key: string) =>
  (editor: InkKitEditor, view: EditorView) => {
    caretAfter(view, at, where)
    expect(editor.keyDown({ key }, 1)).toBe(true)
  }

test('Enter, Backspace and Delete in a long note read only the blocks they change', async () => {
  const source = generateParagraphs(5000)
  const { work, saved } = await measure(source, [
    // A split, then typing elsewhere, which must not read the note again.
    press('Paragraph 2500', 'after', 'Enter'),
    type('Paragraph 2300:', ' typed'),
    // A new empty paragraph, and text typed into it.
    press('Paragraph 2700:', 'end', 'Enter'),
    (editor) => {
      expect(editor.insertText('New', 1)).toBe(true)
    },
    // Joins at the start and the end of a paragraph.
    press('Paragraph 2900:', 'start', 'Backspace'),
    press('Paragraph 3110:', 'end', 'Delete'),
    type('Paragraph 4000:', ' more'),
  ])
  const lines = source.split('\n\n')
  const at = (n: number) =>
    lines.findIndex((line) => line.startsWith(`Paragraph ${n}:`))
  const expected = [...lines]
  expected[at(4000)] = expected[at(4000)]!.replace(
    'Paragraph 4000:',
    'Paragraph 4000: more',
  )
  expected[at(3110)] = expected[at(3110)]! + expected[at(3111)]!
  expected.splice(at(3111), 1)
  expected[at(2899)] = expected[at(2899)]! + expected[at(2900)]!
  expected.splice(at(2900), 1)
  expected.splice(at(2700) + 1, 0, 'New')
  expected[at(2300)] = expected[at(2300)]!.replace(
    'Paragraph 2300:',
    'Paragraph 2300: typed',
  )
  const split = expected[at(2500)]!
  expected.splice(
    at(2500),
    1,
    'Paragraph 2500',
    split.slice('Paragraph 2500'.length),
  )
  expect(saved).toBe(expected.join('\n\n'))
  for (const characters of work) expect(characters).toBeLessThan(LIMIT)
}, 120_000)

test('pasting into a long note reads only what it pastes', async () => {
  const source = generateParagraphs(5000)
  const pasted = Array.from(
    { length: 20 },
    (_, i) => `Pasted paragraph ${i + 1} with some words.`,
  ).join('\n\n')
  const { work, saved } = await measure(source, [
    async (editor, view) => {
      caretAfter(view, 'Paragraph 2500:', 'end')
      await editor.paste({ text: pasted, markdown: pasted }, 1)
    },
    type('Paragraph 1000:', ' typed'),
  ])
  expect(saved).toContain('Pasted paragraph 20 with some words.')
  expect(saved).toContain('Paragraph 1000: typed')
  for (const characters of work) expect(characters).toBeLessThan(LIMIT)
}, 120_000)

// Plain-text paste relies on the check dispatch makes after every appended
// plugin has normalized the edit, so it must read only what it pastes too.
test('pasting plain text into a long note reads only what it pastes', async () => {
  const source = generateParagraphs(5000)
  const pasted = Array.from(
    { length: 20 },
    (_, i) => `Pasted line ${i + 1} with __some__ words.`,
  ).join('\n')
  const { work, saved } = await measure(source, [
    (editor, view) => {
      caretAfter(view, 'Paragraph 2500:', 'end')
      expect(editor.pasteAsPlainText(pasted, 1)).toBe(true)
    },
    type('Paragraph 1000:', ' typed'),
  ])
  expect(saved).toContain('Pasted line 20 with \\_\\_some\\_\\_ words.')
  expect(saved).toContain('Paragraph 1000: typed')
  for (const characters of work) expect(characters).toBeLessThan(LIMIT)
}, 120_000)
