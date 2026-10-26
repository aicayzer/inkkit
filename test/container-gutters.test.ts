import { expect, test } from 'vitest'
import { edit } from './edit-source'

// Text written into a quote or list keeps the gutter the document uses: the
// quote markers or the indentation that open each line.

// [name, source, text the caret follows, saved after pasting "y\nc" there]
const pasted: [string, string, string, string][] = [
  ['a quote', '> a\n> - x\n', 'a', '> ay\n> c\n> - x\n'],
  ['a nested quote', '> > a\n> > b\n', 'a', '> > ay\n> > c\n> > b\n'],
  [
    'a callout',
    '> [!NOTE]\n> a\n> - x\n',
    'a',
    '> [!NOTE]\n> ay\n> c\n> - x\n',
  ],
  ['a bullet item', '- a\n- x\n', 'a', '- ay\n  c\n- x\n'],
  ['an ordered item', '1. a\n2. x\n', 'a', '1. ay\n   c\n2. x\n'],
  [
    'an item of a list with a bracket',
    '1) a\n2) x\n',
    'a',
    '1) ay\n   c\n2) x\n',
  ],
  ['a task item', '- [ ] a\n- [x] x\n', 'a', '- [ ] ay\n  c\n- [x] x\n'],
  ['a list in a quote', '> - a\n> - x\n', 'a', '> - ay\n>   c\n> - x\n'],
  [
    'a quote in a list item',
    '- > a\n  >\n  > b\n',
    'a',
    '- > ay\n  > c\n  >\n  > b\n',
  ],
  ['a quote with a wide gutter', '>  a\n>  b\n', 'a', '>  ay\n>  c\n>  b\n'],
  [
    'an item with a wide marker',
    '-   a\n-   x\n',
    'a',
    '-   ay\n    c\n-   x\n',
  ],
  ['an indented list', '  * a\n  * x\n', 'a', '  * ay\n    c\n  * x\n'],
  [
    'a nested list',
    '- one\n  - a\n  - x\n',
    'a',
    '- one\n  - ay\n    c\n  - x\n',
  ],
  ['a quote after a paragraph', 'p\n\n> a\n', 'a', 'p\n\n> ay\n> c\n'],
  ['Unicode text', '> é😀\n> - x\n', '😀', '> é😀y\n> c\n> - x\n'],
]

for (const [name, source, after, saved] of pasted)
  test(`a pasted line break in ${name} carries its gutter`, async () => {
    expect(
      await edit(source, async (session) => {
        session.caret(after)
        await session.paste({ text: 'y\nc' })
      }),
    ).toBe(saved)
  })

test('a pasted line break in a CRLF document carries its gutter and keeps its endings', async () => {
  expect(
    await edit('> a\r\n> - x\r\n', async (session) => {
      session.caret('a')
      await session.paste({ text: 'y\r\nc' })
    }),
  ).toBe('> ay\r\n> c\r\n> - x\r\n')
  expect(
    await edit('- a\r\n- x\r\n', async (session) => {
      session.caret('a')
      await session.paste({ text: 'y\nc' })
    }),
  ).toBe('- ay\r\n  c\r\n- x\r\n')
})

test('a pasted line before an existing line of the paragraph carries the gutter', async () => {
  expect(
    await edit('> a\n> b\n', async (session) => {
      session.caret('b', 'before')
      await session.paste({ text: 'c\nd' })
    }),
  ).toBe('> a\n> c\n> db\n')
})

test('a pasted line break at the start of a paragraph in a quote keeps its gutter', async () => {
  expect(
    await edit('> a\n', async (session) => {
      session.caret('a', 'before')
      await session.paste({ text: 'y\nc' })
    }),
  ).toBe('> y\n> ca\n')
})

test('plain text pasted with a line break into a quote carries its gutter', async () => {
  expect(
    await edit('> a\n> - x\n', (session) => {
      session.caret('a')
      session.editor.pasteAsPlainText('\nc')
    }),
  ).toBe('> a\\\n> c\n> - x\n')
})

