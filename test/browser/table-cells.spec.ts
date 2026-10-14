import { test, expect, observe, operation } from './fixtures'

test('typing spaces beside an image and formatted text in a table cell saves spaces', async ({
  page,
  openFixture,
}) => {
  await openFixture('images')
  await page.evaluate(() =>
    window.inkkitPlayground.replaceDocument(
      '| Name | Other |\n| --- | --- |\n| Tiny![a](images/native.png)tail | **bold**word |\n',
      'md',
    ),
  )
  await expect(page.locator('.ProseMirror td img').first()).toBeVisible()
  const typeSpace = async (text: string, key: 'ArrowLeft' | 'ArrowRight') => {
    await operation(page, 'find', { text })
    await page.keyboard.press(key)
    await page.keyboard.type(' ')
  }
  await typeSpace('Tiny', 'ArrowRight')
  await typeSpace('tail', 'ArrowLeft')
  await typeSpace('word', 'ArrowLeft')
  await typeSpace('word', 'ArrowRight')
  const saved = (await observe(page)).snapshot!.text
  expect(saved).toBe(
    '| Name | Other |\n| --- | --- |\n| Tiny ![a](images/native.png) tail | **bold** word&#x20; |\n',
  )
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    saved,
  )
  expect((await observe(page)).snapshot!.text).toBe(saved)
})
