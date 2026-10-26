import { expect, test } from 'vitest'
import { edit } from './edit-source'

// A list item that opens with a quote or callout holds an empty first
// paragraph, because the schema needs one. Lifting a block out of the quote
// must not leave it to be written as a `<br />` line.

for (const [name, source, saved] of [
  ['a bullet item', '- > a\n  >\n  > b\n', '- a\n  > b\n'],
  ['an ordered item', '1. > a\n   >\n   > b\n', '1. a\n   > b\n'],
  ['a quote of one paragraph', '- > a\n', '- a\n'],
  [
    'a callout',
    '- > [!NOTE]\n  > a\n  >\n  > b\n',
    '- a\n  > [!NOTE]\n  > b\n',
  ],
  ['a CRLF document', '- > a\r\n  >\r\n  > b\r\n', '- a\r\n  > b\r\n'],
  ['Unicode text', '- > é😀\n  >\n  > b\n', '- é😀\n  > b\n'],
] as const) {
  test(`Backspace at the start of a quote that opens ${name} writes no empty paragraph`, async () => {
    expect(
      await edit(source, (session) => {
        session.caret(source.includes('é') ? 'é😀' : 'a', 'before')
        expect(session.key('Backspace')).toBe(true)
      }),
    ).toBe(saved)
  })
}

test('lifting a paragraph out of the quote with the formatting command writes no empty paragraph', async () => {
  expect(
    await edit('- > a\n  >\n  > b\n', (session) => {
      session.caret('a')
      session.editor.format('quote')
    }),
  ).toBe('- a\n  > b\n')
})

test('an authored empty first line keeps its spacer through other edits', async () => {
  const source = '- <br />\n  text\n- two\n'
  expect(
    await edit(source, (session) => {
      session.caret('text')
      session.type('X')
    }),
  ).toBe('- <br />\n  textX\n- two\n')
})

test('an authored empty first line before a quote keeps its spacer while the quote stays', async () => {
  const source = '- <br />\n  > text\n'
  expect(
    await edit(source, (session) => {
      session.caret('text')
      session.type('X')
    }),
  ).toBe('- <br />\n  > textX\n')
})

test('Backspace at the start of a quote after a paragraph in an item keeps both', async () => {
  expect(
    await edit('- one\n\n  > a\n  >\n  > b\n', (session) => {
      session.caret('a', 'before')
      session.key('Backspace')
    }),
  ).toBe('- one\n\n  a\n\n  > b\n')
})
