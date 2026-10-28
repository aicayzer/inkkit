import { ctxOf } from './editor-access'
import { expect } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { InkKitEditor, type ClipboardInput } from '../src/index'

export interface Session {
  editor: InkKitEditor
  view: EditorView
  /** Puts the caret just before (`'before'`) or after (`'after'`) the first `text` in the document. */
  caret(text: string, side?: 'before' | 'after'): void
  /** Presses a key, as a host forwarding native input does. */
  key(key: string, modifiers?: { shiftKey?: boolean }): boolean
  /** Types one character at a time, as the keyboard does. */
  type(text: string): void
  paste(input: ClipboardInput): Promise<void>
  text(): string
}

/**
 * Edits `source` through the facade and checks the three things every source
 * edit must keep: the saved Markdown reopens and saves as the same bytes, Undo
 * restores the exact source, and no error reached the host. Returns the saved
 * Markdown.
 */
export async function edit(
  source: string,
  body: (session: Session) => void | Promise<void>,
): Promise<string> {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: string[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
    error: (error) => errors.push(`${error.code}: ${error.message}`),
  })
  const view = ctxOf(editor).get(editorViewCtx) as EditorView
  const session: Session = {
    editor,
    view,
    caret(text, side = 'after') {
      let position = -1
      view.state.doc.descendants((node, from) => {
        if (position < 0 && node.isText && node.text!.includes(text))
          position =
            from +
            node.text!.indexOf(text) +
            (side === 'after' ? text.length : 0)
        return position < 0
      })
      expect(position, `"${text}" is in the document`).toBeGreaterThanOrEqual(0)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, position),
        ),
      )
    },
    key: (key, modifiers = {}) =>
      editor.keyDown({ key, code: key, ...modifiers }, 1),
    type(text) {
      for (const character of text)
        expect(editor.insertText(character, 1)).toBe(true)
    },
    async paste(input) {
      await editor.paste(input)
    },
    text: () => editor.snapshot().text,
  }
  try {
    editor.loadDocument({
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: source,
    })
    await body(session)
    expect(errors).toEqual([])
    const saved = editor.snapshot().text
    expect(editor.snapshot().dirty).toBe(saved !== source)
    for (let step = 0; step < 12 && editor.snapshot().text !== source; step++)
      editor.undo(1)
    expect(editor.snapshot().text).toBe(source)
    expect(editor.snapshot().dirty).toBe(false)
    editor.loadDocument({
      documentId: 'note',
      generation: 2,
      format: 'md',
      text: saved,
    })
    expect(editor.snapshot().text).toBe(saved)
    return saved
  } finally {
    await editor.destroy()
    root.remove()
  }
}
