import { describe, expect, test } from 'vitest'
import type { RichTextMark } from '../../../src/core'
import {
  doc,
  fixtures,
  para,
  rich,
  richSnapshot,
  select,
  text,
  type,
  withRichEditor,
} from './harness'

const t = (value: string, ...marks: RichTextMark[]) =>
  marks.length
    ? { type: 'text' as const, text: value, marks }
    : { type: 'text' as const, text: value }

describe('Markdown to RTF', () => {
  test('keeps what RTF holds and lists each kind it drops', () =>
    withRichEditor({ wikiLinks: { open() {} } }, ({ editor }) => {
      editor.loadDocument(
        text(
          'md',
          [
            '# Title',
            '',
            'Para **b** *i* ~~s~~ `c` <u>u</u> x<sup>2</sup> H<sub>2</sub>O ==hi== [l](https://example.com/) [[Wiki]] note[^1]',
            '',
            '> Quoted',
            '',
            '> [!NOTE] Heads up',
            '> Inside',
            '',
            '```js',
            'let a = 1',
            '',
            '```',
            '',
            '- [x] done',
            '- plain',
            '',
            '0. zero',
            '',
            '---',
            '',
            '| a | b |',
            '|:-|-:|',
            '| c | d |',
            '',
            '%%private%%',
            '',
            '<div>raw</div>',
            '',
            '[^1]: The note.',
            '',
          ].join('\n'),
        ),
      )
      const converted = editor.convertDocument('rtf')
      expect(converted.format).toBe('rtf')
      if (converted.format !== 'rtf') return
      expect(converted.document).toEqual(
        doc(
          para(t('Title', { type: 'bold' })),
          para(
            'Para ',
            t('b', { type: 'bold' }),
            ' ',
            t('i', { type: 'italic' }),
            ' ',
            t('s', { type: 'strikethrough' }),
            ' ',
            t('c', { type: 'code' }),
            ' ',
            t('u', { type: 'underline' }),
            ' x',
            t('2', { type: 'superscript' }),
            ' H',
            t('2', { type: 'subscript' }),
            'O hi ',
            t('l', { type: 'link', href: 'https://example.com/' }),
            ' Wiki note[1]',
          ),
          para('Quoted'),
          para(t('Heads up', { type: 'bold' })),
          para('Inside'),
          para(t('let a = 1', { type: 'code' })),
          para(),
          {
            type: 'list',
            ordered: false,
            items: [{ blocks: [para('done')] }, { blocks: [para('plain')] }],
          },
          { type: 'list', ordered: true, items: [{ blocks: [para('zero')] }] },
          {
            type: 'table',
            rows: [
              [{ content: [t('a')] }, { content: [t('b')] }],
              [{ content: [t('c')] }, { content: [t('d')] }],
            ],
          },
          para('<div>raw</div>'),
          para('[1] The note.'),
        ),
      )
      expect(converted.lost).toEqual([
        { code: 'heading', count: 1 },
        { code: 'code-block', count: 1 },
        { code: 'quote', count: 1 },
        { code: 'callout', count: 1 },
        { code: 'task', count: 1 },
        { code: 'rule', count: 1 },
        { code: 'footnote', count: 2 },
        { code: 'comment', count: 1 },
        { code: 'highlight', count: 1 },
        { code: 'wiki-link', count: 1 },
        { code: 'literal', count: 1 },
        { code: 'table-alignment', count: 1 },
        { code: 'list-start', count: 1 },
      ])
      // The conversion changed nothing in the editor.
      expect(editor.snapshot()).toMatchObject({
        format: 'md',
        dirty: false,
        revision: 0,
      })
      // The host loads the result as a new generation, and it saves as converted.
      editor.loadDocument(rich(converted.document))
      expect(richSnapshot(editor)).toMatchObject({
        document: converted.document,
        dirty: false,
      })
    }))

  test('images, files, diagrams, list item blocks and deep lists', () =>
    withRichEditor(
      {
        images: {
          presentation: () => undefined,
          importImage: async () => ({ reference: 'x' }),
          exportImage: async () => ({
            bytes: new Uint8Array(),
            mimeType: 'image/png',
          }),
        },
      },
      ({ editor }) => {
        let deep = ''
        for (let level = 0; level < 10; level++)
          deep += `${'  '.repeat(level)}- l${level + 1}\n`
        editor.loadDocument(
          text(
            'md',
            `Pic ![alt](a.png) here\n\n\`\`\`mermaid\ngraph TD\n\`\`\`\n\n- first\n\n  second\n\nBetween\n\n${deep}`,
          ),
        )
        const converted = editor.convertDocument('rtf')
        if (converted.format !== 'rtf') throw new Error('not RTF')
        expect(converted.document.blocks.slice(0, 2)).toEqual([
          para('Pic  here'),
          para(t('graph TD', { type: 'code' })),
        ])
        expect(converted.document.blocks[2]).toEqual({
          type: 'list',
          ordered: false,
          items: [{ blocks: [para('first', { type: 'break' }, 'second')] }],
        })
        expect(converted.lost.map((loss) => loss.code)).toEqual([
          'diagram',
          'image',
          'list-item-blocks',
          'list-depth',
        ])
        // The result is a document the editor accepts.
        expect(() =>
          editor.loadDocument(rich(converted.document)),
        ).not.toThrow()
      },
    ))

  test('from source mode, what was typed there converts', () =>
    withRichEditor({}, ({ editor }) => {
      const loaded = text('md', 'One\n')
      editor.loadDocument(loaded)
      editor.setEditingMode('source')
      editor.replaceSource('Two **bold**\n')
      const converted = editor.convertDocument('rtf', loaded.generation)
      expect(converted).toEqual({
        format: 'rtf',
        document: doc(para('Two ', t('bold', { type: 'bold' }))),
        lost: [],
      })
    }))
})

