import { test, expect, observe, operation } from './fixtures'

test('buffered multiline marked input stays saveable across source/history/reload @consolidation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', { text: '__Original__\n' })
  await operation(page, 'find', { text: 'Original' })
  await operation(page, 'insertText', { text: 'one\r\ntwo\rthree\n' })
  const edited = (await observe(page)).snapshot!
  expect(edited.text).toContain('two')
  expect((await observe(page)).diagnostics).toEqual([])
  await operation(page, 'editingMode', { mode: 'source' })
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe('__Original__\n')
  await operation(page, 'redo')
  expect((await observe(page)).snapshot!.text).toBe(edited.text)
})

test('revealed comments have visible computed CSS while portable output remains private @consolidation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', {
    text: 'Visible <!-- inline private --> body\n\n<!-- block private -->\n',
  })
  await expect(page.locator('.inkkit-comment-inline')).toBeHidden()
  await operation(page, 'commentsVisible', { visible: true })
  await expect(page.locator('.inkkit-comment-inline')).toBeVisible()
  await expect(page.locator('.inkkit-comment-block')).toBeVisible()
  await operation(page, 'printable')
  const printed = (await observe(page)).lastResult as { html: string }
  expect(printed.html).not.toContain('private')
  await operation(page, 'commentsVisible', { visible: false })
  await expect(page.locator('.inkkit-comment-block')).toBeHidden()
})

test('minimal previews stay disabled with editable and preserved source @consolidation', async ({
  page,
}) => {
  await page.goto('/?fixture=mermaid&configuration=minimal')
  await page.waitForFunction(() => Boolean(window.inkkitPlayground))
  await expect
    .poll(async () => (await observe(page)).snapshot?.documentId)
    .toBe('fixture:mermaid')
  const original = (await observe(page)).snapshot!
  await expect(page.locator('.inkkit-mermaid-preview')).toHaveCount(0)
  await operation(page, 'editingMode', { mode: 'source' })
  await operation(page, 'replaceSource', { text: original.text + 'After\n' })
  await operation(page, 'editingMode', { mode: 'formatted' })
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(original.text)
  await expect(page.locator('.inkkit-mermaid-preview')).toHaveCount(0)
})

test('multiline table input saves, reopens and undoes @consolidation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = '| Head |\r\n| --- |\r\n| Original |\r\n'
  await operation(page, 'replaceSource', { text: source })
  await operation(page, 'find', { text: 'Original' })
  await operation(page, 'insertText', { text: 'one\r\ntwo\n' })
  const saved = '| Head |\r\n| --- |\r\n| one<br />two<br /> |\r\n'
  expect((await observe(page)).snapshot!.text).toBe(saved)
  expect((await observe(page)).diagnostics).toEqual([])
  const visible = (await observe(page)).textSnapshot!.text
  await page.keyboard.press('ControlOrMeta+z')
  expect((await observe(page)).snapshot!.text).toBe(source)
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    saved,
  )
  expect((await observe(page)).snapshot!.text).toBe(saved)
  expect((await observe(page)).textSnapshot!.text).toBe(visible)
})
