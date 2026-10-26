import { expect, test } from 'vitest'
import { edit } from './edit-source'

// Text that reads as a character reference is text, so typing it one
// character at a time saves it with an escape and reopens as the same
// characters.

const references = ['&amp;', '&copy;', '&#35;', '&#x41;', '&nbsp;', '&Aacute;']

for (const [name, source, after] of [
  ['a paragraph', 'Write\n', 'Write'],
  ['a heading', '# Write\n', 'Write'],
  ['a list item', '- Write\n', 'Write'],
  ['a quote', '> Write\n', 'Write'],
  ['a table cell', '| a | b |\n| - | - |\n| Write | c |\n', 'Write'],
  ['a wrapped paragraph', 'Write one\nWrite two\n', 'two'],
] as const)
  for (const reference of references)
    test(`typing ${reference} in ${name} saves the characters typed`, async () => {
      let visible = ''
      const saved = await edit(source, (session) => {
        session.caret(after)
        session.type(` ${reference} more`)
        visible = session.view.state.doc.textContent
      })
      expect(visible).toContain(` ${reference} more`)
      expect(saved).toContain(String.raw`&${reference.slice(1, -1)}\; more`)
    })

test('typing a reference in a CRLF document keeps its line endings', async () => {
  expect(
    await edit('Write\r\nmore\r\n', (session) => {
      session.caret('Write')
      session.type(' &lt;b&gt; x')
    }),
  ).toBe(String.raw`Write &lt\;b&gt\; x` + '\r\nmore\r\n')
})

test('typing the opening & before text that completes a reference escapes its semicolon', async () => {
  expect(
    await edit('Write amp; more\n', (session) => {
      session.caret('Write ')
      session.type('&')
    }),
  ).toBe(String.raw`Write &amp\; more` + '\n')
})

test('typing the letter that completes a reference beside authored text escapes its semicolon', async () => {
  expect(
    await edit('Write &am; more\n', (session) => {
      session.caret('&am')
      session.type('p')
    }),
  ).toBe(String.raw`Write &amp\; more` + '\n')
})

test('an authored reference keeps its spelling beside typed text', async () => {
  expect(
    await edit('Write &amp; more\n', (session) => {
      session.caret('more')
      session.type('!')
    }),
  ).toBe('Write &amp; more!\n')
  expect(
    await edit('Write &amp; more\n', (session) => {
      session.caret('Write ')
      session.type('&')
    }),
  ).toBe('Write &amp;& more\n')
})

test('typing & and ; apart from a name saves them unchanged', async () => {
  expect(
    await edit('Write\n', (session) => {
      session.caret('Write')
      session.type(' a & b; c')
    }),
  ).toBe('Write a & b; c\n')
})

test('typing a reference into inline code is not escaped', async () => {
  expect(
    await edit('Write `ab`\n', (session) => {
      session.caret('a')
      session.type('&amp;')
    }),
  ).toBe('Write `a&amp;b`\n')
})

test('a reference typed for a stale generation changes nothing', async () => {
  await edit('Write\n', (session) => {
    session.caret('Write')
    session.type('&amp')
    expect(() => session.editor.insertText(';', 2)).toThrow('Document changed')
    expect(session.text()).toBe('Write&amp\n')
  })
})
