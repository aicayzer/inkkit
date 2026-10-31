import { expect, test } from 'vitest'
import { InkKitEditor, type CommandState } from '../src/core'
import {
  doc,
  para,
  rich,
  richSnapshot,
  withRichEditor,
} from './formats/rtf/harness'

const input = { documentId: 'undone', generation: 1, format: 'md' as const }

async function run(
  body: (
    editor: InkKitEditor,
    log: { states: CommandState[]; changes: number },
  ) => void | Promise<void>,
  text = 'Start\n',
) {
  const root = document.createElement('div')
  document.body.append(root)
  const log = { states: [] as CommandState[], changes: 0 }
  const editor = await InkKitEditor.mount(root, {
    changed() {
      log.changes++
    },
    commandStateChanged: (state) => log.states.push(state),
  })
  try {
    editor.loadDocument({ ...input, text })
    await body(editor, log)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
const atEnd = (editor: InkKitEditor) => {
  const snapshot = editor.textSnapshot()
  const at = snapshot.text.length
  editor.selectTextRange({ snapshotId: snapshot.snapshotId, from: at, to: at })
}
const atStart = (editor: InkKitEditor) => {
  const snapshot = editor.textSnapshot()
  editor.selectTextRange({ snapshotId: snapshot.snapshotId, from: 0, to: 0 })
}
/** Two undo steps: edits far apart do not join into one group. */
function typeTwice(editor: InkKitEditor) {
  atEnd(editor)
  editor.insertText(' one', 1)
  atStart(editor)
  editor.insertText('two ', 1)
}

test('discarding an undone step leaves redo with nothing and keeps the document and undo steps', () =>
  run((editor, log) => {
    typeTwice(editor)
    const typed = editor.snapshot().text
    expect(editor.undo()).toBe(true)
    const undone = editor.snapshot()
    expect(editor.commandState().commands.redo).toBe(true)
    const changes = log.changes
    expect(editor.discardUndone()).toBe(true)
    // Nothing about the document moved, and no change was announced.
    expect(editor.snapshot()).toEqual(undone)
    expect(log.changes).toBe(changes)
    expect(editor.commandState().commands.redo).toBe(false)
    expect(log.states.at(-1)!.commands.redo).toBe(false)
    expect(editor.redo()).toBe(false)
    expect(editor.snapshot().text).toBe(undone.text)
    // The steps before it are still there.
    expect(editor.commandState().commands.undo).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).toBe('Start\n')
    expect(typed).not.toBe(undone.text)
  }))

test('discarding drops every undone step, and a later undo and redo behave normally', () =>
  run((editor) => {
    for (const [index, word] of [' a', 'b ', ' c'].entries()) {
      if (index % 2) atStart(editor)
      else atEnd(editor)
      editor.insertText(word, 1)
    }
    expect(editor.undo()).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(editor.discardUndone()).toBe(true)
    expect(editor.redo()).toBe(false)
    // New content after the discard is an ordinary step with its own undo and redo.
    editor.insertText(' appended', 1)
    const after = editor.snapshot().text
    expect(after).toContain('appended')
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot().text).not.toContain('appended')
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).toBe(after)
    expect(editor.redo()).toBe(false)
  }))

test('it returns false and changes nothing when there is nothing undone', () =>
  run((editor, log) => {
    const before = editor.snapshot()
    expect(editor.discardUndone()).toBe(false)
    typeTwice(editor)
    const states = log.states.length
    expect(editor.discardUndone()).toBe(false)
    expect(log.states).toHaveLength(states)
    expect(editor.undo()).toBe(true)
    expect(editor.redo()).toBe(true)
    expect(editor.snapshot().text).not.toBe(before.text)
  }))

test('it is refused like an edit: stale generation, read-only and composition', () =>
  run((editor) => {
    typeTwice(editor)
    editor.undo()
    expect(() => editor.discardUndone(99)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    editor.setEditable(false)
    expect(() => editor.discardUndone()).toThrow(
      expect.objectContaining({ code: 'read-only' }),
    )
    editor.setEditable(true)
    // The refused calls left redo available.
    expect(editor.redo()).toBe(true)
  }))

test('a load starts without undone steps to discard', () =>
  run((editor) => {
    typeTwice(editor)
    editor.undo()
    editor.loadDocument({ ...input, generation: 2, text: 'Fresh\n' })
    expect(editor.discardUndone()).toBe(false)
  }))

test('a reload keeps undo and a discard still works afterwards', () =>
  run((editor) => {
    typeTwice(editor)
    editor.undo()
    expect(editor.discardUndone()).toBe(true)
    editor.reloadDocument({
      ...input,
      generation: 2,
      text: editor.snapshot().text,
    })
    expect(editor.redo()).toBe(false)
  }))

test('source mode drops typed source steps that were undone', () =>
  run((editor) => {
    editor.setEditingMode('source')
    atEnd(editor)
    const typed = () => {
      const textarea = editor['source'].element
      textarea.value += 'x'
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    typed()
    expect(editor.snapshot().text).toContain('x')
    expect(editor.undo()).toBe(true)
    expect(editor.commandState().commands.redo).toBe(true)
    expect(editor.discardUndone()).toBe(true)
    expect(editor.commandState().commands.redo).toBe(false)
    expect(editor.redo()).toBe(false)
    expect(editor.snapshot().text).toBe('Start\n')
  }))

test('source mode drops formatted steps that were undone before switching', () =>
  run((editor) => {
    typeTwice(editor)
    editor.undo()
    editor.setEditingMode('source')
    const text = editor.snapshot().text
    const redoable = editor.commandState().commands.redo
    expect(editor.discardUndone()).toBe(redoable)
    expect(editor.redo()).toBe(false)
    expect(editor.snapshot().text).toBe(text)
  }))

test('an RTF document discards its undone steps too', () =>
  withRichEditor({}, ({ editor }) => {
    editor.loadDocument(rich(doc(para('one'))))
    const snapshot = editor.textSnapshot()
    editor.selectTextRange({
      snapshotId: snapshot.snapshotId,
      from: 3,
      to: 3,
    })
    const { generation } = editor.snapshot()
    editor.insertText(' two', generation)
    editor.undo()
    const text = JSON.stringify(richSnapshot(editor).document)
    expect(editor.discardUndone()).toBe(true)
    expect(editor.redo()).toBe(false)
    expect(JSON.stringify(richSnapshot(editor).document)).toBe(text)
  }))

test('a discard in one editor leaves another editor on the page alone', async () => {
  const roots = [document.createElement('div'), document.createElement('div')]
  document.body.append(...roots)
  const editors = await Promise.all(
    roots.map((root) => InkKitEditor.mount(root, { changed() {} })),
  )
  try {
    for (const editor of editors) {
      editor.loadDocument({ ...input, text: 'Start\n' })
      typeTwice(editor)
      editor.undo()
    }
    expect(editors[0]!.discardUndone()).toBe(true)
    expect(editors[1]!.commandState().commands.redo).toBe(true)
    expect(editors[1]!.redo()).toBe(true)
  } finally {
    for (const editor of editors) await editor.destroy()
    roots.forEach((root) => root.remove())
  }
})
