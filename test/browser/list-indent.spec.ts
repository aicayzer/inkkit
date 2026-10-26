import type { Page } from '@playwright/test'
import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

const saved = async (page: Page) => (await observe(page)).snapshot!.text

async function open(page: Page, text: string) {
  await operation(page, 'reload', { text })
  await caretAfterMatch(page, 'two')
}

test('Tab and Shift-Tab indent and outdent a list item with real key presses', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, '- one\n- two\n')
  await page.keyboard.press('Tab')
  await expect.poll(() => saved(page)).toBe('- one\n  - two\n')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => saved(page)).toBe('- one\n- two\n')
})

test('a host that binds indent and outdent to other keys moves Tab back to the browser', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, '- one\n- two\n')
  await operation(page, 'keymap', {
    keymap: { indent: ['Mod-]'], outdent: ['Mod-['] },
  })
  await page.keyboard.press('ControlOrMeta+]')
  await expect.poll(() => saved(page)).toBe('- one\n  - two\n')
  await page.keyboard.press('ControlOrMeta+[')
  await expect.poll(() => saved(page)).toBe('- one\n- two\n')
  // Tab no longer indents: it moves focus on, and the list stays as it was.
  await page.keyboard.press('Tab')
  expect(await saved(page)).toBe('- one\n- two\n')
  expect(
    await page.evaluate(() => document.activeElement?.closest('.ProseMirror')),
  ).toBeNull()
})

test('a read-only editor does not indent and leaves Tab to the browser', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await open(page, '- one\n- two\n')
  await operation(page, 'editable', { editable: false })
  const prevented = await page.evaluate(() => {
    const root = document.querySelector('.ProseMirror')!
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    root.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(prevented).toBe(false)
  expect(await saved(page)).toBe('- one\n- two\n')
})
