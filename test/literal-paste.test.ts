import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/index'

async function session(
  source: string,
  run: (editor: InkKitEditor, root: HTMLElement) => Promise<void>,
) {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await InkKitEditor.mount(root, {
    changed() {},
    copy() {},
    openLink() {},
  })
  try {
    editor.loadDocument({
      documentId: 'literal',
      generation: 1,
      format: 'md',
      text: source,
    })
    await run(editor, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}
function select(editor: InkKitEditor) {
  const snapshot = editor.textSnapshot()
  const from = snapshot.text.indexOf('target')
  expect(from).toBeGreaterThanOrEqual(0)
  editor.selectTextRange({
    snapshotId: snapshot.snapshotId,
    from,
    to: from + 6,
  })
}
function paste(root: HTMLElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) =>
        type === 'text/plain'
          ? text
          : type === 'vscode-editor-data'
            ? 'invalid'
            : '',
      files: [],
      types: ['text/plain', 'vscode-editor-data'],
    },
  })
  root.querySelector('[contenteditable]')!.dispatchEvent(event)
}
for (const source of [
  'before\n\n**target**\n\nafter\n',
  'before\n\n| H |\n| - |\n| target |\n\nafter\n',
])
  test(`literal clipboard keeps line structure and formatting in ${source.includes('|') ? 'a cell' : 'bold'}`, async () => {
    for (const text of ['α\nβ', 'α\n\nβ\n', 'α\r\n\r\nβ\r\n']) {
      let expected = ''
      await session(source, async (editor) => {
        select(editor)
        editor.pasteAsPlainText(text, 1)
        expected = editor.snapshot().text
      })
      await session(source, async (editor, root) => {
        select(editor)
        paste(root, text)
        await Promise.resolve()
        expect(editor.snapshot().text).toBe(expected)
        editor.undo()
        expect(editor.snapshot().text).toBe(source)
      })
    }
  })

test('literal paste respects read-only, composition and stale-generation guards', async () => {
  await session('target\n', async (editor, root) => {
    select(editor)
    editor.setEditable(false)
    paste(root, 'α\nβ')
    await Promise.resolve()
    expect(editor.snapshot().text).toBe('target\n')
    expect(() => editor.pasteAsPlainText('α\nβ', 1)).toThrow(
      expect.objectContaining({ code: 'read-only' }),
    )
    editor.setEditable(true)
    expect(() => editor.pasteAsPlainText('α\nβ', 0)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    const editable = root.querySelector('[contenteditable]')!
    editable.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    expect(() => editor.pasteAsPlainText('α\nβ', 1)).toThrow(
      expect.objectContaining({ code: 'composition' }),
    )
    editable.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    expect(editor.snapshot().text).toBe('target\n')
  })
})
