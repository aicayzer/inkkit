import { test, expect, observe, operation } from './fixtures'

test('tab-indented code remains text while rectangular TSV becomes a table', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  for (const text of [
    'def f():\n\treturn 1',
    'def f():\r\n\treturn "雪"\r\n',
    Array.from({ length: 101 }, (_, index) => `\tline ${index}`).join('\n'),
  ]) {
    await page.evaluate(() => window.inkkitPlayground.replaceDocument('', 'md'))
    await operation(page, 'paste', { input: { text, markdown: text } })
    const expected = (await observe(page)).snapshot!.text
    await page.evaluate(() => window.inkkitPlayground.replaceDocument('', 'md'))
    await operation(page, 'paste', { input: { text } })
    expect((await observe(page)).snapshot!.text).toBe(expected)
    await expect(page.locator('.ProseMirror table')).toHaveCount(0)
    await page.evaluate(
      (saved) => window.inkkitPlayground.replaceDocument(saved, 'md'),
      expected,
    )
    expect((await observe(page)).snapshot!.text).toBe(expected)
  }
  await page.evaluate(() => window.inkkitPlayground.replaceDocument('', 'md'))
  await operation(page, 'paste', {
    input: { text: 'Name\tValue\r\n雪\t2\r\n' },
  })
  await expect(page.locator('.ProseMirror table')).toHaveCount(1)
  await expect(page.locator('.ProseMirror table')).toContainText('雪')
  const saved = (await observe(page)).snapshot!.text
  await page.evaluate(
    (saved) => window.inkkitPlayground.replaceDocument(saved, 'md'),
    saved,
  )
  expect((await observe(page)).snapshot!.text).toBe(saved)
})
