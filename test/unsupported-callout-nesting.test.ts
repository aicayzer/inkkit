import { expect, test } from 'vitest'
import { edit } from './edit-source'

// A callout of a type Inkkit can't show stays source. Beside it in a quote or
// a list item, an edit still saves, and the callout keeps its bytes.

for (const [name, source, find, saved] of [
  [
    'a quote',
    '> quote\n>\n> > [!BOGUS]\n> > body\n',
    'quote',
    '> quote!\n>\n> > [!BOGUS]\n> > body\n',
  ],
  [
    'a nested quote',
    '> > quote\n> >\n> > > [!BOGUS]\n> > > body\n',
    'quote',
    '> > quote!\n> >\n> > > [!BOGUS]\n> > > body\n',
  ],
  [
    'a loose list item',
    '- item\n\n  > [!BOGUS]\n  > body\n',
    'item',
    '- item!\n\n  > [!BOGUS]\n  > body\n',
  ],
  [
    'a tight list item',
    '- item\n  > [!BOGUS]\n  > body\n',
    'item',
    '- item!\n  > [!BOGUS]\n  > body\n',
  ],
  [
    'an ordered list item',
    '1. item\n\n   > [!BOGUS]\n   > body\n',
    'item',
    '1. item!\n\n   > [!BOGUS]\n   > body\n',
  ],
  [
    'an item with a tab',
    '-\titem\n\n\t> [!BOGUS]\n\t> body\n',
    'item',
    '-\titem!\n\n\t> [!BOGUS]\n\t> body\n',
  ],
  [
    'three levels',
    '- one\n  - two\n\n    > [!BOGUS]\n    > body\n',
    'two',
    '- one\n  - two!\n\n    > [!BOGUS]\n    > body\n',
  ],
  [
    'a quote in a list item',
    '- item\n\n  > quote\n  >\n  > > [!BOGUS]\n  > > body\n',
    'quote',
    '- item\n\n  > quote!\n  >\n  > > [!BOGUS]\n  > > body\n',
  ],
  [
    'a CRLF document',
    '> quote\r\n>\r\n> > [!BOGUS]\r\n> > body\r\n',
    'quote',
    '> quote!\r\n>\r\n> > [!BOGUS]\r\n> > body\r\n',
  ],
  [
    'Unicode text',
    '> é😀\n>\n> > [!BOGUS]\n> > bödy\n',
    'é😀',
    '> é😀!\n>\n> > [!BOGUS]\n> > bödy\n',
  ],
] as const)
  test(`typing beside an unsupported callout in ${name} saves`, async () => {
    expect(
      await edit(source, (session) => {
        session.caret(find)
        session.type('!')
      }),
    ).toBe(saved)
  })

test('Enter beside an unsupported callout in a quote or a list item saves', async () => {
  expect(
    await edit('> quote\n>\n> > [!BOGUS]\n> > body\n', (session) => {
      session.caret('quote')
      expect(session.key('Enter')).toBe(true)
      session.type('next')
    }),
  ).toBe('> quote\n>\n> next\n>\n> > [!BOGUS]\n> > body\n')
  expect(
    await edit('- item\n\n  > [!BOGUS]\n  > body\n', (session) => {
      session.caret('item')
      expect(session.key('Enter')).toBe(true)
      session.type('next')
    }),
  ).toBe('- item\n- next\n\n  > [!BOGUS]\n  > body\n')
})

test('typing inside an unsupported callout in a quote saves', async () => {
  expect(
    await edit('> quote\n>\n> > [!BOGUS]\n> > body\n', (session) => {
      session.caret('body')
      session.type('!')
    }),
  ).toBe('> quote\n>\n> > [!BOGUS]\n> > body!\n')
})

test('an unsupported callout at the top level keeps its bytes beside an edit', async () => {
  expect(
    await edit('> [!BOGUS]\n> body\n\npara\n', (session) => {
      session.caret('para')
      session.type('!')
    }),
  ).toBe('> [!BOGUS]\n> body\n\npara!\n')
})
