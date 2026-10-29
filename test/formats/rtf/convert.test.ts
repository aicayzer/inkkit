import { describe, expect, test } from 'vitest'
import type {
  RichTextBlock,
  RichTextDocument,
  RichTextInline,
  RichTextMark,
} from '../../../src/core'
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

test('text that looks like Markdown, edge spaces and table pipes read back the same', () =>
  withRichEditor({}, ({ editor }) => {
    for (const document of [
      doc(
        para(' lead and trail '),
        para('\tTab start'),
        para('1. not a list'),
        para('# not heading'),
        para('<u>literal</u> *x* _y_ `z` \\ back'),
        para('end', { type: 'break' }),
        para('a  b'),
        para('&amp; &#x20;'),
      ),
      doc({
        type: 'table',
        rows: [
          [{ content: [] }, { content: [t('a | b')] }],
          [{ content: [t(' x ')] }, { content: [{ type: 'break' }] }],
        ],
      }),
      doc({
        type: 'list',
        ordered: false,
        items: [{ blocks: [para()] }, { blocks: [para('- dash')] }],
      }),
    ]) {
      editor.loadDocument(rich(document))
      const converted = editor.convertDocument('md')
      if (converted.format !== 'md') throw new Error('not Markdown')
      editor.loadDocument(text('md', converted.text))
      expect(editor.convertDocument('rtf')).toEqual({
        format: 'rtf',
        document,
        lost: [],
      })
    }
  }))

describe('runs with spaces at their edges', () => {
  test('ordinary runs convert, with spaces moved outside their marks', () =>
    withRichEditor({}, ({ editor }) => {
      const cases: [RichTextDocument, string, string[]][] = [
        [
          doc(para(t('bold ', { type: 'bold' }), 'text')),
          '**bold** text\n',
          [],
        ],
        [doc(para('a', t(' it ', { type: 'italic' }), 'b')), 'a *it* b\n', []],
        [
          doc(para(t('gone ', { type: 'strikethrough' }), 'x')),
          '~~gone~~ x\n',
          ['mark-spaces'],
        ],
        [
          doc(
            para(
              t('link ', { type: 'link', href: 'https://a.example/' }),
              'after',
            ),
          ),
          '[link](https://a.example/) after\n',
          ['mark-spaces'],
        ],
        [doc(para('x', t(' ', { type: 'superscript' }), 'y')), 'x y\n', []],
        [doc(para({ type: 'break' })), '', ['empty-line']],
      ]
      for (const [document, markdown, lost] of cases) {
        editor.loadDocument(rich(document))
        const converted = editor.convertDocument('md')
        expect(converted).toMatchObject({ format: 'md', text: markdown })
        expect(converted.lost.map((loss) => loss.code)).toEqual(lost)
      }
    }))
})

