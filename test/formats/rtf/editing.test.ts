import { describe, expect, test } from 'vitest'
import type { FormatCommand, RichTextMark } from '../../../src/core'
import {
  doc,
  fixtures,
  para,
  rich,
  richSnapshot,
  select,
  type,
  withRichEditor,
} from './harness'

const t = (value: string, ...marks: RichTextMark[]) =>
  marks.length
    ? { type: 'text' as const, text: value, marks }
    : { type: 'text' as const, text: value }

describe('typing in an RTF document', () => {
  test('typed text saves, marks the document dirty and counts revisions', () =>
    withRichEditor({}, ({ editor, changes }) => {
      editor.loadDocument(rich(doc(para('Hello'))))
      select(editor, 'Hello', { caret: 'end' })
      type(editor, ' world')
      const snapshot = richSnapshot(editor)
      expect(snapshot.document).toEqual(doc(para('Hello world')))
      expect(snapshot.dirty).toBe(true)
      expect(snapshot.revision).toBe(6)
      expect(changes).toHaveLength(6)
      expect(changes.at(-1)).toEqual(snapshot)
    }))

  test('undo returns to the loaded document, which is clean again, and redo reapplies', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(fixtures['textedit-marks']!))
      select(editor, 'Plain', { caret: 'end' })
      type(editor, '!')
      expect(richSnapshot(editor).dirty).toBe(true)
      expect(editor.undo()).toBe(true)
      expect(richSnapshot(editor)).toMatchObject({
        document: fixtures['textedit-marks'],
        dirty: false,
      })
      expect(editor.redo()).toBe(true)
      expect(richSnapshot(editor).dirty).toBe(true)
    }))

  test('a line break saves as a break', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('ab'))))
      select(editor, 'a', { caret: 'end' })
      const { generation } = editor.commandState()
      expect(editor.keyDown({ key: 'Enter', shiftKey: true }, generation)).toBe(
        true,
      )
      expect(richSnapshot(editor).document).toEqual(
        doc(para('a', { type: 'break' }, 'b')),
      )
    }))

  test('Enter splits the paragraph, keeping its alignment', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(
        rich(doc({ type: 'paragraph', align: 'center', content: [t('ab')] })),
      )
      select(editor, 'a', { caret: 'end' })
      const { generation } = editor.commandState()
      editor.keyDown({ key: 'Enter' }, generation)
      expect(richSnapshot(editor).document).toEqual(
        doc(
          { type: 'paragraph', align: 'center', content: [t('a')] },
          { type: 'paragraph', align: 'center', content: [t('b')] },
        ),
      )
    }))

  test('typed text joins the marks around it, and decomposed input saves as NFC', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para(t('bold', { type: 'bold' })))))
      select(editor, 'bold', { caret: 'end' })
      type(editor, 'é')
      expect(richSnapshot(editor).document).toEqual(
        doc(para(t('boldé', { type: 'bold' }))),
      )
    }))

  test('a read-only document refuses typing and keeps its content', () =>
    withRichEditor({ editable: false }, ({ editor }) => {
      editor.loadDocument(rich(doc(para('Fixed'))))
      expect(() =>
        editor.insertText('x', editor.commandState().generation),
      ).toThrow(expect.objectContaining({ code: 'read-only' }))
      expect(editor.commandState().commands.format.bold).toBe(false)
      expect(richSnapshot(editor).document).toEqual(doc(para('Fixed')))
    }))
})

