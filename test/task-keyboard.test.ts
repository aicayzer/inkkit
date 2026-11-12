import { expect, test } from 'vitest'
import { edit } from './edit-source'
import { withInputTimers } from './timing'

for (const [marker, newline] of [
  ['-', '\n'],
  ['+', '\r\n'],
] as const) {
  for (const checked of [' ', 'x']) {
    test(`Return after ${marker} [${checked}] creates an unchecked task (${JSON.stringify(newline)})`, async () => {
      const source = `${marker} [${checked}] Café 😀${newline}`
      expect(
        await edit(source, (session) => {
          session.caret('Café 😀')
          expect(session.key('Enter')).toBe(true)
          session.type('Next')
        }),
      ).toBe(source + `${marker} [ ] Next${newline}`)
    })
  }

  test(`Backspace exits an empty task (${marker}, ${JSON.stringify(newline)})`, async () => {
    const source = `${marker} [x] Café 😀${newline}`
    expect(
      await edit(source, (session) => {
        session.caret('Café 😀')
        session.key('Enter')
        expect(session.key('Backspace')).toBe(true)
        session.type('Outside')
      }),
    ).toBe(source + `${newline}Outside${newline}`)
  })
}

test('splitting a completed task in the middle leaves its second part unchecked', async () => {
  expect(
    await edit('- [x] Thank you.\n', (session) => {
      session.caret('Thank ')
      session.key('Enter')
    }),
  ).toBe('- [x] Thank&#x20;\n- [ ] you.\n')
})

test('Backspace on an empty task between other tasks preserves both neighbours', async () => {
  const source = '- [x] Before\n- [ ] After\n'
  expect(
    await edit(source, (session) => {
      session.caret('Before')
      session.key('Enter')
      session.key('Backspace')
      session.type('Outside')
    }),
  ).toBe('- [x] Before\n\nOutside\n\n- [ ] After\n')
})

test('task keyboard edits obey stale-document and composition guards', async () => {
  await edit('- [x] Café 😀\n', async (session) => {
    session.caret('Café 😀')
    expect(() => session.editor.keyDown({ key: 'Enter' }, 0)).toThrow(
      expect.objectContaining({ code: 'stale-document' }),
    )
    await withInputTimers(() => {
      session.view.dom.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true }),
      )
      expect(session.key('Enter')).toBe(false)
      expect(session.key('Backspace')).toBe(false)
      session.view.dom.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true }),
      )
    })
    expect(session.text()).toBe('- [x] Café 😀\n')
  })
})
