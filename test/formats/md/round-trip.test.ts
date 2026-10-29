import { describe, expect, test } from 'vitest'
import { input, typeLiteral, untidyTexts, withEditor } from '../harness'

describe('an unedited Markdown document saves its loaded bytes', () => {
  const texts = {
    ...untidyTexts,
    'CRLF Markdown':
      '\uFEFF# Título\r\n\r\n- one\r\n* two\r\n\r\n> quote 👍🏽\r\n',
    'unsupported syntax':
      'Math $x^2$ :smile: <span>raw</span>\n\n%%private%%\n',
  }
  for (const [name, text] of Object.entries(texts))
    test(name, () =>
      withEditor(undefined, ({ editor }) => {
        editor.loadDocument(input('md', text))
        expect(editor.snapshot()).toMatchObject({
          format: 'md',
          text,
          dirty: false,
        })
        // Source mode shows the same bytes and saves them unchanged.
        expect(editor.setEditingMode('source')).toBe(true)
        expect(editor.snapshot().text).toBe(text)
        expect(editor.setEditingMode('formatted')).toBe(true)
        expect(editor.snapshot().text).toBe(text)
      }),
    )
})

test('a Markdown edit saves, reopens and keeps the bytes it did not touch', () =>
  withEditor(undefined, ({ editor }) => {
    const text = '\uFEFF# Café\r\n\r\n*  one\r\n*  two\r\n\r\nLast 👍🏽\r\n'
    const loaded = input('md', text)
    editor.loadDocument(loaded)
    expect(editor.insertText('!', loaded.generation)).toBe(true)
    const saved = editor.snapshot()
    expect(saved).toMatchObject({
      text: '\uFEFF# Café\r\n\r\n*  one\r\n*  two\r\n\r\nLast 👍🏽!\r\n',
      dirty: true,
    })
    editor.loadDocument(input('md', saved.text))
    expect(editor.snapshot()).toMatchObject({ text: saved.text, dirty: false })
  }))

test('Markdown pasted in source mode keeps its own line endings', () =>
  withEditor(undefined, async ({ editor, plain }) => {
    editor.loadDocument(input('md', 'One\r\n'))
    editor.setEditingMode('source')
    plain.setSelectionRange(plain.value.length, plain.value.length)
    await editor.paste({ text: 'plain', markdown: '**Two**\nThree' })
    expect(editor.snapshot().text).toBe('One\r\n**Two**\nThree')
  }))

test('Markdown saves the same after a TXT document was loaded between', () =>
  withEditor(undefined, async ({ editor, plain }) => {
    const text = '# Title\r\n\r\nFirst *para*graph.\r\n\r\n- item\r\n'
    const edit = () => {
      const loaded = input('md', text)
      editor.loadDocument(loaded)
      expect(editor.insertText('?', loaded.generation)).toBe(true)
      return editor.snapshot().text
    }
    const fresh = edit()
    expect(fresh).toBe('# Title\r\n\r\nFirst *para*graph.\r\n\r\n- item?\r\n')
    editor.loadDocument(input('txt', text))
    typeLiteral(plain, plain.value + 'typed')
    expect(editor.snapshot().text).toBe(text + 'typed')
    expect(edit()).toBe(fresh)
    // Source mode after the TXT document reads the Markdown again.
    editor.setEditingMode('source')
    typeLiteral(plain, plain.value.replace('item', 'entry'))
    expect(editor.snapshot().text).toBe(
      '# Title\r\n\r\nFirst *para*graph.\r\n\r\n- entry?\r\n',
    )
    editor.setEditingMode('formatted')
    expect(editor.headings().map((heading) => heading.text)).toEqual(['Title'])
  }))

test('a reload keeps source mode only from Markdown to Markdown', () =>
  withEditor(undefined, ({ editor }) => {
    editor.loadDocument(input('md', 'One\n'))
    editor.setEditingMode('source')
    editor.reloadDocument(input('md', 'Two\n'))
    expect(editor.editingMode).toBe('source')
    editor.reloadDocument(input('txt', 'Three\n'))
    expect(editor.editingMode).toBe('source')
    expect(editor.setEditingMode('formatted')).toBe(false)
    editor.reloadDocument(input('md', 'Four\n'))
    expect(editor.editingMode).toBe('formatted')
  }))
