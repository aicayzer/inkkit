import { expect, test } from 'vitest'
import { edit } from './edit-source'

// Enter at the end of a wrapped line starts a paragraph or item with the
// next line, without a character reference for the line break.

for (const ending of ['\n', '\r\n'])
  for (const [name, source, saved] of [
    [
      'a paragraph',
      'First line of a paragraph\nsecond line of it\n',
      'First line of a paragraph\n\nsecond line of it\n',
    ],
    [
      'a list item',
      '- First line of a paragraph\n  second line of it\n',
      '- First line of a paragraph\n- second line of it\n',
    ],
    [
      'a quote',
      '> First line of a paragraph\n> second line of it\n',
      '> First line of a paragraph\n>\n> second line of it\n',
    ],
  ] as const)
    test(`Enter after the first line of ${name} writes no character reference (${JSON.stringify(ending)})`, async () => {
      expect(
        await edit(source.replaceAll('\n', ending), (session) => {
          session.caret('paragraph')
          expect(session.key('Enter')).toBe(true)
        }),
      ).toBe(saved.replaceAll('\n', ending))
    })
