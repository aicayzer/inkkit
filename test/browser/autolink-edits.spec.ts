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
