import { expect, test } from 'vitest'
import { edit } from './edit-source'

// An edited block keeps the line ending the document uses, a lone CR too.

for (const [name, source, find, type, saved] of [
  [
    'a paragraph',
    'line one\rline two\r\rpara\r',
    'line two',
    's',
    'line one\rline twos\r\rpara\r',
  ],
  [
    'a list item',
    '- one\r- two\r  more\r\rpara\r',
    'two',
    's',
    '- one\r- twos\r  more\r\rpara\r',
  ],
  ['a quote', '> one\r> two\r\rpara\r', 'two', 's', '> one\r> twos\r\rpara\r'],
  [
    'a callout',
    '> [!NOTE]\r> one\r> two\r\rpara\r',
    'two',
    's',
    '> [!NOTE]\r> one\r> twos\r\rpara\r',
  ],
  [
    'a fenced code block',
    '```\rcode\rmore\r```\r\rpara\r',
    'code',
    's',
    '```\rcodes\rmore\r```\r\rpara\r',
  ],
  [
    'a fenced code block in a list item',
    '- ```\r  code\r  more\r  ```\r\rpara\r',
    'code',
    's',
    '- ```\r  codes\r  more\r  ```\r\rpara\r',
  ],
  [
    'a fenced code block in a quote',
    '> ```\r> code\r> more\r> ```\r\rpara\r',
    'code',
    's',
    '> ```\r> codes\r> more\r> ```\r\rpara\r',
  ],
  [
    'indented code',
    '    code\r    more\r\rpara\r',
    'code',
    's',
    '```\rcodes\rmore\r```\r\rpara\r',
  ],
  ['Unicode text', 'é😀 one\rtwo\r', 'two', 's', 'é😀 one\rtwos\r'],
] as const)
  test(`typing in ${name} of a lone-CR document keeps CR`, async () => {
    expect(
      await edit(source, (session) => {
        session.caret(find)
        session.type(type)
      }),
    ).toBe(saved)
  })

test('Enter in a lone-CR document writes CR', async () => {
  expect(
    await edit('line one\rline two\r\rpara\r', (session) => {
      session.caret('para')
      session.key('Enter')
      session.type('next')
    }),
  ).toBe('line one\rline two\r\rpara\r\rnext\r')
  expect(
    await edit('- one\r- two\r', (session) => {
      session.caret('one')
      session.key('Enter')
      session.type('new')
    }),
  ).toBe('- one\r- new\r- two\r')
})

test('a mixed document keeps the line ending it already used', async () => {
  expect(
    await edit('one\r\ntwo\rthree\n', (session) => {
      session.caret('one')
      session.type('1')
    }),
  ).toContain('one1')
})