/** A small seeded generator, so a failure names the case that reproduces it. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function randomDocument(next: () => number): RichTextDocument {
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(next() * values.length)]!
  const texts = [
    'a',
    'word',
    ' ',
    '  x ',
    'bold ',
    ' it ',
    'é',
    '*',
    '_',
    '[x]',
    '#',
    '1.',
    '\\',
    '<u>',
    '&amp;',
    '`',
    'tab\there',
    '😀',
    ' end',
  ]
  const markTypes = [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'superscript',
    'subscript',
    'code',
  ] as const
  const inlines = (): RichTextInline[] =>
    Array.from({ length: 1 + Math.floor(next() * 5) }, (): RichTextInline => {
      if (next() < 0.12) return { type: 'break' }
      const marks: RichTextMark[] = []
      for (const type of markTypes)
        if (
          next() < 0.2 &&
          !(
            type === 'subscript' &&
            marks.some((mark) => mark.type === 'superscript')
          )
        )
          marks.push({ type })
      if (next() < 0.15)
        marks.push({
          type: 'link',
          href: pick(['https://a.example/', 'mailto:a@cyzr.me', 'rel/path']),
        })
      return marks.length
        ? { type: 'text', text: pick(texts), marks }
        : { type: 'text', text: pick(texts) }
    })
  const paragraph = (): RichTextBlock => {
    const align = pick([
      undefined,
      undefined,
      'center',
      'right',
      'justify',
    ] as const)
    return align
      ? { type: 'paragraph', align, content: inlines() }
      : { type: 'paragraph', content: inlines() }
  }
  const list = (depth: number): RichTextBlock => ({
    type: 'list',
    ordered: next() < 0.5,
    items: Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({
      blocks: [
        paragraph(),
        ...(depth < 3 && next() < 0.3 ? [list(depth + 1)] : []),
      ],
    })),
  })
  const width = 1 + Math.floor(next() * 3)
  return doc(
    ...Array.from({ length: 1 + Math.floor(next() * 4) }, (): RichTextBlock => {
      const kind = next()
      if (kind < 0.6) return paragraph()
      if (kind < 0.85) return list(1)
      return {
        type: 'table',
        rows: Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
          Array.from({ length: width }, () => ({
            content: next() < 0.2 ? [] : inlines(),
          })),
        ),
      }
    }),
  )
}

/** `document` as a reader sees it: a space keeps only the marks that show on a space, and runs
 *  that then look alike merge. Alignment is left out. */
function visible(document: RichTextDocument): unknown {
  const shown = new Set(['underline', 'strikethrough', 'link', 'code'])
  const inlines = (content: readonly RichTextInline[]) => {
    const out: { text?: string; marks: string; type: string }[] = []
    for (const inline of content) {
      if (inline.type === 'break') {
        out.push({ type: 'break', marks: '' })
        continue
      }
      for (const piece of inline.text.match(/ +|[^ ]+/g) ?? []) {
        const marks = JSON.stringify(
          (inline.marks ?? []).filter(
            (mark) => piece.trim() || shown.has(mark.type),
          ),
        )
        const last = out.at(-1)
        if (last?.type === 'text' && last.marks === marks) last.text += piece
        else out.push({ type: 'text', text: piece, marks })
      }
    }
    return out
  }
  const block = (item: RichTextBlock): unknown =>
    item.type === 'paragraph'
      ? inlines(item.content)
      : item.type === 'list'
        ? [
            item.ordered,
            item.start,
            item.items.map((entry) => entry.blocks.map(block)),
          ]
        : item.rows.map((row) => row.map((cell) => inlines(cell.content)))
  return document.blocks.map(block)
}

// Each seed is an independent sample, run in groups so one test stays within the timeout.
const convertSeeds = Number(process.env.RICH_TEXT_CONVERT_SEEDS ?? 300)
const convertGroup = 25
for (let first = 1; first <= convertSeeds; first += convertGroup) {
  const last = Math.min(convertSeeds, first + convertGroup - 1)
  test(`random rich documents convert to Markdown, read back and convert back (seeds ${first}-${last})`, () =>
    withRichEditor({}, ({ editor }) => {
      for (let index = first; index <= last; index++) {
        const document = randomDocument(random(index))
        editor.loadDocument(rich(document))
        const loaded = richSnapshot(editor).document
        let converted
        try {
          converted = editor.convertDocument('md')
        } catch (error) {
          throw new Error(
            `case ${index}: ${JSON.stringify(loaded)}: ${String(error)}`,
          )
        }
        if (converted.format !== 'md') throw new Error('not Markdown')
        editor.loadDocument(text('md', converted.text))
        const back = editor.convertDocument('rtf')
        if (back.format !== 'rtf') throw new Error('not RTF')
        // With nothing lost but alignment, the document comes back as a reader sees it.
        if (converted.lost.every((loss) => loss.code === 'alignment'))
          expect(visible(back.document), `case ${index}`).toEqual(
            visible(loaded),
          )
      }
    }))
}
