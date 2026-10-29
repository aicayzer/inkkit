import { expect, test } from 'vitest'
import { InkKitEditor, type FormatCommand, type InkKitError } from '../src/core'

async function session(run: (editor: InkKitEditor) => Promise<void>) {
  const root = document.createElement('div')
  document.body.append(root)
  const errors: InkKitError[] = []
  const editor = await InkKitEditor.mount(root, {
    changed() {},
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
    documentId: 'spelling',
    generation,
    format: 'md',
    text,
  })
  expect(editor.snapshot().text).toBe(text)
}

async function savedEdit(
  editor: InkKitEditor,
  source: string,
  expected: string,
) {
  expect(editor.snapshot().text).toBe(expected)
  const shown = await editor.clipboardSnapshot('document')
  expect(editor.undo()).toBe(true)
  expect(editor.snapshot().text).toBe(source)
  expect(editor.redo()).toBe(true)
  expect(editor.snapshot().text).toBe(expected)
  load(editor, expected, 2)
  const reopened = await editor.clipboardSnapshot('document')
  expect(reopened.text).toBe(shown.text)
  expect(reopened.html).toBe(shown.html)
  expect(reopened.markdown).toBe(shown.markdown)
}

const marks: Array<[FormatCommand, string, string]> = [
  ['bold', '**', '**'],
  ['italic', '*', '*'],
  ['strikethrough', '~~', '~~'],
  ['highlight', '==', '=='],
  ['underline', '<u>', '</u>'],
  ['superscript', '<sup>', '</sup>'],
  ['subscript', '<sub>', '</sub>'],
]

const paragraphs = [
  'Keep &amp; these words here',
  String.raw`Café &#x1F680; \*literal\* words \[label\] &copy; 日本語`,
  String.raw`First &NotEqualTilde; \_kept\_` +
    '\r\n' +
    String.raw`words &AMP; \#next`,
  String.raw`Before &amp; **already** words \*after\*`,
  String.raw`Before \*kept\* words [label](/path "title") &#169;`,
  String.raw`Before &amp; words <u>other &copy;</u> \*after\*`,
  'Before &amp; `code` words \\*after\\*',
]

for (const [command, opening, closing] of marks)
  for (const paragraph of paragraphs)
    for (const action of ['format', 'unformat'] as const)
      test(`${action} ${command} keeps inline spelling: ${paragraph}`, () =>
        session(async (editor) => {
          const plain = paragraph + '\r\n\r\n+   untouched &copy; é\r\n'
          const marked = plain.replace('words', `${opening}words${closing}`)
          const source = action === 'format' ? plain : marked
          load(editor, source)
          expect(editor.find('words')).toBe(true)
          expect(editor.format(command)).toBe(true)
          await savedEdit(editor, source, action === 'format' ? marked : plain)
        }))

for (const paragraph of paragraphs)
  test(`typing keeps inline spelling: ${paragraph}`, () =>
    session(async (editor) => {
      const source = paragraph + '\r\n'
      load(editor, source)
      expect(editor.find('words')).toBe(true)
      expect(editor.insertText('typed café 👩🏽‍💻', 1)).toBe(true)
      await savedEdit(editor, source, source.replace('words', 'typed café 👩🏽‍💻'))
    }))

test('a literal replacement character is distinct from inline syntax', () =>
  session(async (editor) => {
    const source = 'Keep &amp; \uFFFC `code` \\*tail\\*\r\n'
    load(editor, source)
    expect(editor.find('\uFFFC')).toBe(true)
    expect(editor.format('bold')).toBe(true)
    await savedEdit(editor, source, source.replace('\uFFFC', '**\uFFFC**'))
  }))

for (const [reference, character, formatted] of [
  ['&fjlig;', 'f', '**f**j'],
  ['&fjlig;', 'j', 'f**j**'],
  ['&NotEqualTilde;', '≂', '**≂**&#x338;'],
  ['&NotEqualTilde;', '̸', '≂**̸**'],
])
  test(`formatting only ${character} from ${reference} retains every decoded character`, () =>
    session(async (editor) => {
      const source = `Keep ${reference} words\r\n`
      load(editor, source)
      expect(editor.find(character!)).toBe(true)
      expect(editor.format('bold')).toBe(true)
      await savedEdit(editor, source, `Keep ${formatted} words\r\n`)
    }))
