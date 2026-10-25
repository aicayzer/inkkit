import { test, expect, operation, observe, caretAfterMatch } from './fixtures'
const cases = [
  ['html-break', 'two<br />more\n', '<br />more\n'],
  ['tight-nested', '- two\n  * nested\n  * more\n', '- * nested\n  * more\n'],
  [
    'tight-ordered',
    '- two\n  1) nested\n  2) more\n',
    '- 1) nested\n  2) more\n',
  ],
  ['tight-heading', '- two\n  ## Title ##\n', '- ## Title ##\n'],
  ['tight-quote', '- two\n  > nested\n  > more\n', '- > nested\n  > more\n'],
  [
    'tight-fence',
    '- two\n  ```js\n  nested\n  ```\n',
    '- ```js\n  nested\n  ```\n',
  ],
  [
    'loose-nested',
    '- two\n\n  * nested\n  * more\n',
    '- <br />\n\n  * nested\n  * more\n',
  ],
  ['wrapped-paragraph', 'two\nmore\n', 'more\n'],
  ['wrapped-list', '- two\n  more\n', '- more\n'],
  ['wrapped-quote', '> two\n> more\n', '> more\n'],
  [
    'crlf-nested',
    '+ two\r\n  * nested\r\n  * more\r\n',
    '+ * nested\r\n  * more\r\n',
  ],
  ['crlf-wrapped', '> two\r\n> more 🌍\r\n', '> more 🌍\r\n'],
] as const
for (const [name, source, result] of cases) {
  test(`emptying the first line: ${name}`, async ({ page, openFixture }) => {
    await openFixture()
    const ending = source.includes('\r\n') ? '\r\n' : '\n'
    const tail =
      ending +
      '[Keep][REF]' +
      ending +
      ending +
      '[REF]: https://example.com "Authored"' +
      ending
    const original = source + tail
    const expected = result + tail
    await operation(page, 'reload', { text: original })
    const initial = await observe(page)
    await caretAfterMatch(page, 'two')
    for (let index = 0; index < 3; index++)
      await page.keyboard.press('Backspace')
    const final = await observe(page)
    expect(final.snapshot!.revision).toBe(3)
    expect(final.snapshot!.text).toBe(expected)
    expect(final.diagnostics).toEqual(initial.diagnostics)
    const editor = page.getByRole('textbox', {
      name: 'Formatted Markdown editor',
      exact: true,
    })
    const html = await editor.innerHTML()
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(original)
    await operation(page, 'redo')
    expect((await observe(page)).snapshot!.text).toBe(expected)
    await operation(page, 'reload', { text: expected })
    expect((await observe(page)).snapshot!.text).toBe(expected)
    expect(await editor.innerHTML()).toBe(html)
  })
}

test('first-line deletion honours read-only and composition guards', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'reload', { text: 'two\nmore\n' })
  await caretAfterMatch(page, 'two')
  const before = (await observe(page)).snapshot
  await operation(page, 'editable', { editable: false })
  expect((await observe(page)).snapshot).toEqual(before)
  await expect(
    operation(page, 'replace', { search: 'two', replacement: '' }),
  ).rejects.toThrow('read-only')
  await operation(page, 'editable', { editable: true })
  expect((await observe(page)).snapshot).toEqual(before)
  const editor = page.getByRole('textbox', {
    name: 'Formatted Markdown editor',
    exact: true,
  })
  await editor.dispatchEvent('compositionstart', { data: '中' })
  await expect(
    operation(page, 'replace', { search: 'two', replacement: '' }),
  ).rejects.toThrow('composition')
  await editor.dispatchEvent('compositionend', { data: '' })
  await expect.poll(async () => (await observe(page)).snapshot).toEqual(before)
  expect(
    await operation(page, 'replace', { search: 'two', replacement: '' }),
  ).toBe(true)
  expect((await observe(page)).snapshot!.text).toBe('more\n')
})
