import { expect, test } from 'vitest'
import { InkKitEditor } from '../src/index'
import { autolinkRefusalCases } from './autolink-refusals-cases'

const source = 'Start\r\n\r\n+   untouched é &copy;\r\n'

async function session(run: (editor: InkKitEditor) => Promise<void>) {
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
    await run(editor)
    expect(errors).toEqual([])
  } finally {
    await editor.destroy()
    root.remove()
  }
}

function load(editor: InkKitEditor, text: string, generation = 1) {
  editor.loadDocument({
    documentId: 'refusals',
    generation,
    format: 'md',
    text,
  })
  expect(editor.snapshot().text).toBe(text)
}

function caret(editor: InkKitEditor, marker: string) {
  const text = editor.textSnapshot()
  const from = text.text.indexOf(marker) + marker.length
  expect(from).toBeGreaterThanOrEqual(marker.length)
  editor.selectTextRange({ snapshotId: text.snapshotId, from, to: from })
}

async function reopens(editor: InkKitEditor, expected: string) {
  expect(editor.snapshot().text).toBe(expected)
  const before = await editor.clipboardSnapshot('document')
  load(editor, expected, 2)
  const after = await editor.clipboardSnapshot('document')
  expect(after.text).toBe(before.text)
  const semantic = (html: string) =>
    html.replace(/ data-inkkit-link-form="[^"]*"/g, '')
  expect(semantic(after.html)).toBe(semantic(before.html))
}

for (const [wrapper, saved] of autolinkRefusalCases)
  for (const action of ['paste', 'characters'])
    test(`${action} of a literal ${wrapper} wrapper around a URL saves and reopens`, () =>
      session(async (editor) => {
        load(editor, source)
        caret(editor, 'Start')
        const text = ` ${wrapper}http://x.com${wrapper}`
        if (action === 'paste') expect(editor.pasteAsPlainText(text)).toBe(true)
        else for (const character of text) editor.pasteAsPlainText(character)
        const expected = `Start ${saved}\r\n\r\n+   untouched é &copy;\r\n`
        expect((await editor.clipboardSnapshot('document')).text).toContain(
          `Start${text}`,
        )
        expect(editor.snapshot().text).toBe(expected)
        expect(editor.undo()).toBe(true)
        expect(editor.snapshot().text).toBe(source)
        expect(editor.redo()).toBe(true)
        await reopens(editor, expected)
      }))

for (const marker of ['x', '.com'])
  test(`typing a pipe after ${marker} inside a table URL saves and reopens`, () =>
    session(async (editor) => {
      const before =
        '| Link |\r\n| --- |\r\n| http://x.com/path |\r\n\r\n+   untouched é &copy;\r\n'
      load(editor, before)
      caret(editor, marker)
      expect(editor.insertText('|', 1)).toBe(true)
      const address = 'http://x.com/path'.replace(marker, `${marker}\\|`)
      const expected = before.replace(
        'http://x.com/path',
        `[${address}](${address})`,
      )
      expect(editor.snapshot().text).toBe(expected)
      expect(editor.undo()).toBe(true)
      expect(editor.snapshot().text).toBe(before)
      expect(editor.redo()).toBe(true)
      await reopens(editor, expected)
    }))

for (const [literal, written] of [
  [' (**http://x.com**).', ' (\\*\\*<http://x.com>\\*\\*).'],
  [' **_http://x.com/a*b_**', ' \\*\\*\\_<http://x.com/a*b>\\_\\*\\*'],
])
  test(`literal punctuation around ${literal} keeps existing links and other blocks`, () =>
    session(async (editor) => {
      const before =
        'Start\n\nKeep [label](https://kept.example "title") and <https://other.example>\n'
      load(editor, before)
      caret(editor, 'Start')
      editor.pasteAsPlainText(literal!)
      await reopens(editor, before.replace('Start', `Start${written}`))
    }))
