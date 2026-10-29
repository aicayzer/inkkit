import { describe, expect, test } from 'vitest'
import { doc, para, rich, richSnapshot, text, withRichEditor } from './harness'

const list = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'list',
  ordered: false,
  items,
  ...extra,
})

function nested(depth: number): unknown {
  let block: unknown = list([{ blocks: [para('deepest')] }])
  for (let level = 1; level < depth; level++)
    block = list([{ blocks: [para('level'), block] }])
  return block
}

/** Each validation rule of the Swift model, with the first bad path the message names. */
const invalid: Record<string, [document: unknown, message: string]> = {
  'not an object': [[], 'input.document: must be an object'],
  'version 2': [
    { version: 2, blocks: [] },
    'input.document.version: version 2',
  ],
  'no blocks': [{ version: 1 }, 'input.document.blocks: must be a list'],
  'an unknown field': [
    { version: 1, blocks: [], extra: 1 },
    'input.document.extra',
  ],
  'an unknown block': [
    doc({ type: 'heading' } as never),
    'input.document.blocks[0].type: unknown block type',
  ],
  'left alignment': [
    { version: 1, blocks: [{ type: 'paragraph', align: 'left', content: [] }] },
    'input.document.blocks[0].align',
  ],
  'an empty run': [
    doc(para({ type: 'text', text: '' })),
    'input.document.blocks[0].content[0].text: a text run cannot be empty',
  ],
  'a line feed': [doc(para('a\nb')), 'text cannot hold U+000A'],
  'a carriage return': [doc(para('a\rb')), 'text cannot hold U+000D'],
  'a line separator': [doc(para('a b')), 'text cannot hold U+2028'],
  'a paragraph separator': [doc(para('a b')), 'text cannot hold U+2029'],
  'an attachment character': [doc(para('a￼b')), 'text cannot hold U+FFFC'],
  'a null character': [doc(para('a\u0000b')), 'text cannot hold U+0000'],
  'a vertical tab': [doc(para('a\u000Bb')), 'text cannot hold U+000B'],
  'a lone surrogate': [doc(para('a\uD800b')), 'lone surrogate'],
  'an unknown inline': [
    doc(para({ type: 'image' } as never)),
    'unknown inline type',
  ],
  'an unknown mark': [
    doc(
      para({
        type: 'text',
        text: 'a',
        marks: [{ type: 'highlight' } as never],
      }),
    ),
    'unknown mark type',
  ],
  'a repeated mark': [
    doc(
      para({
        type: 'text',
        text: 'a',
        marks: [{ type: 'bold' }, { type: 'bold' }],
      }),
    ),
    'the bold mark appears more than once',
  ],
  'two links': [
    doc(
      para({
        type: 'text',
        text: 'a',
        marks: [
          { type: 'link', href: 'https://a.example/' },
          { type: 'link', href: 'https://b.example/' },
        ],
      }),
    ),
    'the link mark appears more than once',
  ],
  'superscript and subscript': [
    doc(
      para({
        type: 'text',
        text: 'a',
        marks: [{ type: 'subscript' }, { type: 'superscript' }],
      }),
    ),
    'a run cannot be both superscript and subscript',
  ],
  'a link without an address': [
    doc(para({ type: 'text', text: 'a', marks: [{ type: 'link', href: '' }] })),
    'a link needs an address',
  ],
  'an unordered list with a start': [
    doc(list([{ blocks: [para('a')] }], { start: 1 }) as never),
    'input.document.blocks[0].start: only an ordered list has a start',
  ],
  'an ordered list starting at 0': [
    doc(list([{ blocks: [para('a')] }], { ordered: true, start: 0 }) as never),
    'the start must be at least 1',
  ],
  'a fractional start': [
    doc(
      list([{ blocks: [para('a')] }], { ordered: true, start: 1.5 }) as never,
    ),
    'must be a whole number',
  ],
  'an empty list': [doc(list([]) as never), 'a list needs at least one item'],
  'an item without a paragraph first': [
    doc(list([{ blocks: [list([{ blocks: [para('a')] }])] }]) as never),
    'input.document.blocks[0].items[0].blocks[0]: a list item must start with a paragraph',
  ],
  'an item with a second paragraph': [
    doc(list([{ blocks: [para('a'), para('b')] }]) as never),
    'after its paragraph, a list item can hold only lists',
  ],
  'lists ten deep': [
    doc(nested(10) as never),
    'lists nest deeper than 9 levels',
  ],
  'a table without rows': [
    doc({ type: 'table', rows: [] }),
    'a table needs at least one row',
  ],
  'a row without cells': [
    doc({ type: 'table', rows: [[]] }),
    'a table row needs at least one cell',
  ],
  'rows of different lengths': [
    doc({
      type: 'table',
      rows: [[{ content: [] }, { content: [] }], [{ content: [] }]],
    }),
    'input.document.blocks[0].rows[1]: the row has 1 cells, but the first row has 2',
  ],
}

