import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Selects `length` characters from `offset` characters after the start of
// `marker` in the readable text.
async function caret(page: Page, marker: string, offset: number, length = 0) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(marker) + offset
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at + length },
    options: { focus: true },
  })
}

const editor = (page: Page) =>
  page.getByRole('textbox', { name: 'Formatted Markdown editor', exact: true })

const links = (page: Page) =>
  editor(page)
    .locator('a')
    .evaluateAll((anchors) => anchors.map((a) => a.textContent))

async function saved(page: Page): Promise<string> {
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  return observed.snapshot!.text
}

// [what, source, offset into `a b`, saved]
const formatted: [string, string, number, string][] = [
  ['strong', 'See **[a b](u)** now\n', 1, 'See **[aX b](u)** now\n'],
  ['emphasis', 'See _[a b](u)_ now\n', 3, 'See _[a b](u)X_ now\n'],
  ['strikethrough', 'See ~~[a b](u)~~ now\n', 2, 'See ~~[a Xb](u)~~ now\n'],
  [
    'strong around a reference link, with CRLF',
    'See __[a b][r]__ now\r\n\r\n[r]: https://example.com\r\n',
    1,
    'See __[aX b][r]__ now\r\n\r\n[r]: https://example.com\r\n',
  ],
]

for (const [name, source, offset, expected] of formatted)
  test(`typing in link text inside ${name} keeps the delimiters outside @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    await caret(page, 'a b', offset)
    await page.keyboard.type('X')
    expect(await saved(page)).toBe(expected)
    await operation(page, 'undo')
    expect(await saved(page)).toBe(source)
    await operation(page, 'redo')
    expect(await saved(page)).toBe(expected)
  })

// [what, source, marker, typed, saved, link texts shown]
const ends: [string, string, string, string, string, string[]][] = [
  [
    'an inline link',
    'See [docs](docs) now\n',
    'docs',
    's and more',
    'See [docs](docs)s and more now\n',
    ['docs'],
  ],
  [
    'a reference link, with CRLF',
    'See [docs][d] now\r\n\r\n[d]: https://example.com\r\n',
    'docs',
    's',
    'See [docs][d]s now\r\n\r\n[d]: https://example.com\r\n',
    ['docs'],
  ],
  [
    'an angle autolink',
    'See <https://example.com> now\n',
    'example.com',
    'x',
    'See <https://example.com>x now\n',
    ['https://example.com'],
  ],
  [
    'a bare address, which grows',
    'See https://example.com now\n',
    'example.com',
    '/path',
    'See https://example.com/path now\n',
    ['https://example.com/path'],
  ],
]

for (const [name, source, marker, typed, expected, shown] of ends)
  test(`text typed at the end of ${name} reopens as shown @preservation`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await operation(page, 'reload', { text: source })
    await caret(page, marker, marker.length)
    await page.keyboard.type(typed)
    expect(await saved(page)).toBe(expected)
    expect(await links(page)).toEqual(shown)
    await operation(page, 'reload', { text: expected })
    expect(await links(page)).toEqual(shown)
  })

test('text typed over a selected link label stays in the link @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'See [docs](docs) now\n'
  await operation(page, 'reload', { text: source })
  await caret(page, 'docs', 0, 4)
  await page.keyboard.type('user guide')
  expect(await saved(page)).toBe('See [user guide](docs) now\n')
  expect(await links(page)).toEqual(['user guide'])
  // A caret moved back to the end leaves the link there again.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('s')
  expect(await saved(page)).toBe('See [user guide](docs)s now\n')
  for (let step = 0; step < 20 && (await saved(page)) !== source; step++)
    await operation(page, 'undo')
  expect(await saved(page)).toBe(source)
  expect(await links(page)).toEqual(['docs'])
})

test('a link started at the caret continues until whitespace @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'ab\n' })
  await caret(page, 'ab', 2)
  await operation(page, 'format', {
    command: 'link',
    options: { destination: 'u' },
  })
  await page.keyboard.type('hello world')
  expect(await saved(page)).toBe('ab[hello](u) world\n')
  expect(await links(page)).toEqual(['hello'])
})

test('text typed after formatted link text stays inside the formatting @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'See **[a b](u)** now\n' })
  await caret(page, 'a b', 3)
  await page.keyboard.type('X')
  expect(await saved(page)).toBe('See **[a b](u)X** now\n')
  expect(await links(page)).toEqual(['a b'])
})
