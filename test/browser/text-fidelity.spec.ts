import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

// Typing, Enter and paste run through the browser's input events, which jsdom
// does not reproduce.

async function open(page: Page, source: string, find: string, after = true) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  await operation(page, 'commentsVisible', { visible: true })
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

test.beforeEach(async ({ openFixture }) => {
  await openFixture()
})

test('typing a character reference saves the characters typed', async ({
  page,
}) => {
  await open(page, 'Write\n', 'Write')
  await page.keyboard.type(' &amp; and &#x41; more')
  await saved(page).toBe(String.raw`Write &amp\; and &#x41\; more` + '\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).not.toContain('more')
})

test('an edited block in a lone-CR document keeps CR', async ({ page }) => {
  const source = 'line one\rline two\r\r```\rcode\r```\r'
  await open(page, source, 'line two')
  await page.keyboard.type('s')
  await saved(page).toBe('line one\rline twos\r\r```\rcode\r```\r')
  await open(page, source, 'code')
  await page.keyboard.type('s')
  await saved(page).toBe('line one\rline two\r\r```\rcodes\r```\r')
})

test('a one-line comment edited while shown stays on one line', async ({
  page,
}) => {
  await open(page, 'a\n\n%%c%%\n\nb\n', 'a')
  await page.locator('.inkkit-comment-block').click()
  await page.keyboard.press('End')
  await page.keyboard.type('d')
  await saved(page).toBe('a\n\n%%cd%%\n\nb\n')
})

test('Enter beside an unsupported callout in a quote and in a list item saves', async ({
  page,
}) => {
  await open(page, '> quote\n>\n> > [!BOGUS]\n> > body\n', 'quote')
  await page.keyboard.press('Enter')
  await page.keyboard.type('next')
  await saved(page).toBe('> quote\n>\n> next\n>\n> > [!BOGUS]\n> > body\n')
  await open(page, '- item\n  > [!BOGUS]\n  > body\n', 'item')
  await page.keyboard.press('Enter')
  await page.keyboard.type('next')
  await saved(page).toBe('- item\n- next\n\n  > [!BOGUS]\n  > body\n')
})

test('Enter at the end of a wrapped line writes no character reference', async ({
  page,
}) => {
  await open(
    page,
    'First line of a paragraph\nsecond line of it\n',
    'paragraph',
  )
  await page.keyboard.press('Enter')
  await saved(page).toBe('First line of a paragraph\n\nsecond line of it\n')
})
