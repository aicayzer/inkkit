import { describe, expect, test } from 'vitest'
import type { RichTextDocument, RichTextMark } from '../../../src/core'
import {
  doc,
  fixtures,
  para,
  rich,
  richSnapshot,
  withRichEditor,
} from './harness'

describe('a golden document loads and snapshots back unchanged', () => {
  test('there are golden documents to read', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(7)
  })
  for (const [name, document] of Object.entries(fixtures))
    test(name, () =>
      withRichEditor({}, ({ editor }) => {
        editor.loadDocument(rich(document))
        const snapshot = richSnapshot(editor)
        expect(snapshot.document).toEqual(document)
        expect(snapshot.dirty).toBe(false)
        expect(editor.commandState().format).toBe('rtf')
      }),
    )
})

const marks: Exclude<RichTextMark['type'], 'link'>[] = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'superscript',
  'subscript',
  'code',
]

/** Every mark alone and in pairs, in canonical order, except superscript with subscript. */
function markCombinations(): RichTextMark[][] {
  const result: RichTextMark[][] = marks.map((type) => [{ type }])
  for (let a = 0; a < marks.length; a++)
    for (let b = a + 1; b < marks.length; b++)
      if (!(marks[a] === 'superscript' && marks[b] === 'subscript'))
        result.push([{ type: marks[a]! }, { type: marks[b]! }])
  result.push([
    { type: 'bold' },
    { type: 'link', href: 'https://example.com/' },
  ])
  result.push([
    { type: 'bold' },
    { type: 'italic' },
    { type: 'strikethrough' },
    { type: 'superscript' },
    { type: 'code' },
    { type: 'link', href: 'mailto:a@cyzr.me' },
  ])
  return result
}

const handBuilt: Record<string, RichTextDocument> = {
  'an empty document': doc(),
  'one empty paragraph': doc(para()),
  'empty paragraphs': doc(para(), para('Between'), para()),
  'every mark and pair of marks': doc(
    para(
      ...markCombinations().flatMap((set, index) => [
        { type: 'text' as const, text: `run ${index}`, marks: set },
        { type: 'text' as const, text: ' ' },
      ]),
    ),
  ),
  alignment: doc(
    {
      type: 'paragraph',
      align: 'center',
      content: [{ type: 'text', text: 'C' }],
    },
    {
      type: 'paragraph',
      align: 'right',
      content: [{ type: 'text', text: 'R' }],
    },
    { type: 'paragraph', align: 'justify', content: [] },
    para('Left'),
  ),
  'line breaks': doc(
    para({ type: 'break' }),
    para('a', { type: 'break' }, { type: 'break' }, 'b', { type: 'break' }),
  ),
  'nested lists with starts': doc({
    type: 'list',
    ordered: true,
    start: 3,
    items: [
      {
        blocks: [
          para('three'),
          {
            type: 'list',
            ordered: false,
            items: [
              {
                blocks: [
                  { type: 'paragraph', align: 'center', content: [] },
                  {
                    type: 'list',
                    ordered: true,
                    start: 7,
                    items: [{ blocks: [para('deep')] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { blocks: [para('four')] },
    ],
  }),
  'nine levels of lists': (() => {
    let list: RichTextDocument['blocks'][number] = {
      type: 'list',
      ordered: false,
      items: [{ blocks: [para('level 9')] }],
    }
    for (let level = 8; level >= 1; level--)
      list = {
        type: 'list',
        ordered: level % 2 === 0,
        items: [{ blocks: [para(`level ${level}`), list] }],
      }
    return doc(list)
  })(),
  tables: doc(
    {
      type: 'table',
      rows: [
        [
          {
            content: [
              { type: 'text', text: 'Only', marks: [{ type: 'bold' }] },
            ],
          },
        ],
      ],
    },
    {
      type: 'table',
      rows: [
        [{ content: [] }, { content: [{ type: 'text', text: 'b' }] }],
        [
          {
            content: [
              { type: 'text', text: 'x' },
              { type: 'break' },
              { type: 'text', text: 'y' },
            ],
          },
          { content: [] },
        ],
      ],
    },
  ),
  'Unicode, right-to-left text and emoji': doc(
    para('Café 👍🏽 नमस्ते שלום مرحبا ‍\u{1F469}‍\u{1F4BB} \t tab'),
    {
      type: 'paragraph',
      align: 'right',
      content: [{ type: 'text', text: 'עברית' }],
    },
  ),
}

describe('a hand-built document loads and snapshots back unchanged', () => {
  for (const [name, document] of Object.entries(handBuilt))
    test(name, () =>
      withRichEditor({}, ({ editor }) => {
        editor.loadDocument(rich(document))
        expect(richSnapshot(editor)).toMatchObject({ document, dirty: false })
      }),
    )
})

describe('a load takes the canonical form', () => {
  test('marks are sorted, equal runs merge and start 1 is left out', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(
        rich({
          version: 1,
          blocks: [
            {
              type: 'paragraph',
              align: null,
              content: [
                {
                  type: 'text',
                  text: 'a',
                  marks: [{ type: 'italic' }, { type: 'bold' }],
                },
                {
                  type: 'text',
                  text: 'b',
                  marks: [{ type: 'bold' }, { type: 'italic' }],
                },
                { type: 'text', text: 'c', marks: [] },
                { type: 'text', text: 'd' },
              ],
            },
            {
              type: 'list',
              ordered: true,
              start: 1,
              items: [{ blocks: [para('x')] }],
            },
          ],
        }),
      )
      expect(richSnapshot(editor)).toMatchObject({
        dirty: false,
        document: doc(
          para(
            {
              type: 'text',
              text: 'ab',
              marks: [{ type: 'bold' }, { type: 'italic' }],
            },
            'cd',
          ),
          { type: 'list', ordered: true, items: [{ blocks: [para('x')] }] },
        ),
      })
    }))

  test('decomposed text is NFC, also across runs that merge', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('Café ', 'e', '́'))))
      const snapshot = richSnapshot(editor)
      expect(snapshot.document).toEqual(doc(para('Café é')))
      expect(snapshot.dirty).toBe(false)
    }))

  test('a link run loses its underline', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(
        rich(
          doc(
            para({
              type: 'text',
              text: 'site',
              marks: [
                { type: 'link', href: 'https://example.com/' },
                { type: 'underline' },
                { type: 'bold' },
              ],
            }),
          ),
        ),
      )
      expect(richSnapshot(editor).document).toEqual(
        doc(
          para({
            type: 'text',
            text: 'site',
            marks: [
              { type: 'bold' },
              { type: 'link', href: 'https://example.com/' },
            ],
          }),
        ),
      )
    }))

  test('a snapshot is a new object that the host can change', () =>
    withRichEditor({}, ({ editor }) => {
      editor.loadDocument(rich(doc(para('Keep'))))
      const first = richSnapshot(editor)
      ;(first.document.blocks[0] as { content: unknown[] }).content.length = 0
      expect(richSnapshot(editor).document).toEqual(doc(para('Keep')))
    }))
})
