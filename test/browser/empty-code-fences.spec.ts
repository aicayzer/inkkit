import { test, expect, observe, operation } from './fixtures'

test('a note with an empty code block opens and saves unchanged @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = 'Before\n\n```js\n```\n\nAfter\n'
  await operation(page, 'replaceSource', { text: source })
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe(source)
  await expect(page.locator('.ProseMirror pre').first()).toBeVisible()
})

test('clearing a code block with the keyboard leaves an empty code block @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'replaceSource', {
    text: 'Before\n\n```js\nconst a = 1\n```\n\nAfter\n',
  })
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const from = readable.text.indexOf('const a = 1')
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from, to: from + 11 },
    options: { focus: true },
  })
  await page.keyboard.press('Backspace')
  const observed = await observe(page)
  expect(observed.diagnostics).toEqual([])
  expect(observed.snapshot!.text).toBe('Before\n\n```js\n```\n\nAfter\n')
  await page.keyboard.type('x')
  expect((await observe(page)).snapshot!.text).toBe(
    'Before\n\n```js\nx\n```\n\nAfter\n',
  )
})
