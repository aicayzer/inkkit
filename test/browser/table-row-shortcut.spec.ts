import type { Page } from '@playwright/test'
import { test, expect, observe, caretAfterMatch } from './fixtures'

// Enter and Tab turn a typed table row into a table. The keys, the typing and
// Undo go through the browser, which jsdom does not reproduce.

async function load(page: Page, text: string) {
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    text,
  )
  await expect.poll(async () => (await observe(page)).snapshot?.text).toBe(text)
}

const saved = (page: Page) =>
  expect.poll(async () => (await observe(page)).snapshot?.text)

for (const key of ['Enter', 'Tab'])
  test(`${key} turns a typed row into a table and Undo restores the line`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await load(page, 'Intro\n\nEnd\n')
    await caretAfterMatch(page, 'Intro')
    await page.keyboard.press('Enter')
    await page.keyboard.type('| Name | **Date** | `a|b` |')
    await page.keyboard.press(key)
    await saved(page).toBe(
      'Intro\n\n| Name | **Date** | `a\\|b` |\n| ---- | -------- | ------ |\n|      |          |        |\n\nEnd\n',
    )
    // The caret is in the first body cell.
    await page.keyboard.type('x')
    await saved(page).toContain('| x    |')
    await page.keyboard.press('ControlOrMeta+z')
    await saved(page).toContain('|      |          |        |')
    await page.keyboard.press('ControlOrMeta+z')
    await saved(page).toBe('Intro\n\n\\| Name | **Date** | `a|b` |\n\nEnd\n')
    expect((await observe(page)).diagnostics).toEqual([])
    // The caret is back at the end of the typed line.
    await page.keyboard.type('!')
    await saved(page).toBe('Intro\n\n\\| Name | **Date** | `a|b` |!\n\nEnd\n')
  })

test('Undo right after the conversion restores the typed line at once', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '')
  await page.getByRole('textbox', { name: 'Formatted Markdown editor' }).click()
  await page.keyboard.type('| a | b |')
  await page.keyboard.press('Tab')
  await saved(page).toBe('| a | b |\n| - | - |\n|   |   |\n')
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe('\\| a | b |\n')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await saved(page).toBe('| a | b |\n| - | - |\n|   |   |\n')
})

test('a typed backslash before a pipe keeps the pipe in its cell', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '')
  await page.getByRole('textbox', { name: 'Formatted Markdown editor' }).click()
  await page.keyboard.type('| a \\| b | c |')
  await page.keyboard.press('Enter')
  await saved(page).toBe('| a \\| b | c |\n| ------ | - |\n|        |   |\n')
})

test('Tab in a list item makes the table; Tab elsewhere still sinks the item', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '- one\n- two\n')
  await caretAfterMatch(page, 'two')
  await page.keyboard.press('Tab')
  await saved(page).toBe('- one\n  - two\n')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.type('| a | b |')
  await page.keyboard.press('Tab')
  await saved(page).toBe(
    '- one\n- two\n- | a | b |\n  | - | - |\n  |   |   |\n',
  )
  await page.keyboard.press('ControlOrMeta+z')
  await saved(page).toBe('- one\n- two\n- \\| a | b |\n')
})

test('a row in a quote becomes a table inside the quote', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '> quote\n')
  await caretAfterMatch(page, 'quote')
  await page.keyboard.press('Enter')
  await page.keyboard.type('| a | b |')
  await page.keyboard.press('Enter')
  await saved(page).toBe('> quote\n>\n> | a | b |\n> | - | - |\n> |   |   |\n')
})

test('Enter after a line that is not a row still starts a paragraph', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await load(page, '')
  await page.getByRole('textbox', { name: 'Formatted Markdown editor' }).click()
  await page.keyboard.type('| a |')
  await page.keyboard.press('Enter')
  await page.keyboard.type('next')
  await saved(page).toBe('\\| a |\n\nnext\n')
})
