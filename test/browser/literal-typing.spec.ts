import { test, expect, observe, caretAfterMatch } from './fixtures'
import type { Page } from '@playwright/test'

// A long note of prose with bold, inline code and links, as hosts hold, with
// a fenced code block and paragraphs InkKit keeps as literal Markdown.
function note(ending: string, last: string): string {
  const prose = Array.from(
    { length: 60 },
    (_, i) =>
      `Paragraph ${i} has **bold ${i}**, \`code ${i}\` and a [link ${i}](https://example.com/${i}).`,
  )
  return [
    '# Notes',
    ...prose.slice(0, 30),
    'A [full][ref] literal x.',
    'Hello <span>inline</span> literal y.',
    '```js\nconst answer = 42\n```',
    'After the fence z.',
    ...prose.slice(30),
    last,
  ]
    .join('\n\n')
    .replaceAll('\n', ending)
    .concat(ending)
}

async function load(page: Page, text: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md', 'literal'),
    text,
  )
  await expect.poll(async () => (await observe(page)).snapshot?.text).toBe(text)
}

// Types `typed` with the keyboard after `at` and checks that every key saved.
async function typeAfter(page: Page, at: string, typed: string) {
  await caretAfterMatch(page, at)
  await page.keyboard.type(typed)
}

for (const [name, ending, last] of [
  ['LF', '\n', 'The end.'],
  ['CRLF', '\r\n', 'The end.'],
  ['ending with an empty paragraph', '\n', 'The end.\n\n<br />'],
] as const)
  test(`typing Markdown characters in a long note saves them as typed: ${name}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    const source = note(ending, last)
    await load(page, source)
    let expected = source
    const insert = (after: string, text: string) => {
      const at = expected.indexOf(after) + after.length
      expected = expected.slice(0, at) + text + expected.slice(at)
    }

    // Into the literal paragraphs.
    await typeAfter(page, 'literal x.', ' *a_ [b] \\c `d` <e ```')
    insert('literal x.', ' *a_ [b] \\c `d` <e ```')
    await typeAfter(page, 'literal y.', ' *f* `g`')
    insert('literal y.', ' *f* `g`')
    // Into the code block, and backticks into the paragraphs around it.
    await typeAfter(page, 'answer = 42', ' * `2` [0] <x>')
    insert('answer = 42', ' * `2` [0] <x>')
    await typeAfter(page, 'fence z.', ' Use `npm` and ``` here.')
    // Typed in formatted text, a backtick pair is inline code and a lone
    // backtick is text, which is escaped.
    insert('fence z.', ' Use `npm` and \\`\\`\\` here.')
    await typeAfter(page, 'Paragraph 29 has ', '`')
    insert('Paragraph 29 has ', '\\`')

    await expect
      .poll(async () => (await observe(page)).snapshot?.text)
      .toBe(expected)
    const { diagnostics, snapshot } = await observe(page)
    expect(diagnostics).toEqual([])
    // The saved note reopens as it was edited.
    await load(page, snapshot!.text)
    expect((await observe(page)).diagnostics).toEqual([])
  })
