import { expect, test, vi } from 'vitest'
import { InkKitEditor, type EditorOptions } from '../src/index'
import { Preservation } from '../src/preserve'

const events = { changed() {}, stateChanged() {}, copy() {}, openLink() {} }
const input = {
  documentId: 'consolidation',
  generation: 1,
  format: 'md' as const,
}
async function withEditor(
  run: (editor: InkKitEditor, root: HTMLElement) => Promise<void>,
  options: EditorOptions = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, events, options)
  try {
    await run(editor, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

for (const text of ['one\ntwo', 'one\r\ntwo\rthree\n', '\nA😀B\n', '']) {
  test(`buffered multiline insertion remains saveable and undoable: ${JSON.stringify(text)}`, () =>
    withEditor(async (editor) => {
      editor.loadDocument({ ...input, text: '__Original__\n' })
      editor.insertText(text, 1)
      const snapshot = editor.snapshot(1)
      if (text) {
        expect(snapshot.text).toContain('Original')
        expect((await editor.clipboardSnapshot()).text).toContain(
          text.replace(/\r\n?/g, '\n'),
        )
        expect(editor.undo(1)).toBe(true)
        expect(editor.snapshot().text).toBe('__Original__\n')
        expect(editor.redo(1)).toBe(true)
        expect(editor.snapshot()).toEqual({
          ...snapshot,
          revision: editor.snapshot().revision,
        })
      }
      editor.reloadDocument({ ...snapshot, generation: 2 })
      expect(editor.snapshot().text).toBe(snapshot.text)
    }))
}

test('buffered code insertion normalises line endings and retains literal content', () =>
  withEditor(async (editor) => {
    editor.loadDocument({ ...input, text: '~~~~txt\noriginal\n~~~~\n' })
    editor.insertText('\r\n**literal**\rnext', 1)
    const text = editor.snapshot().text
    expect(text).toContain('original\n**literal**\nnext')
    expect(text).toContain('~~~~')
    editor.undo(1)
    expect(editor.snapshot().text).toBe('~~~~txt\noriginal\n~~~~\n')
  }))

for (const insertion of ['one\ntwo\n', 'one\r\ntwo\rthree']) {
  test(`multiline table insertion fails before mutation: ${JSON.stringify(insertion)}`, () =>
    withEditor(async (editor) => {
      editor.loadDocument({
        ...input,
        text: '| Head |\n| --- |\n| Original |\n',
      })
      const before = editor.snapshot()
      const state = editor.commandState()
      expect(() => editor.insertText(insertion, 1)).toThrow(
        expect.objectContaining({ code: 'preservation' }),
      )
      expect(editor.snapshot()).toEqual(before)
      expect(editor.commandState()).toEqual(state)
      expect(editor.undo(1)).toBe(false)
      expect(() => editor.pasteAsPlainText(insertion)).toThrow(
        expect.objectContaining({ code: 'preservation' }),
      )
      expect(editor.snapshot()).toEqual(before)
    }))
}

test('minimal rendering preserves code and unsupported source across edit, output, undo and reload', () =>
  withEditor(
    async (editor, root) => {
      const text =
        '\uFEFF~~~~mermaid  \r\nunsupported x\r\n~~~~~~  \r\n\r\n```typescript\r\nconst x = 1\r\n```\r\n\r\n<div>Raw **HTML**</div>\r\n'
      editor.loadDocument({ ...input, text })
      expect(root.querySelector('.inkkit-mermaid-preview')).toBeNull()
      expect(root.querySelector('[class*="hljs-"]')).toBeNull()
      expect(editor.snapshot().text).toBe(text)
      editor.setEditingMode('source')
      editor.replaceSource(text + 'After\r\n')
      editor.setEditingMode('formatted')
      editor.undo(1)
      expect(editor.snapshot().text).toBe(text)
      expect((await editor.clipboardSnapshot()).markdown).toBe(text)
      const printable = await editor.printableSnapshot()
      expect(
        printable.warnings.some((w) => w.code === 'diagram-unavailable'),
      ).toBe(true)
      expect(printable.html).toContain('unsupported x')
      editor.reloadDocument({ ...input, generation: 2, text })
      expect(editor.snapshot().text).toBe(text)
      expect(root.querySelector('.inkkit-mermaid-preview')).toBeNull()
    },
    { rendering: { codeHighlighting: false, diagramPreview: false } },
  ))

test('repeated capture reuses preserved source while edits, history and new documents remain fresh', () =>
  withEditor(async (editor) => {
    const spy = vi.spyOn(Preservation.prototype, 'serialize')
    try {
      editor.loadDocument({ ...input, text: '__Before__\r\n' })
      editor.insertText('!', 1)
      const first = editor.snapshot()
      const calls = spy.mock.calls.length
      expect(editor.snapshot()).toEqual(first)
      expect((await editor.clipboardSnapshot()).markdown).toBe(first.text)
      expect(spy.mock.calls.length).toBe(calls)
      editor.undo(1)
      expect(editor.snapshot().text).toBe('__Before__\r\n')
      editor.loadDocument({
        ...input,
        generation: 2,
        format: 'txt',
        text: '\uFEFF# TXT\r\n',
      })
      expect(editor.snapshot().text).toBe('\uFEFF# TXT\r\n')
      editor.loadDocument({ ...input, generation: 3, text: '_New_\n' })
      expect(editor.snapshot().text).toBe('_New_\n')
    } finally {
      spy.mockRestore()
    }
  }))
