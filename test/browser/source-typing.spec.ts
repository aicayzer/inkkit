import type { Page } from '@playwright/test'
import { test, expect, observe, operation } from './fixtures'

const original =
  Array.from(
    { length: 600 },
    (_, index) =>
      `Paragraph ${index} has enough words to wrap over a line or two in the source editor.`,
  ).join('\n\n') + '\n'

async function openSource(page: Page, at: number) {
  await page.goto('/?fixture=everyday&configuration=rich')
  await expect
    .poll(() =>
      page.evaluate(
        () => window.inkkitPlayground?.observe().snapshot?.documentId,
      ),
    )
    .toBe('fixture:everyday')
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    original,
  )
  await operation(page, 'editingMode', { mode: 'source' })
  const area = page.locator('textarea.inkkit-plain')
  await area.focus()
  await area.evaluate((element, at) => {
    const area = element as HTMLTextAreaElement
    area.setSelectionRange(at, at)
    const added: string[] = []
    ;(window as unknown as { added: string[] }).added = added
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement)
            added.push(node.outerHTML.slice(0, 80))
    }).observe(document.body, { childList: true })
  }, at)
  return area
}

test('source typing reaches the snapshot at once and later reaches the formatted view', async ({
  page,
}) => {
  const area = await openSource(page, 20)
  await page.keyboard.type('typed words')
  const expected = original.slice(0, 20) + 'typed words' + original.slice(20)
  await expect(area).toHaveValue(expected)
  expect((await observe(page)).snapshot!.text).toBe(expected)
  // No measuring copy of the text is added to the page while typing.
  expect(
    await page.evaluate(() => (window as unknown as { added: string[] }).added),
  ).toEqual([])
  await operation(page, 'editingMode', { mode: 'formatted' })
  expect((await observe(page)).snapshot!.text).toBe(expected)
  await expect(page.locator('.ProseMirror.editor')).toContainText(
    'enoutyped wordsgh words',
  )
})

test('source typing is undone as one step and redone', async ({ page }) => {
  const area = await openSource(page, 20)
  await page.keyboard.type('typed words')
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(area).toHaveValue(original)
  expect((await observe(page)).snapshot!.text).toBe(original)
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(area).toHaveValue(
    original.slice(0, 20) + 'typed words' + original.slice(20),
  )
})
