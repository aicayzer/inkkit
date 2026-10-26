import { expect, test } from 'vitest'
import { edit } from './edit-source'

// An Obsidian comment on its own line stays on one line unless it holds one.

test('pasting a one-line comment keeps it on one line', async () => {
  expect(
    await edit('a\n\nb\n', async (session) => {
      session.caret('a')
      await session.paste({ text: '\n\n%%c%%', markdown: '\n\n%%c%%' })
    }),
  ).toContain('%%c%%')
})

test('a one-line comment edited while revealed stays on one line', async () => {
  const source = 'a\n\n%%c%%\n\nb\n'
  expect(
    await edit(source, (session) => {
      session.editor.setCommentsVisible(true)
      session.caret('c')
      session.type('d')
    }),
  ).toBe('a\n\n%%cd%%\n\nb\n')
})

test('a multi-line comment stays multi-line when edited', async () => {
  expect(
    await edit('a\n\n%%\nc\nd\n%%\n\nb\n', (session) => {
      session.editor.setCommentsVisible(true)
      session.caret('c')
      session.type('x')
    }),
  ).toBe('a\n\n%%\ncx\nd\n%%\n\nb\n')
})

test('a one-line comment on three lines stays on three lines when edited', async () => {
  expect(
    await edit('a\n\n%%\nc\n%%\n\nb\n', (session) => {
      session.editor.setCommentsVisible(true)
      session.caret('c')
      session.type('d')
    }),
  ).toBe('a\n\n%%\ncd\n%%\n\nb\n')
})

test('a comment that gains a line while revealed is written on several lines', async () => {
  expect(
    await edit('a\n\n%%c%%\n\nb\n', (session) => {
      session.editor.setCommentsVisible(true)
      session.caret('c')
      session.key('Enter')
      session.type('d')
    }),
  ).toBe('a\n\n%%\nc\nd\n%%\n\nb\n')
})

test('a one-line comment in a CRLF document keeps its line endings', async () => {
  expect(
    await edit('a\r\n\r\n%%c%%\r\n\r\nb\r\n', (session) => {
      session.editor.setCommentsVisible(true)
      session.caret('c')
      session.type('d')
    }),
  ).toBe('a\r\n\r\n%%cd%%\r\n\r\nb\r\n')
})

test('an HTML comment is unaffected', async () => {
  expect(
    await edit('a\n\n<!--c-->\n\nb\n', (session) => {
      session.editor.setCommentsVisible(true)
      session.caret('c')
      session.type('d')
    }),
  ).toBe('a\n\n<!--cd-->\n\nb\n')
})