describe('marks', () => {
  const each: [FormatCommand, RichTextMark][] = [
    ['bold', { type: 'bold' }],
    ['italic', { type: 'italic' }],
    ['underline', { type: 'underline' }],
    ['strikethrough', { type: 'strikethrough' }],
    ['superscript', { type: 'superscript' }],
    ['subscript', { type: 'subscript' }],
    ['code', { type: 'code' }],
  ]
  for (const [command, mark] of each)
    test(`${command} applies and removes`, () =>
      withRichEditor({}, ({ editor }) => {
        editor.loadDocument(rich(doc(para('one two three'))))
        select(editor, 'two')
        expect(editor.commandState().commands.format[command]).toBe(true)
        expect(editor.format(command)).toBe(true)
        expect(richSnapshot(editor).document).toEqual(
          doc(para('one ', t('two', mark), ' three')),
        )
        select(editor, 'two')
        expect(editor.format(command)).toBe(true)
        expect(richSnapshot(editor)).toMatchObject({
          document: doc(para('one two three')),
          dirty: false,
        })
      }))

  test('superscript replaces subscript', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para(t('x', { type: 'subscript' })))))
      select(editor, 'x')
      editor.format('superscript')
      expect(richSnapshot(editor).document).toEqual(
        doc(para(t('x', { type: 'superscript' }))),
      )
    }))

  test('a host key applies underline through the keymap', () =>
    withRichEditor({ keymap: { underline: ['Mod-u'] } }, ({ editor }) => {
      editor.loadDocument(rich(doc(para('under'))))
      select(editor, 'under')
      const { generation } = editor.commandState()
      expect(editor.keyDown({ key: 'u', metaKey: true }, generation)).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(para(t('under', { type: 'underline' }))),
      )
    }))

  test('a link sets an address and drops underline from its run', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(
        rich(doc(para(t('site', { type: 'underline' }), ' more'))),
      )
      select(editor, 'site')
      expect(
        editor.format('link', { destination: 'https://example.com/' }),
      ).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para(
            t('site', { type: 'link', href: 'https://example.com/' }),
            ' more',
          ),
        ),
      )
    }))

  test('underline is unavailable on link text and does nothing there', () =>
    withRichEditor({}, ({ editor }) => {
      const loaded = doc(
        para('a ', t('link', { type: 'link', href: 'https://example.com/' })),
      )
      editor.loadDocument(rich(loaded))
      select(editor, 'link')
      expect(editor.commandState().commands.format.underline).toBe(false)
      expect(editor.format('underline')).toBe(false)
      expect(richSnapshot(editor)).toMatchObject({
        document: loaded,
        dirty: false,
      })
    }))

  test('underline over a link and plain text underlines only the plain text', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(
        rich(
          doc(
            para(
              'plain ',
              t('link', { type: 'link', href: 'https://example.com/' }),
            ),
          ),
        ),
      )
      select(editor, 'plain link')
      expect(editor.format('underline')).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para(
            t('plain ', { type: 'underline' }),
            t('link', { type: 'link', href: 'https://example.com/' }),
          ),
        ),
      )
    }))

  test('an unsafe link address is refused', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('click'))))
      select(editor, 'click')
      expect(() =>
        editor.format('link', { destination: 'javascript:alert(1)' }),
      ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
      expect(richSnapshot(editor).dirty).toBe(false)
    }))
})

describe('alignment', () => {
  test('each alignment command sets the paragraphs the selection touches', () =>
    withRichEditor({}, ({ editor, states }) => {
      editor.loadDocument(rich(doc(para('one'), para('two'), para('three'))))
      select(editor, 'one\ntwo')
      expect(editor.format('alignCenter')).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(
          { type: 'paragraph', align: 'center', content: [t('one')] },
          { type: 'paragraph', align: 'center', content: [t('two')] },
          para('three'),
        ),
      )
      expect(states.at(-1)?.caret.align).toBe('center')
      select(editor, 'two')
      expect(editor.format('alignRight')).toBe(true)
      select(editor, 'three')
      expect(editor.format('alignJustify')).toBe(true)
      select(editor, 'one')
      expect(editor.format('alignLeft')).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para('one'),
          { type: 'paragraph', align: 'right', content: [t('two')] },
          { type: 'paragraph', align: 'justify', content: [t('three')] },
        ),
      )
      // Setting the alignment a paragraph has changes nothing.
      expect(editor.format('alignLeft')).toBe(false)
      expect(editor.undo()).toBe(true)
      expect(editor.commandState().caret.align).toBe('center')
    }))

  test('a list item paragraph takes alignment, and a table cell does not', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(fixtures['textedit-table']!))
      select(editor, 'd')
      expect(editor.commandState().commands.format.alignCenter).toBe(false)
      expect(editor.format('alignCenter')).toBe(false)
      editor.loadDocument(rich(fixtures['textedit-lists']!))
      select(editor, 'nested a')
      expect(editor.format('alignRight')).toBe(true)
      const list = richSnapshot(editor).document.blocks[1] as {
        items: { blocks: { items: { blocks: { align?: string }[] }[] }[] }[]
      }
      expect(list.items[1]!.blocks[1]!.items[0]!.blocks[0]!.align).toBe('right')
    }))

  test('alignment is unavailable in Markdown', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument({
        documentId: 'md',
        generation: 1,
        format: 'md',
        text: 'Text\n',
      })
      const { format } = editor.commandState().commands
      expect([
        format.alignLeft,
        format.alignCenter,
        format.alignRight,
        format.alignJustify,
      ]).toEqual([false, false, false, false])
      expect(editor.format('alignCenter')).toBe(false)
      expect(editor.snapshot()).toMatchObject({ text: 'Text\n', dirty: false })
      expect(editor.commandState().caret.align).toBeUndefined()
    }))
})

