import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { Preservation } from '../../../src/preserve'
import { ctxOf } from '../../editor-access'
import { input, typeLiteral, untidyTexts, withEditor } from '../harness'

describe('an unedited TXT document saves its loaded bytes', () => {
  const texts = {
    ...untidyTexts,
    'Markdown-looking text':
      '# Not a heading\r\n\r\n**literal** [x](y) %%kept%%\r\n',
  }
  for (const [name, text] of Object.entries(texts))
    test(name, () =>
      withEditor({ formats: ['txt'] }, async ({ editor }) => {
        editor.loadDocument(input('txt', text))
        expect(editor.snapshot()).toMatchObject({
          format: 'txt',
          text,
          dirty: false,
        })
        expect((await editor.clipboardSnapshot()).markdown).toBe(text)
      }),
    )
})

test('TXT typing saves as typed and keeps the document line endings', () =>
  withEditor(undefined, ({ editor, plain }) => {
    const text = '\uFEFFCafé\r\n# literal\r\n'
    editor.loadDocument(input('txt', text))
    expect(editor.editingMode).toBe('source')
    expect(editor.setEditingMode('formatted')).toBe(false)
    expect(editor.headings()).toEqual([])
    typeLiteral(plain, plain.value + '👍🏽')
    expect(editor.snapshot()).toMatchObject({ text: text + '👍🏽', dirty: true })
    // Pasted text takes the document's line endings in TXT.
    expect(editor.pasteAsPlainText('\nnext\nlast')).toBe(true)
    const saved = editor.snapshot().text
    expect(saved).toBe(text + '👍🏽\r\nnext\r\nlast')
    editor.loadDocument(input('txt', saved))
    expect(editor.snapshot()).toMatchObject({ text: saved, dirty: false })
    expect(editor.undo()).toBe(false)
  }))

test('a TXT document emptied by typing saves empty text', () =>
  withEditor(undefined, ({ editor, plain }) => {
    editor.loadDocument(input('txt', 'gone\r\n'))
    typeLiteral(plain, '')
    expect(editor.snapshot()).toMatchObject({ text: '', dirty: true })
    expect(editor.undo()).toBe(true)
    expect(editor.snapshot()).toMatchObject({ text: 'gone\r\n', dirty: false })
  }))

test('TXT paste inserts the plain text and ignores the Markdown', () =>
  withEditor(undefined, async ({ editor, plain }) => {
    editor.loadDocument(input('txt', 'One\n'))
    plain.setSelectionRange(plain.value.length, plain.value.length)
    await editor.paste({ text: 'plain words', markdown: '**bold**' })
    expect(editor.snapshot().text).toBe('One\nplain words')
  }))

test('TXT prints and copies the literal text', () =>
  withEditor(undefined, async ({ editor }) => {
    const text = '<b>not markup</b>\r\n![not](an-image.png)\r\n'
    editor.loadDocument(input('txt', text))
    const printed = await editor.printableSnapshot()
    expect(printed).toMatchObject({ format: 'txt', assets: [], warnings: [] })
    expect(printed.html).toContain('&lt;b&gt;not markup&lt;/b&gt;')
    expect(printed.html).not.toContain('<img')
    const copied = await editor.clipboardSnapshot()
    expect(copied).toMatchObject({ text, markdown: text, images: [] })
    expect(copied.html).toBe(
      '<pre>&lt;b&gt;not markup&lt;/b&gt;\r\n![not](an-image.png)\r\n</pre>',
    )
  }))

test('a TXT load leaves the formatted document empty, as reading empty Markdown does', () =>
  withEditor(undefined, ({ editor }) => {
    editor.loadDocument(input('txt', '# literal\r\ntext'))
    const ctx = ctxOf(editor)
    const doc = ctx.get(editorViewCtx).state.doc
    const markdown = Preservation.read(ctx, '').baseline
    expect(doc.eq(markdown)).toBe(true)
    expect(doc.attrs).toEqual(markdown.attrs)
  }))
