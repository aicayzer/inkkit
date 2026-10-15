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
      documentId: 'note',
      generation: 1,
      format: 'md',
      text: source,
    })
    expect(editor.snapshot().text).toBe(source)
    await run(editor, root)
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function caret(editor: InkKitEditor, marker: string) {
  const snapshot = editor.textSnapshot()
  const at = snapshot.text.indexOf(marker) + marker.length
  expect(at).toBeGreaterThanOrEqual(marker.length)
  editor.selectTextRange({ snapshotId: snapshot.snapshotId, from: at, to: at })
}

async function saves(editor: InkKitEditor, expected: string) {
  expect(editor.snapshot().text).toBe(expected)
  const clipboard = await editor.clipboardSnapshot('document')
  await session(expected, async (reopened) => {
    const other = await reopened.clipboardSnapshot('document')
    expect(other.text).toBe(clipboard.text)
    // The serializer may change the link's source form, but not its content.
    const semanticHTML = (html: string) =>
      html.replace(/ data-inkkit-link-form="[^"]*"/g, '')
    expect(semanticHTML(other.html)).toBe(semanticHTML(clipboard.html))
  })
}

for (const [source, saved] of [
  [
    'Start (www.example.com)\n',
    'Start ([www.example.com](http://www.example.com))&#x20;\n',
  ],
  ['Start \\[a](http://x.com)\n', 'Start \\[a](<http://x.com>)&#x20;\n'],
] as const)
  test(`a trailing space after ${source.trim()} reopens identically`, () =>
    session(source, async (editor) => {
      caret(editor, ')')
      editor.insertText(' ', 1)
      await saves(editor, saved)
      editor.undo()
      await saves(editor, source)
    }))

for (const text of [
  ' see http://x.com',
  ' (www.example.com). ',
  ' café ada@example.com',
  ' **literal** http://x.com',
])
  test(`plain-text paste of ${JSON.stringify(text)} reopens identically`, () =>
    session('Start\n', async (editor) => {
      caret(editor, 'Start')
      expect(editor.pasteAsPlainText(text)).toBe(true)
      const expected =
        text === ' (www.example.com). '
          ? 'Start ([www.example.com](http://www.example.com)).&#x20;\n'
          : text === ' **literal** http://x.com'
            ? 'Start \\*\\*literal\\*\\* http://x.com\n'
            : `Start${text}\n`
      await saves(editor, expected)
      editor.undo()
      await saves(editor, 'Start\n')
    }))

for (const action of ['typing', 'paste'] as const)
  test(`${action} inside inline code never autolinks`, () =>
    session('Code `here` end\n', async (editor, root) => {
      caret(editor, 'her')
      if (action === 'typing')
        for (const character of ' http://x.com') editor.insertText(character, 1)
      else editor.pasteAsPlainText(' http://x.com')
      expect(root.querySelector('code a')).toBeNull()
      expect(root.querySelector('a')).toBeNull()
      await saves(editor, 'Code `her http://x.come` end\n')
    }))

test('a refused plain-text paste leaves the document, selection, revision and history unchanged', () =>
  session('| Head |\n| --- |\n| Original |\n', async (editor) => {
    caret(editor, 'Original')
    const before = editor.snapshot()
    const selection = editor.textSnapshot().selection
    const commands = editor.commandState()
    expect(() => editor.pasteAsPlainText('one\r\nhttp://x.com')).toThrow(
      expect.objectContaining({ code: 'preservation' }),
    )
    expect(editor.snapshot()).toEqual(before)
    expect(editor.textSnapshot().selection).toEqual(selection)
    expect(editor.commandState()).toEqual(commands)
    expect(editor.undo()).toBe(false)
    await saves(editor, before.text)
  }))

for (const method of ['replaceTextRange', 'replaceAll'] as const)
  test(`${method} validates addresses after autolinking`, () =>
    session('Start word\n', async (editor) => {
      const snapshot = editor.textSnapshot()
      if (method === 'replaceTextRange')
        editor.replaceTextRange(
          { snapshotId: snapshot.snapshotId, from: 6, to: 10 },
          'http://x.com',
        )
      else expect(editor.replaceAll('word', 'http://x.com')).toBe(1)
      await saves(editor, 'Start http://x.com\n')
    }))
