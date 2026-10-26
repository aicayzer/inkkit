import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Places the caret `offset` characters after the start of `marker` in the
// readable text.
async function caret(page: Page, marker: string, offset: number) {
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(marker) + offset
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

async function saved(page: Page): Promise<string> {
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  return observed.snapshot!.text
}

// [what, source, offset into `a b`, saved]
const formatted: [string, string, number, string][] = [
  ['strong', 'See **[a b](u)** now\n', 1, 'See **[aX b](u)** now\n'],
  ['emphasis', 'See _[a b](u)_ now\n', 3, 'See _[a bX](u)_ now\n'],
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
