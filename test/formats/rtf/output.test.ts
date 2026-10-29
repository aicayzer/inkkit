import { describe, expect, test } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import {
  ctxOf,
  doc,
  fixtures,
  para,
  rich,
  select,
  withRichEditor,
} from './harness'

describe('clipboard output from an RTF document', () => {
  test('the whole document copies as readable text and semantic HTML', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(rich(fixtures['textedit-marks']!))
      const output = await editor.clipboardSnapshot('document')
      expect(output.text).toContain('Plain, bold, italic')
      expect(output.text).not.toContain('**')
      for (const tag of [
        '<strong>',
        '<em>',
        '<u>',
        '<sup>',
        '<sub>',
        '<del>',
        '<code>',
      ])
        expect(output.html).toContain(tag)
      expect(output.html).toContain('<a href="https://example.com/a?b=1"')
      // An RTF document has no Markdown source: the Markdown field is its readable text.
      expect(output.markdown).toBe(output.text)
      expect(output.images).toEqual([])
      expect(output.diagrams).toEqual([])
    }))

  test('a selection copies only itself, with its alignment', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(
        rich(
          doc(
            {
              type: 'paragraph',
              align: 'center',
              content: [{ type: 'text', text: 'Centre' }],
            },
            para('Other'),
          ),
        ),
      )
      select(editor, 'Centre')
      const output = await editor.clipboardSnapshot('selection')
      expect(output.text).toBe('Centre')
      expect(output.html).not.toContain('Other')
    }))

  test('a native copy writes text and HTML, and a cut removes the selection', () =>
    withRichEditor({}, ({ editor, root }) => {
      editor.loadDocument(
        rich(
          doc(
            para(
              { type: 'text', text: 'under', marks: [{ type: 'underline' }] },
              ' rest',
            ),
          ),
        ),
      )
      select(editor, 'under')
      const data = new Map<string, string>()
      const event = new Event('cut', {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', {
        value: {
          setData: (type: string, value: string) => data.set(type, value),
        },
      })
      ctxOf(editor).get(editorViewCtx).dom.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(data.get('text/plain')).toBe('under')
      expect(data.get('text/html')).toContain('<u>under</u>')
      expect(root.textContent).toContain(' rest')
      expect(editor.snapshot()).toMatchObject({ document: doc(para(' rest')) })
    }))

  test('a copied unsafe link copies as its text', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(
        rich(
          doc(
            para({
              type: 'text',
              text: 'run',
              marks: [{ type: 'link', href: 'javascript:alert(1)' }],
            }),
          ),
        ),
      )
      const output = await editor.clipboardSnapshot('document')
      expect(output.html).not.toContain('javascript')
      expect(output.text).toBe('run')
    }))
})

describe('printable output from an RTF document', () => {
  test('prints the document with its marks, alignment, lists and tables', () =>
    withRichEditor({}, async ({ editor }) => {
      editor.loadDocument(
        rich(
          doc(
            {
              type: 'paragraph',
              align: 'right',
              content: [{ type: 'text', text: 'Right' }],
            },
            ...fixtures['textedit-marks']!.blocks,
            ...fixtures['textedit-lists']!.blocks,
            ...fixtures['textedit-table']!.blocks,
          ),
        ),
      )
      const printable = await editor.printableSnapshot()
      expect(printable.format).toBe('rtf')
      expect(printable.html).toContain('<p style="text-align: right">Right</p>')
      for (const tag of ['<u>', '<sup>', '<sub>', '<ol>', '<ul>', '<table>'])
        expect(printable.html).toContain(tag)
      expect(printable.assets).toEqual([])
      expect(printable.warnings).toEqual([])
    }))
})