describe('an invalid document is refused and changes nothing', () => {
  for (const [name, [document, message]] of Object.entries(invalid))
    test(name, () =>
      withRichEditor({}, ({ editor, changes }) => {
        editor.loadDocument(rich(doc(para('Loaded'))))
        const before = editor.commandState()
        expect(() => editor.loadDocument(rich(document))).toThrow(
          expect.objectContaining({
            code: 'invalid-argument',
            message: expect.stringContaining(message),
          }),
        )
        expect(richSnapshot(editor).document).toEqual(doc(para('Loaded')))
        expect(editor.commandState().generation).toBe(before.generation)
        expect(changes).toEqual([])
      }),
    )

  test('the same holds for a reload', () =>
    withRichEditor({}, ({ editor }) => {
      const loaded = rich(doc(para('Loaded')))
      editor.loadDocument(loaded)
      expect(() =>
        editor.reloadDocument(rich(doc(para('a\nb'))), loaded.generation),
      ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
      expect(richSnapshot(editor).generation).toBe(loaded.generation)
    }))
})

describe('a load must match its format', () => {
  test('RTF without a document, or with text, is refused', () =>
    withRichEditor({}, ({ editor }) => {
      expect(() =>
        editor.loadDocument({ ...rich(doc()), document: undefined } as never),
      ).toThrow(
        expect.objectContaining({
          code: 'invalid-argument',
          message: 'input.document: must be an object',
        }),
      )
      expect(() =>
        editor.loadDocument({ ...rich(doc()), text: '' } as never),
      ).toThrow(
        expect.objectContaining({
          code: 'invalid-argument',
          message: expect.stringContaining('input.text'),
        }),
      )
    }))

  test('Markdown with a document is refused', () =>
    withRichEditor({}, ({ editor }) => {
      expect(() =>
        editor.loadDocument({ ...text('md', '# A'), document: doc() } as never),
      ).toThrow(expect.objectContaining({ code: 'invalid-argument' }))
      expect(() => editor.snapshot()).toThrow(
        expect.objectContaining({ code: 'not-ready' }),
      )
    }))

  test('a format the host did not offer is refused', () =>
    withRichEditor({ formats: ['md', 'txt'] }, ({ editor }) => {
      expect(editor.formats.map((entry) => entry.format)).toEqual(['md', 'txt'])
      expect(() => editor.loadDocument(rich(doc(para('a'))))).toThrow(
        expect.objectContaining({
          code: 'invalid-argument',
          message: "input.format must be one of 'md', 'txt'",
        }),
      )
    }))

  test('RTF is offered with the structure promise', () =>
    withRichEditor({}, ({ editor }) => {
      expect(editor.formats).toEqual([
        { format: 'rtf', promise: 'structure' },
        { format: 'md', promise: 'exact' },
        { format: 'txt', promise: 'exact' },
      ])
    }))

  test('a stale generation is refused', () =>
    withRichEditor({}, ({ editor }) => {
      const first = rich(doc(para('First')))
      editor.loadDocument(first)
      const second = rich(doc(para('Second')))
      editor.loadDocument(second)
      expect(() => editor.loadDocument({ ...first })).toThrow(
        expect.objectContaining({ code: 'invalid-argument' }),
      )
      expect(() => editor.snapshot(first.generation)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      expect(() => editor.format('bold', undefined, first.generation)).toThrow(
        expect.objectContaining({ code: 'stale-document' }),
      )
      expect(richSnapshot(editor).document).toEqual(doc(para('Second')))
    }))
})
