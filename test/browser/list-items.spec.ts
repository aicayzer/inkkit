import { test, expect, observe, caretAfterMatch } from './fixtures'

for (const source of [
  '- ```\n  code\n  ```\n- two\n',
  '- ```\n  code\n  ```\n\n- two\n',
])
  test(`typing in a code fence that opens a list item keeps its first line: ${JSON.stringify(source)}`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      source,
    )
    await caretAfterMatch(page, 'cod')
    await page.keyboard.type('Z')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe(source.replace('code', 'codZe'))
    await page.keyboard.press('ControlOrMeta+z')
    await expect
      .poll(async () => (await observe(page)).snapshot)
      .toMatchObject({ text: source, dirty: false })
  })
