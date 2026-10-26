import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

const url = 'https://example.com/path'
const blocks: [string, (url: string) => string][] = [
  ['a paragraph', (url) => `Visit ${url} today.\n`],
  ['a list item', (url) => `- ${url}\n`],
  ['a table cell', (url) => `| Link |\n| --- |\n| ${url} |\n`],
]
const edits: [string, boolean, string[], string][] = [
  ['typing after the path', false, ['s'], `${url}s`],
  ['typing a space and a word after it', false, [' ', 'x'], url],
  ['deleting a character', false, ['Backspace'], url.slice(0, -1)],
  [
    'replacing the selected path',
    true,
    ['d', 'o', 'c', 's'],
    'https://example.com/docs',
  ],
]

// Selects `path`, or places the caret after it, through the readable text.
async function select(page: Page, whole: boolean) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const end = readable.text.indexOf('path') + 4
  await operation(page, 'selectTextRange', {
    range: {
      snapshotId: readable.snapshotId,
      from: whole ? end - 4 : end,
      to: end,
    },
    options: { focus: true },
  })
}

for (const [block, write] of blocks)
  for (const [name, whole, keys, link] of edits)
    test(`${name} of a bare URL in ${block} saves it @preservation`, async ({
      page,
      openFixture,
    }) => {
      await openFixture()
      await operation(page, 'replaceSource', { text: write(url) })
      await select(page, whole)
      for (const key of keys) await page.keyboard.press(key)
      const observed = await observe(page)
      expect(observed.diagnostics).toEqual([])
      const typed = keys.filter((key) => key.length === 1).join('')
      expect(observed.snapshot!.text).toBe(
        write(
          keys.includes('Backspace')
            ? url.slice(0, -1)
            : whole
              ? link
              : url + typed,
        ),
      )
      const anchor = page
        .getByRole('textbox', {
          name: 'Formatted Markdown editor',
          exact: true,
        })
        .locator('a')
        .first()
      await expect(anchor).toHaveText(link)
      await expect(anchor).toHaveAttribute('href', link)
    })

// Places the caret before or after `marker` in the readable text.
async function caret(page: Page, marker: string, after: boolean) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(marker) + (after ? marker.length : 0)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

const typing: [string, string, string, boolean, string, string][] = [
  [
    'a URL into plain text',
    'Write here\n',
    'here',
    true,
    ' https://example.com/a',
    'Write here https://example.com/a\n',
  ],
  [
    'a www. address into plain text',
    'Write here\n',
    'here',
    true,
    ' www.example.com',
    'Write here www.example.com\n',
  ],
  [
    'a link written as Markdown into plain text',
    'Write here\n',
    'here',
    true,
    ' [a](http://x.com',
    'Write here \\[a]\\(http://x.com\n',
  ],
  [
    'next to a code span that holds a written link',
    'Write `[text](https://example.com)`\n',
    'https://example.com)',
    true,
    '.',
    'Write `[text](https://example.com)`.\n',
  ],
  [
    'a URL into inline code',
    'Run `xy` now\n',
    'x',
    true,
    'https://e.com/a',
    'Run `xhttps://e.com/ay` now\n',
  ],
  [
    'an email address into plain text',
    'Write here\n',
    'here',
    true,
    ' ada@example.com',
    'Write here ada@example.com\n',
  ],
  ...["'", '"', '(', ':', '['].map(
    (mark): [string, string, string, boolean, string, string] => [
      `${mark} before a www. address`,
      'Go www.example.com now.\n',
      'www',
      false,
      mark,
      `Go ${mark === '[' ? '\\[' : mark}www.example.com now.\n`,
    ],
  ),
  ...['.html', '?q=1', '#part'].map(
    (text): [string, string, string, boolean, string, string] => [
      `${text} after a URL`,
      'See https://example.com/page now.\n',
      'page',
      true,
      text,
      `See https://example.com/page${text} now.\n`,
    ],
  ),
  [
    'a port after a URL',
    'See https://example.com now.\n',
    '.com',
    true,
    ':8080',
    'See https://example.com:8080 now.\n',
  ],
  [
    'into a URL in angle brackets',
    'See <https://example.com/path> now.\n',
    'pat',
    true,
    's',
    'See <https://example.com/patsh> now.\n',
  ],
  [
    'after a space beside an address that ends in a character reference',
    'See www.example.com&copy; 2026 notes\n',
    '2026',
    false,
    'x',
    'See www.example.com&copy; x2026 notes\n',
  ],
  [
    'far from an address in quotes',
    'Link "https://example.com/a" and words here\n',
    'here',
    true,
    '!',
    'Link "https://example.com/a" and words here!\n',
  ],
  [
    'after an entity beside an email-like word',
    'Contact user@host or &copy; 2024\n',
    '2024',
    true,
    '5',
    'Contact user@host or &copy; 20245\n',
  ],
  [
    'into an address in underscore emphasis',
    'Go _https://example.com/path_ now\n',
    'path',
    true,
    's',
    'Go _https://example.com/paths_ now\n',
  ],
  [
    'into a written link whose label is its destination',
    'See [docs](docs) now.\n',
    'doc',
    true,
    'x',
    'See [docxs](docs) now.\n',
  ],
]

for (const [name, source, marker, after, text, saved] of typing)
  test(`typing ${name} saves it as written @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    await caret(page, marker, after)
    await page.keyboard.type(text)
    const observed = await observe(page)
    expect(observed.diagnostics).toEqual([])
    expect(observed.snapshot!.text).toBe(saved)
  })

test('bold and undo over a soft line break keep it soft @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: 'line one\nline two\n' })
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  await operation(page, 'selectTextRange', {
    range: {
      snapshotId: readable.snapshotId,
      from: 0,
      to: 'line one\nline two'.length,
    },
    options: { focus: true },
  })
  await operation(page, 'format', { command: 'bold' })
  let observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('**line one\nline two**\n')
  await page.keyboard.press('ControlOrMeta+z')
  observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('line one\nline two\n')
})

test('opening a note with a non-ASCII address in a heading leaves it as written @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: '# https://bücher.de/a\n' })
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('# https://bücher.de/a\n')
  await expect(
    page
      .getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })
      .locator('a'),
  ).toHaveAttribute('href', 'https://bücher.de/a')
})