describe('RTF to Markdown', () => {
  for (const [name, document] of Object.entries(fixtures))
    test(`${name} converts and reads back as the same document, less alignment`, () =>
      withRichEditor({}, ({ editor }) => {
        editor.loadDocument(rich(document))
        const converted = editor.convertDocument('md')
        if (converted.format !== 'md') throw new Error('not Markdown')
        const aligned = JSON.stringify(document).match(/"align"/g)?.length ?? 0
        expect(converted.lost).toEqual(
          aligned ? [{ code: 'alignment', count: aligned }] : [],
        )
        editor.loadDocument(text('md', converted.text))
        const back = editor.convertDocument('rtf')
        if (back.format !== 'rtf') throw new Error('not RTF')
        const unaligned = JSON.parse(
          JSON.stringify(document).replace(
            /"align":"(center|right|justify)",/g,
            '',
          ),
        )
        expect(back.document).toEqual(unaligned)
        expect(back.lost).toEqual([])
      }))

  test('marks without Markdown syntax are written as HTML, and breaks in cells as <br />', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(
        rich(
          doc(
            para(
              t('u', { type: 'underline' }),
              ' ',
              t('s', { type: 'superscript' }),
              ' ',
              t('b', { type: 'subscript' }),
            ),
            {
              type: 'table',
              rows: [[{ content: [t('a'), { type: 'break' }, t('b')] }]],
            },
          ),
        ),
      )
      expect(editor.convertDocument('md')).toEqual({
        format: 'md',
        text: '<u>u</u> <sup>s</sup> <sub>b</sub>\n\n| a<br />b |\n| -------- |\n',
        lost: [],
      })
    }))

  test('an edited document converts as edited', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('Hi'))))
      select(editor, 'Hi', { caret: 'end' })
      type(editor, '!')
      expect(editor.convertDocument('md')).toMatchObject({ text: 'Hi!\n' })
    }))
})

describe('other conversions', () => {
  test('the same format returns a copy', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(fixtures['textedit-lists']!))
      const copy = editor.convertDocument('rtf')
      expect(copy).toEqual({
        format: 'rtf',
        document: fixtures['textedit-lists'],
        lost: [],
      })
      editor.loadDocument(text('txt', 'plain\r\n'))
      expect(editor.convertDocument('txt')).toEqual({
        format: 'txt',
        text: 'plain\r\n',
        lost: [],
      })
    }))

  test('TXT to or from RTF, and between Markdown and TXT, is the host’s', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('a'))))
      expect(() => editor.convertDocument('txt')).toThrow(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('the host converts plain text'),
        }),
      )
      editor.loadDocument(text('txt', 'a'))
      expect(() => editor.convertDocument('rtf')).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
      expect(() => editor.convertDocument('md')).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
    }))

  test('a format the host did not offer, or a stale generation, is refused', () =>
    withRichEditor({ formats: ['md'] }, ({ editor }) => {
      const loaded = text('md', '# A\n')
      editor.loadDocument(loaded)
      expect(() => editor.convertDocument('rtf')).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
      expect(() => editor.convertDocument('md', loaded.generation + 1)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
    }))
})
