import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

async function dragOver(page: Page, root = 0, xOffset = 30) {
  const editor = page.locator('.inkkit-root .ProseMirror').nth(root)
  const box = (await editor.boundingBox())!
  await editor.dispatchEvent('dragover', {
    clientX: box.x + xOffset,
    clientY: box.y + 80,
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  })
}

const indicator = (page: Page, root = 0) =>
  page.locator('.inkkit-root').nth(root).locator('.milkdown-drop-indicator')

test('drop indicator hides after lifecycle events and reset removes its old node', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  for (const [index, event] of ['drop', 'dragend', 'dragleave'].entries()) {
    await dragOver(page, 0, 30 + index)
    await expect(indicator(page)).toHaveCSS('display', 'block')
    await page.locator('.inkkit-root .ProseMirror').dispatchEvent(event)
    await expect(indicator(page)).toBeHidden()
  }
  await dragOver(page, 0, 40)
  const old = await indicator(page).elementHandle()
  await page.evaluate(() => window.inkkitPlayground.reset())
  expect(await old!.evaluate((node) => node.isConnected)).toBe(false)
  await expect(page.locator('.milkdown-drop-indicator')).toHaveCount(1)
})

for (const event of ['dragleave', 'dragend', 'drop']) {
  test(`drop indicator returns at the same coordinates after ${event}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await dragOver(page)
    await expect(indicator(page)).toHaveCSS('display', 'block')
    await page.locator('.inkkit-root .ProseMirror').dispatchEvent(event)
    await expect(indicator(page)).toBeHidden()
    await dragOver(page)
    await expect(indicator(page)).toHaveCSS('display', 'block')
  })
}