describe('lists and tables', () => {
  test('a bullet list wraps a paragraph, and indent and outdent nest an item', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('one'), para('two'))))
      select(editor, 'one\ntwo')
      expect(editor.format('bulletList')).toBe(true)
      select(editor, 'two', { caret: 'end' })
      const { generation } = editor.commandState()
      expect(editor.keyDown({ key: 'Tab' }, generation)).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc({
          type: 'list',
          ordered: false,
          items: [
            {
              blocks: [
                para('one'),
                {
                  type: 'list',
                  ordered: false,
                  items: [{ blocks: [para('two')] }],
                },
              ],
            },
          ],
        }),
      )
      expect(editor.keyDown({ key: 'Tab', shiftKey: true }, generation)).toBe(
        true,
      )
      expect(richSnapshot(editor).document).toEqual(
        doc({
          type: 'list',
          ordered: false,
          items: [{ blocks: [para('one')] }, { blocks: [para('two')] }],
        }),
      )
    }))

  test('an ordered list keeps its start through edits', () =>
    withRichEditor({}, ({ editor }) => {
      const list = {
        type: 'list' as const,
        ordered: true,
        start: 4,
        items: [{ blocks: [para('four')] }],
      }
      editor.loadDocument(rich(doc(list)))
      select(editor, 'four', { caret: 'end' })
      type(editor, '!')
      expect(richSnapshot(editor).document).toEqual(
        doc({ ...list, items: [{ blocks: [para('four!')] }] }),
      )
    }))

  test('a table row added after the first keeps the first row first', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(fixtures['textedit-table']!))
      select(editor, 'H1', { caret: 'end' })
      expect(editor.table('addRowAfter')).toBe(true)
      expect(editor.commandState().commands.table.alignCenter).toBe(false)
      const table = richSnapshot(editor).document.blocks[1] as {
        rows: unknown[][]
      }
      expect(table.rows).toHaveLength(4)
      expect(table.rows[1]).toEqual([{ content: [] }, { content: [] }])
      select(editor, 'c', { caret: 'end' })
      type(editor, 'ell')
      expect(JSON.stringify(richSnapshot(editor).document)).toContain('"cell"')
    }))

  test('a table can be inserted', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('Before'))))
      select(editor, 'Before', { caret: 'end' })
      expect(editor.table('insert', { rows: 2, columns: 2 })).toBe(true)
      const blocks = richSnapshot(editor).document.blocks
      expect(blocks.some((block) => block.type === 'table')).toBe(true)
    }))
})

describe('what works as in Markdown formatted mode', () => {
  test('find and replace', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(
        rich(doc(para(t('cat', { type: 'bold' }), ' and cat'))),
      )
      expect(editor.find('cat')).toBe(true)
      expect(editor.replaceAll('cat', 'dog')).toBe(2)
      expect(richSnapshot(editor).document).toEqual(
        doc(para(t('dog', { type: 'bold' }), ' and dog')),
      )
    }))

  test('textSnapshot reads the text, and headings are empty', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(fixtures['textedit-layout']!))
      const readable = editor.textSnapshot()
      expect(readable.format).toBe('rtf')
      expect(readable.mode).toBe('formatted')
      expect(readable.text).toContain('Big Title')
      expect(editor.headings()).toEqual([])
    }))

  test('there is no source mode', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('a'))))
      expect(editor.setEditingMode('source')).toBe(false)
      expect(editor.editingMode).toBe('formatted')
      expect(editor.commandState().commands.replaceSource).toBe(false)
      expect(() => editor.replaceSource('x')).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
    }))

  test('a reload keeps the selection', () =>
    withRichEditor({}, ({ editor }) => {
      const first = rich(doc(para('alpha beta')))
      editor.loadDocument(first)
      select(editor, 'beta')
      editor.reloadDocument(
        rich(doc(para('alpha beta gamma'))),
        first.generation,
      )
      const readable = editor.textSnapshot()
      expect(
        readable.text.slice(readable.selection.from, readable.selection.to),
      ).toBe('beta')
      expect(richSnapshot(editor).dirty).toBe(false)
    }))

  test('a load in another format leaves no RTF behaviour behind', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('rich'))))
      editor.loadDocument({
        documentId: 'md',
        generation: 5000,
        format: 'md',
        text: '',
      })
      type(editor, '# ')
      expect(editor.snapshot()).toMatchObject({ format: 'md' })
      expect(editor.commandState().caret.block).toEqual({
        type: 'heading',
        level: 1,
      })
    }))
})
