import { expect, test } from 'vitest'
import { edit, type Session } from './edit-source'

const backspace = (session: Session) => session.key('Backspace')

// A fence typed at the start of a paragraph converts it, and Backspace takes
// the typed text back, as at the top level.
for (const [name, source, before] of [
  ['the top level', 'a\n', 'a'],
  ['a quote', '> a\n', 'a'],
  ['a nested quote', '> > a\n', 'a'],
  ['a callout', '> [!NOTE]\n> a\n', 'a'],
  ['the second paragraph of a list item', '- x\n\n  A B\n', 'A B'],
  ['a quote in a list item', '- x\n\n  > a\n', 'a'],
  ['the second paragraph of a task item', '- [ ] x\n\n  A B\n', 'A B'],
  ['the second paragraph of an ordered item', '1) x\n\n   A B\n', 'A B'],
] as const) {
  test(`Backspace right after a typed fence takes it back in ${name}`, async () => {
    const typed = await edit(source, (session) => {
      session.caret(before, 'before')
      session.type('``` ')
      expect(session.text()).toContain('```\n')
      expect(backspace(session)).toBe(true)
    })
    expect(typed).toBe(source.replace(before, String.raw`\`\`\` ` + before))
  })
}

test('Backspace after a typed fence in a quote keeps the quote and the later paragraph', async () => {
  expect(
    await edit('> a\n>\n> b\n', (session) => {
      session.caret('b', 'before')
      session.type('```js ')
      backspace(session)
    }),
  ).toBe('> a\n>\n> \\`\\`\\`js b\n')
})

test('Backspace after a fence does not undo an older rule once the caret has moved', async () => {
  expect(
    await edit('> a\n', (session) => {
      session.caret('a', 'before')
      session.type('``` ')
      session.caret('a', 'before')
      backspace(session)
    }),
  ).toBe('```\na\n```\n')
})

test('Backspace with a stale generation changes nothing', async () => {
  await edit('> a\n', (session) => {
    session.caret('a', 'before')
    session.type('``` ')
    const before = session.text()
    expect(() =>
      session.editor.keyDown({ key: 'Backspace', code: 'Backspace' }, 2),
    ).toThrow('Document changed')
    expect(session.text()).toBe(before)
    backspace(session)
  })
})

test('Backspace during composition is left to the input method', async () => {
  await edit('> a\n', async (session) => {
    session.caret('a', 'before')
    session.type('``` ')
    const before = session.text()
    session.view.dom.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    expect(backspace(session)).toBe(false)
    session.view.dom.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(session.text()).toBe(before)
    expect(backspace(session)).toBe(true)
  })
})
