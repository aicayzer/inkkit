import { expect, test } from 'vitest'
import { edit, type Session } from './edit-source'

// Tab and Shift+Tab move a list item between levels. The item keeps the
// Markdown it was written in; only its marker and indentation change, and a
// new sublist takes the marker of the list it opens in.

const tab = (session: Session) => expect(session.key('Tab')).toBe(true)
const outdent = (session: Session) =>
  expect(session.key('Tab', { shiftKey: true })).toBe(true)

for (const [name, source, item, saved] of [
  [
    'an ordered list with brackets',
    '1) __a__\n2) _b_\n3) c\n',
    'b',
    '1) __a__\n   1) _b_\n3) c\n',
  ],
  [
    'an ordered list with periods',
    '1. __a__\n2. _b_\n3. c\n',
    'b',
    '1. __a__\n   1. _b_\n3. c\n',
  ],
  ['a list with asterisks', '* __a__\n* _b_\n', 'b', '* __a__\n  * _b_\n'],
  ['a list with plus signs', '+ __a__\n+ _b_\n', 'b', '+ __a__\n  + _b_\n'],
  ['a list with hyphens', '- __a__\n- _b_\n', 'b', '- __a__\n  - _b_\n'],
  ['a task list', '- [ ] a\n- [x] _b_\n', 'b', '- [ ] a\n  - [x] _b_\n'],
  ['a CRLF document', '* a\r\n* _b_\r\n', 'b', '* a\r\n  * _b_\r\n'],
  ['Unicode items', '* é😀\n* _😀 b_\n', 'b', '* é😀\n  * _😀 b_\n'],
  ['a list indented two spaces', '  * a\n  * _b_\n', 'b', '  * a\n    * _b_\n'],
  [
    'a list indented by an item',
    '- x\n  - a\n  - _b_\n',
    'b',
    '- x\n  - a\n    - _b_\n',
  ],
  [
    'an item of two paragraphs',
    '* a\n* _b_\n\n  more\n',
    'b',
    '* a\n  * _b_\n\n    more\n',
  ],
  [
    'an item numbered with two digits',
    '10. a\n11. _b_\n12. c\n',
    'b',
    '10. a\n    1. _b_\n12. c\n',
  ],
  ['a loose list', '* a\n\n* _b_\n\n* c\n', 'b', '* a\n  * _b_\n\n* c\n'],
  [
    'an item with a code block',
    '* a\n* _b_\n\n  ```\n  code\n  ```\n',
    'b',
    '* a\n  * _b_\n\n    ```\n    code\n    ```\n',
  ],
  ['a list in a quote', '> * a\n> * _b_\n', 'b', '> * a\n>   * _b_\n'],
  [
    'a list in an item',
    '- x\n\n  * a\n  * _b_\n',
    'b',
    '- x\n\n  * a\n    * _b_\n',
  ],
  [
    'an item that follows an item with a sublist',
    '* a\n  * x\n* _b_\n',
    'b',
    '* a\n  * x\n  * _b_\n',
  ],
] as const)
  test(`Tab on an item of ${name} keeps its source and takes the list's marker`, async () => {
    expect(
      await edit(source, (session) => {
        session.caret(item)
        tab(session)
      }),
    ).toBe(saved)
  })

