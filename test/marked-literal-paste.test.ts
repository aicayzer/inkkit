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
  'before\n\n# **target**\n\nafter\n',
  'before\n\n| H |\n| - |\n| **target** |\n\nafter\n',
  'before\n\n# *target*\n\nafter\n',
  'before\n\n| H |\n| - |\n| *target* |\n\nafter\n',
  'before\n\n# ***target***\n\nafter\n',
  'before\n\n| H |\n| - |\n| ***target*** |\n\nafter\n',
  'before\n\n# ~~target~~\n\nafter\n',
  'before\n\n| H |\n| - |\n| ~~target~~ |\n\nafter\n',
  'before\n\n# ==target==\n\nafter\n',
  'before\n\n| H |\n| - |\n| ==target== |\n\nafter\n',
  'before\n\n# [target](https://example.com)\n\nafter\n',
  'before\n\n| H |\n| - |\n| [target](https://example.com) |\n\nafter\n',
])
  test(`literal clipboard keeps line structure and formatting in ${source}`, async () => {
    for (const text of ['α\nβ', 'α\n\nβ\n', 'α\r\n\r\nβ\r\n']) {
      let expected = ''
      await session(source, async (editor, root) => {
        select(editor)
        editor.pasteAsPlainText(text, 1)
        expected = editor.snapshot().text
        expect(expected.startsWith('before\n\n')).toBe(true)
        expect(expected.endsWith('\n\nafter\n')).toBe(true)
        const html = root.querySelector(
          source.includes('|') ? 'td p' : 'h1',
        )!.innerHTML
        editor.loadDocument({
          documentId: 'literal',
          generation: 2,
          format: 'md',
          text: expected,
        })
        expect(editor.snapshot().text).toBe(expected)
        expect(
          root.querySelector(source.includes('|') ? 'td p' : 'h1')!.innerHTML,
        ).toBe(html)
      })
      await session(source, async (editor, root) => {
        select(editor)
        paste(root, text)
        await Promise.resolve()
        expect(editor.snapshot().text).toBe(expected)
        editor.undo()
        expect(editor.snapshot().text).toBe(source)
        select(editor)
        editor.pasteAsPlainText(text, 1)
        editor.insertText('X', 1)
        const completed = editor.snapshot().text
        const content = root.querySelector(
          source.includes('|') ? 'td p' : 'h1',
        )!
        expect(content.textContent).toBe('αβX')
        const html = content.innerHTML
        editor.loadDocument({
          documentId: 'literal',
          generation: 2,
          format: 'md',
          text: completed,
        })
        expect(
          root.querySelector(source.includes('|') ? 'td p' : 'h1')!.innerHTML,
        ).toBe(html)
      })
    }
  })

test('recognised breaks inherit inline context without accepting other HTML', async () => {
  for (const tag of ['<br />', '<br>', '<br >', '<br/>']) {
    await session(`# **α${tag}β**\n`, async (editor, root) => {
      expect(root.querySelector('h1 strong br')).not.toBeNull()
      expect(editor.snapshot().text).toBe(`# **α${tag}β**\n`)
    })
  }
  for (const tag of ['<br class="x">', '<BR>', '<span>', '<script>']) {
    const source = `# **α${tag}β**\n`
    await session(source, async (editor, root) => {
      expect(root.querySelector('h1')).toBeNull()
      expect(root.querySelector('pre.inkkit-literal-markdown')).not.toBeNull()
      expect(editor.snapshot().text).toBe(source)
    })
  }
  await session('<br />\n', async (editor, root) => {
    expect(editor.snapshot().text).toBe('<br />\n')
    expect(root.querySelector('pre.inkkit-literal-markdown')).toBeNull()
  })
})
