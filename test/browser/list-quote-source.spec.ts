import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Backspace, Tab, Enter and paste run through the browser's key and clipboard
// events, which jsdom does not reproduce.

async function open(page: Page, source: string, find: string, after = true) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const at = readable.text.indexOf(find) + (after ? find.length : 0)
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: at, to: at },
    options: { focus: true },
  })
}

const saved = (page: Page) =>
  expect.poll(async () => (await observe(page)).snapshot!.text)

async function pastePlain(page: Page, text: string) {
  await page.evaluate((text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, text)
}

test.beforeEach(async ({ openFixture }) => {
  await openFixture()
})

for (const [name, source, find, back] of [
  ['a quote', '> a\n', 'a', '> \\`\\`\\` a\n'],
  ['a callout', '> [!NOTE]\n> a\n', 'a', '> [!NOTE]\n> \\`\\`\\` a\n'],
  [
    'the second paragraph of a list item',
    '- x\n\n  A B\n',
    'A B',
    '- x\n\n  \\`\\`\\` A B\n',
  ],
] as const)
  test(`Backspace right after a typed fence takes it back in ${name}`, async ({
    page,
  }) => {
    await open(page, source, find, false)
    await page.keyboard.type('``` ')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toContain('```\n')
    await page.keyboard.press('Backspace')
    await saved(page).toBe(back)
    await page.keyboard.press('ControlOrMeta+z')
    await saved(page).not.toBe(back)
  })

test('Backspace at the start of a quote that opens a list item leaves no spacer line', async ({
  page,
}) => {
  await open(page, '- > a\n  >\n  > b\n', 'a', false)
  await page.keyboard.press('Backspace')
  await saved(page).toBe('- a\n  > b\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe('- > a\n  >\n  > b\n')
})

test('a pasted line break keeps the quote marker and the list indentation', async ({
  page,
}) => {
  await open(page, '> a\n> - x\n', 'a')
  await pastePlain(page, 'y\nc')
  await saved(page).toBe('> ay\n> c\n> - x\n')
  await open(page, '  * a\n  * x\n', 'a')
  await pastePlain(page, 'y\nc')
  await saved(page).toBe('  * ay\n    c\n  * x\n')
})

test('Enter in an indented list adds an item with the same indentation', async ({
  page,
}) => {
  await open(page, '  1) a\n  2) b\n', 'a')
  await page.keyboard.press('Enter')
  await page.keyboard.type('N')
  await saved(page).toBe('  1) a\n  2) N\n  2) b\n')
})

test('Tab and Shift+Tab keep the source of the item they move', async ({
  page,
}) => {
  const source = '1) __a__\n2) _b_\n3) c\n'
  await open(page, source, 'b')
  await page.keyboard.press('Tab')
  await saved(page).toBe('1) __a__\n   1) _b_\n3) c\n')
  await page.keyboard.press('Shift+Tab')
  await saved(page).toBe(source)
  await open(page, source, 'a')
  await page.keyboard.press('Shift+Tab')
  await saved(page).toBe('__a__\n\n1) _b_\n2) c\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe(source)
})