for (const [name, source, item, saved] of [
  ['plus signs', '+ a\n  + __b__\n', 'b', '+ a\n+ __b__\n'],
  [
    'asterisks in a CRLF document',
    '* a\r\n  * _b_\r\n',
    'b',
    '* a\r\n* _b_\r\n',
  ],
  ['a task list', '- [ ] a\n  - [x] _b_\n', 'b', '- [ ] a\n- [x] _b_\n'],
  [
    'an ordered list with brackets',
    '1) a\n   1) __b__\n2) c\n',
    'b',
    '1) a\n2) __b__\n2) c\n',
  ],
  [
    'an item followed by a sibling',
    '* a\n  * _b_\n  * c\n',
    'b',
    '* a\n* _b_\n  * c\n',
  ],
  [
    'an item of two paragraphs',
    '* a\n  * _b_\n\n    more\n',
    'b',
    '* a\n* _b_\n\n  more\n',
  ],
  ['Unicode items', '* é😀\n  * _😀 b_\n', 'b', '* é😀\n* _😀 b_\n'],
  ['a list indented two spaces', '  * a\n    * _b_\n', 'b', '  * a\n  * _b_\n'],
  [
    'a third level',
    '* a\n  * _b_\n    * _c_\n',
    'c',
    '* a\n  * _b_\n  * _c_\n',
  ],
  [
    'a sublist numbered differently',
    '1. a\n   1. _b_\n   2. _c_\n2. d\n',
    'b',
    '1. a\n2. _b_\n   1. _c_\n2. d\n',
  ],
  [
    'an item with a code block',
    '* a\n  * _b_\n\n    ```\n    code\n    ```\n',
    'b',
    '* a\n* _b_\n\n  ```\n  code\n  ```\n',
  ],
  ['a list in a quote', '> * a\n>   * _b_\n', 'b', '> * a\n> * _b_\n'],
] as const)
  test(`Shift+Tab on an item of ${name} keeps its source`, async () => {
    expect(
      await edit(source, (session) => {
        session.caret(item)
        outdent(session)
      }),
    ).toBe(saved)
  })

for (const [name, source, saved] of [
  ['an ordered list', '1) __a__\n2) _b_\n3) c\n', '__a__\n\n1) _b_\n2) c\n'],
  ['a bullet list', '* __a__\n* _b_\n', '__a__\n\n* _b_\n'],
  ['a list of one item', '- __a__\n', '__a__\n'],
] as const)
  test(`Shift+Tab on the first item of ${name} makes a paragraph that keeps its source`, async () => {
    expect(
      await edit(source, (session) => {
        session.caret('a')
        outdent(session)
      }),
    ).toBe(saved)
  })

test('Tab, then Shift+Tab, then Undo return to the authored source', async () => {
  const source = '1) __a__\n2) _b_\n3) c\n'
  expect(
    await edit(source, (session) => {
      session.caret('b')
      tab(session)
      outdent(session)
    }),
  ).toBe('1) __a__\n2) _b_\n3) c\n')
})

test('Tab on an item edited just before takes the marker of its list', async () => {
  expect(
    await edit('* a\n* _b_\n', (session) => {
      session.caret('b')
      session.type('X')
      tab(session)
    }),
  ).toBe('* a\n  * *bX*\n')
  expect(
    await edit('1) a\n2) _b_\n', (session) => {
      session.caret('b')
      session.type('X')
      tab(session)
    }),
  ).toBe('1) a\n   1) *bX*\n')
})

test('Tab on the last of three items, then on the first item of its sublist, keeps the items', async () => {
  expect(
    await edit('* a\n* _b_\n* _c_\n', (session) => {
      session.caret('c')
      tab(session)
      session.key('Tab')
    }),
  ).toBe('* a\n* _b_\n  * _c_\n')
})

test('Tab on the first item changes nothing', async () => {
  const source = '* __a__\n* _b_\n'
  expect(
    await edit(source, (session) => {
      session.caret('a')
      session.key('Tab')
    }),
  ).toBe(source)
})

test('Tab with a stale generation changes nothing', async () => {
  const source = '* a\n* _b_\n'
  expect(
    await edit(source, (session) => {
      session.caret('b')
      expect(() =>
        session.editor.keyDown({ key: 'Tab', code: 'Tab' }, 2),
      ).toThrow('Document changed')
      expect(session.text()).toBe(source)
    }),
  ).toBe(source)
})

test('Tab during composition is left to the input method', async () => {
  const source = '* a\n* _b_\n'
  expect(
    await edit(source, async (session) => {
      session.caret('b')
      session.view.dom.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      expect(session.key('Tab')).toBe(false)
      session.view.dom.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true }),
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(session.text()).toBe(source)
    }),
  ).toBe(source)
})
