import { describe, expect, test } from 'vitest'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { RichTextMark } from '../../../src/core'
import {
  ctxOf,
  doc,
  para,
  rich,
  richSnapshot,
  select,
  type,
  withRichEditor,
} from './harness'
import { editorViewCtx } from '@milkdown/kit/core'

const t = (value: string, ...marks: RichTextMark[]) =>
  marks.length
    ? { type: 'text' as const, text: value, marks }
    : { type: 'text' as const, text: value }

describe('typed line endings', () => {
  test('a typed paragraph break at the end of a paragraph starts a new one', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('ab'))))
      select(editor, 'ab', { caret: 'end' })
      const { generation } = editor.commandState()
      expect(editor.insertText('\n', generation)).toBe(true)
      type(editor, 'c')
      expect(richSnapshot(editor).document).toEqual(doc(para('ab'), para('c')))
    }))

  test('buffered text that ends in a line ending keeps it', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('ab'))))
      select(editor, 'a', { caret: 'end' })
      const { generation } = editor.commandState()
      expect(editor.insertText('x\r\n', generation)).toBe(true)
      expect(richSnapshot(editor).document).toEqual(doc(para('ax'), para('b')))
      expect(editor.pasteAsPlainText('\n\n')).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(para('ax'), para(), para(), para('b')),
      )
    }))
})

describe('stored marks', () => {
  test('plain text pasted at a caret with a stored mark takes it', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('ab'))))
      select(editor, 'ab', { caret: 'end' })
      expect(editor.format('bold')).toBe(true)
      expect(editor.pasteAsPlainText('x\ny')).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para('ab', t('x', { type: 'bold' })),
          para(t('y', { type: 'bold' })),
        ),
      )
    }))

  test('multiline native text takes the stored mark too', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para(t('ab', { type: 'italic' })))))
      select(editor, 'ab', { caret: 'end' })
      expect(editor.format('italic')).toBe(true)
      const { generation } = editor.commandState()
      expect(editor.insertText('c\nd', generation)).toBe(true)
      expect(richSnapshot(editor).document).toEqual(
        doc(para(t('ab', { type: 'italic' }), 'c'), para('d')),
      )
    }))
})

describe('lone surrogates', () => {
  test('an edit that leaves a lone surrogate is refused and changes nothing', () =>
    withRichEditor({}, ({ editor, changes }) => {
      editor.loadDocument(rich(doc(para('ab'))))
      select(editor, 'a', { caret: 'end' })
      const view = ctxOf(editor).get(editorViewCtx)
      const before = view.state.doc
      expect(
        editor.insertText('\uD800', editor.commandState().generation),
      ).toBe(true)
      view.dispatch(view.state.tr.insertText('x\uDC00', 2))
      expect(view.state.doc).toBe(before)
      expect(changes).toEqual([])
      expect(editor.undo()).toBe(false)
      expect(richSnapshot(editor)).toMatchObject({
        document: doc(para('ab')),
        revision: 0,
        dirty: false,
      })
    }))

  test('a whole surrogate pair is kept', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('ab'))))
      select(editor, 'a', { caret: 'end' })
      type(editor, '😀')
      expect(richSnapshot(editor).document).toEqual(doc(para('a😀b')))
    }))
})

describe('HTML paste structure', () => {
  test('a table with a cell spanning rows pastes as a paragraph per row', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({
        text: '',
        html: '<p>Before</p><table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr><tr><td>D</td><td>E</td></tr></table><p>After</p>',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para('Before'),
          para('A\tB'),
          para('C'),
          para('D\tE'),
          para('After'),
        ),
      )
    }))

  test('a table with only spanned columns stays a table, padded', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({
        text: '',
        html: '<p>Before</p><table><tr><td colspan="2">A</td></tr><tr><td>B</td><td>C</td></tr></table><p>After</p>',
      })
      expect(richSnapshot(editor).document.blocks[1]).toEqual({
        type: 'table',
        rows: [
          [{ content: [t('A')] }, { content: [] }],
          [{ content: [t('B')] }, { content: [t('C')] }],
        ],
      })
    }))

  test('whitespace between tags makes no paragraph or list item', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({
        text: '',
        html: '<p>one</p>\n<p>two</p>\n  <ul>\n    <li>a</li>\n    <li>b</li>\n  </ul>\n<p>three</p>\n',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para('one'),
          para('two'),
          {
            type: 'list',
            ordered: false,
            items: [{ blocks: [para('a')] }, { blocks: [para('b')] }],
          },
          para('three'),
        ),
      )
    }))

  test('an explicit empty paragraph is kept, and so is a line of only a break', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(doc(para())))
      await editor.paste({
        text: '',
        html: '<p>one</p><p></p><p><br></p><p>two</p>',
      })
      expect(richSnapshot(editor).document).toEqual(
        doc(para('one'), para(), para(), para('two')),
      )
    }))
})

describe('one link rule', () => {
  test('an odd but allowed address loads, edits and pastes as given', () =>
    withRichEditor({}, async ({ editor }) => {
      const odd = 'http://['
      const loaded = doc(para(t('odd', { type: 'link', href: odd }), ' x'))
      editor.loadDocument(rich(loaded))
      expect(richSnapshot(editor)).toMatchObject({
        document: loaded,
        dirty: false,
      })
      select(editor, 'x')
      expect(editor.format('link', { destination: 'https://a b/[' })).toBe(true)
      select(editor, 'x', { caret: 'end' })
      await editor.paste({ text: 'p', html: `<a href="${odd}">p</a>` })
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para(
            t('odd', { type: 'link', href: odd }),
            ' ',
            t('x', { type: 'link', href: 'https://a b/[' }),
            t('p', { type: 'link', href: odd }),
          ),
        ),
      )
    }))

  test('a control character in an address is refused everywhere', () =>
    withRichEditor({}, async ({ editor }) => {
      expect(() =>
        editor.loadDocument(
          rich(doc(para(t('x', { type: 'link', href: 'https://a\u0085b/' })))),
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('control character'),
        }),
      )
      editor.loadDocument(rich(doc(para('x'))))
      select(editor, 'x')
      expect(() =>
        editor.format('link', { destination: 'https://a\u0085b/' }),
      ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
      select(editor, 'x', { caret: 'end' })
      await editor.paste({
        text: 'p',
        html: '<a href="https://a&#x1;b/">p</a>',
      })
      expect(richSnapshot(editor).document).toEqual(doc(para('xp')))
      const view = ctxOf(editor).get(editorViewCtx)
      const before = view.state.doc
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, 1, 2))
          .addMark(1, 2, view.state.schema.marks.link!.create({ href: '' })),
      )
      expect(view.state.doc).toBe(before)
    }))
})