test('a paste for a stale generation changes nothing', async () => {
  const source = '> a\n'
  expect(
    await edit(source, async (session) => {
      session.caret('a')
      await expect(session.editor.paste({ text: 'y\nc' }, 2)).rejects.toThrow(
        'Document changed',
      )
      expect(session.text()).toBe(source)
    }),
  ).toBe(source)
})

// New items in a list that is indented, or numbered with a bracket, take the
// indentation and the marker of the items beside them.
type Marker = [first: string, second: string, added: string]
const markers: Marker[] = [
  ['-', '-', '-'],
  ['*', '*', '*'],
  ['+', '+', '+'],
  ['1.', '2.', '2.'],
  ['1)', '2)', '2)'],
]
for (const indent of ['', ' ', '  ', '   '])
  for (const [first, second, added] of markers)
    test(`Enter after an item of a list written as "${indent}${first}" adds an item with the same indentation and marker`, async () => {
      expect(
        await edit(
          `${indent}${first} a\n${indent}${second} b\n`,
          async (session) => {
            session.caret('a')
            expect(session.key('Enter')).toBe(true)
            session.type('N')
          },
        ),
      ).toBe(`${indent}${first} a\n${indent}${added} N\n${indent}${second} b\n`)
    })

test('a new item in an indented task list, CRLF document or Unicode list takes the indentation', async () => {
  expect(
    await edit('  - [ ] a\n  - [x] b\n', async (session) => {
      session.caret('a')
      session.key('Enter')
      session.type('N')
    }),
  ).toBe('  - [ ] a\n  - [ ] N\n  - [x] b\n')
  expect(
    await edit('  * a\r\n  * b\r\n', async (session) => {
      session.caret('a')
      session.key('Enter')
      session.type('N')
    }),
  ).toBe('  * a\r\n  * N\r\n  * b\r\n')
  expect(
    await edit('  * é😀\n  * b\n', async (session) => {
      session.caret('é😀')
      session.key('Enter')
      session.type('N')
    }),
  ).toBe('  * é😀\n  * N\n  * b\n')
})

test('a new item after the last item of an indented list, and after a multi-paragraph item, takes the indentation', async () => {
  expect(
    await edit('  * a\n  * b\n', async (session) => {
      session.caret('b')
      session.key('Enter')
      session.type('N')
    }),
  ).toBe('  * a\n  * b\n  * N\n')
  expect(
    await edit('  * a\n\n    more\n\n  * b\n', async (session) => {
      session.caret('more')
      session.key('Enter')
      session.type('N')
    }),
  ).toBe('  * a\n\n    more\n\n  * N\n\n  * b\n')
})

test('a new item in a list inside a quote with a wide gutter, or inside another item, takes the gutter', async () => {
  expect(
    await edit('>  - a\n>  - b\n', async (session) => {
      session.caret('a')
      session.key('Enter')
      session.type('N')
    }),
  ).toBe('>  - a\n>  - N\n>  - b\n')
  expect(
    await edit('1.  x\n    * a\n    * b\n', async (session) => {
      session.caret('a')
      session.key('Enter')
      session.type('N')
    }),
  ).toBe('1.  x\n    * a\n    * N\n    * b\n')
})

test('a new item with two lines keeps the indentation of both', async () => {
  expect(
    await edit('  * a\n  * b\n', async (session) => {
      session.caret('a')
      session.key('Enter')
      await session.paste({ text: 'p\nq' })
    }),
  ).toBe('  * a\n  * p\n    q\n  * b\n')
})

test('Enter in an indented list with a stale generation changes nothing', async () => {
  const source = '  * a\n  * b\n'
  expect(
    await edit(source, (session) => {
      session.caret('a')
      expect(() =>
        session.editor.keyDown({ key: 'Enter', code: 'Enter' }, 2),
      ).toThrow('Document changed')
      expect(session.text()).toBe(source)
    }),
  ).toBe(source)
})
