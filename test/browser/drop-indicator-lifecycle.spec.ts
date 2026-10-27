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

for (const scheme of ['light', 'dark'] as const) {
  test(`drop indicator is opaque and has non-text contrast in ${scheme}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await page.locator('.inkkit-root').evaluate((root, scheme) => {
      root.style.setProperty('--inkkit-color-scheme', scheme)
      root.style.backgroundColor = 'Canvas'
    }, scheme)
    await dragOver(page)
    const colors = await indicator(page).evaluate((node) => {
      const root = node.closest('.inkkit-root')!
      return {
        foreground: getComputedStyle(node).backgroundColor,
        background: getComputedStyle(root).backgroundColor,
      }
    })
    expect(colors.foreground).toBe(
      scheme === 'light' ? 'rgb(0, 105, 209)' : 'rgb(64, 156, 255)',
    )
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((value) => {
          const scaled = value / 255
          return scaled <= 0.04045
            ? scaled / 12.92
            : ((scaled + 0.055) / 1.055) ** 2.4
        })
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      )
    }
    const values = [
      luminance(colors.foreground),
      luminance(colors.background),
    ].sort((a, b) => b - a)
    expect((values[0]! + 0.05) / (values[1]! + 0.05)).toBeGreaterThanOrEqual(3)
    await page
      .locator('.inkkit-root')
      .evaluate((root) =>
        root.style.setProperty('--inkkit-drop-indicator-color', '#a000a0'),
      )
    await expect(indicator(page)).toHaveCSS(
      'background-color',
      'rgb(160, 0, 160)',
    )
  })
}
