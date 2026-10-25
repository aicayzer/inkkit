import { test, expect, operation, observe } from './fixtures'

declare global {
  interface Window {
    imageDrags: { trusted: boolean; text: string; html: string }[]
  }
}

for (const kind of ['block', 'inline']) {
  test(
    'image drag exports only safe visible content: ' + kind,
    async ({ page, openFixture }) => {
      await openFixture('images')
      const reference = 'images/private-name-152.png'
      const source =
        kind === 'block'
          ? 'Before\n\n![Private picture](' + reference + ')\n\nAfter\n'
          : 'Before %%DRAG_SECRET%% [unsafe](javascript:alert(1)) ![Private picture](' +
            reference +
            ') after\n'
      await page.evaluate(
        (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
        source,
      )
      const image = page.locator('.ProseMirror img').first()
      await expect(image).toBeVisible()
      const display = await image.getAttribute('src')
      expect(display).toBeTruthy()
      if (kind === 'block') await image.click()
      else {
        await operation(page, 'focus')
        await page.keyboard.press('Meta+a')
      }
      await page.evaluate(() => {
        window.imageDrags = []
        document.addEventListener('dragstart', (e) => {
          const dt = e.dataTransfer!
          window.imageDrags.push({
            trusted: e.isTrusted,
            text: dt.getData('text/plain'),
            html: dt.getData('text/html'),
          })
        })
      })
      const before = await observe(page)
      const box = (await image.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(
        box.x + box.width / 2 + 15,
        box.y + box.height / 2 + 15,
        { steps: 10 },
      )
      await page.mouse.move(
        box.x + box.width / 2 + 70,
        box.y + box.height / 2 + 50,
        { steps: 10 },
      )
      const drags = await page.evaluate(() => window.imageDrags)
      await page.keyboard.press('Escape')
      await page.mouse.up()
      expect(drags.length).toBeGreaterThan(0)
      const drag = drags[0]!
      expect(drag.trusted).toBe(true)
      expect(drag.html).not.toContain(reference)
      expect(drag.html).not.toContain(display!)
      expect(drag.html).toContain('alt="Private picture"')
      expect(drag.html).not.toMatch(/src(?:set)?=/)
      expect(drag.text).toContain('Private picture')
      expect(drag.text).not.toContain(reference)
      expect(drag.html).not.toContain('DRAG_SECRET')
      expect(drag.text).not.toContain('DRAG_SECRET')
      expect(drag.html).not.toContain('javascript:')
      expect((await observe(page)).snapshot).toEqual(before.snapshot)
      await page.evaluate(
        (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
        source,
      )
      expect((await observe(page)).snapshot!.text).toBe(source)
    },
  )
}

test('moving an image retains its authored reference and Undo history', async ({
  page,
  openFixture,
}) => {
  await openFixture('images')
  const source =
    'Before\n\n![Private picture](images/private-name-152.png)\n\nAfter\n'
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  const image = page.locator('.ProseMirror img').first()
  await expect(image).toBeVisible()
  await image.click()
  const start = (await image.boundingBox())!
  const end = (await page
    .locator('.ProseMirror p', { hasText: 'After' })
    .boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    start.x + start.width / 2 + 15,
    start.y + start.height / 2 + 15,
    { steps: 10 },
  )
  await page.mouse.move(end.x + 2, end.y + end.height - 1, { steps: 20 })
  await page.mouse.up()
  const moved = (await observe(page)).snapshot!.text
  expect(moved).toBe(
    'Before\n\nAfter\n\n![Private picture](images/private-name-152.png)\n',
  )
  expect(moved.match(/images\/private-name-152.png/g)).toHaveLength(1)
  expect(moved).toContain('![Private picture](images/private-name-152.png)')
  expect(await operation(page, 'undo')).toBe(true)
  expect((await observe(page)).snapshot!.text).toBe(source)
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    moved,
  )
  expect((await observe(page)).snapshot!.text).toBe(moved)
})
