import { test, expect, observe, operation } from './fixtures'

test('code language controls support search, keyboard selection, undo and visible copy focus @preservation', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source =
    'Before\n\n~~~~ js title="sample"\r\nconst café = 1\r\n~~~~\n\nAfter\n'
  await operation(page, 'replaceSource', { text: source })
  const language = page.getByRole('button', {
    name: 'Code language',
    exact: true,
  })
  await language.click()
  const search = page.getByRole('searchbox', { name: 'Search languages' })
  await search.fill('typescript')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('~~~~ js', '~~~~ typescript'),
  )
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(source)
  await language.focus()
  await page.keyboard.press('Tab')
  const copy = page.locator('pre .inkkit-copy')
  await expect(copy).toBeFocused()
  await expect(copy).toHaveCSS('opacity', '1')
  await expect(copy).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await page.keyboard.press('Enter')
  expect((await observe(page)).diagnostics).toEqual([])
})

test('language menu retains unknown source and closes with Escape', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = '```custom-language\ncode\n```\n'
  await operation(page, 'replaceSource', { text: source })
  const language = page.getByRole('button', {
    name: 'Code language',
    exact: true,
  })
  await language.click()
  await expect(
    page.getByRole('dialog', { name: 'Code language' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(language).toBeFocused()
  await expect(page.getByRole('dialog', { name: 'Code language' })).toHaveCount(
    0,
  )
  expect((await observe(page)).snapshot!.text).toBe(source)
})

test('language menu flips above a low code block and respects host viewport insets', async ({
  page,
  openFixture,
}) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await openFixture()
  await operation(page, 'replaceSource', { text: '```js\nconst x = 1\n```\n' })
  await page.addStyleTag({
    content: '.inkkit-root .ProseMirror pre { margin-top: 300px !important }',
  })
  await operation(page, 'setViewport', {
    insets: { top: 15, right: 20, bottom: 80, left: 20 },
  })
  const language = page.getByRole('button', {
    name: 'Code language',
    exact: true,
  })
  await language.click()
  const menu = page.getByRole('dialog', { name: 'Code language' })
  await expect(menu).toBeVisible()
  const bounds = await menu.boundingBox()
  const anchor = await language.boundingBox()
  const safe = (await observe(page)).viewport!.rect
  expect(bounds!.y).toBeGreaterThanOrEqual(safe.top)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(safe.bottom)
  expect(bounds!.x).toBeGreaterThanOrEqual(safe.left)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(safe.right)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(anchor!.y)
})

test('choosing the current Auto language restores the code caret for typing', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const source = '```\nconst value = 1\n```\n'
  await operation(page, 'replaceSource', { text: source })
  await operation(page, 'textSnapshot')
  const readable = (await observe(page)).lastResult as {
    snapshotId: string
    text: string
  }
  const to = readable.text.indexOf('const value = 1') + 'const value = 1'.length
  await operation(page, 'selectTextRange', {
    range: { snapshotId: readable.snapshotId, from: to, to },
    options: { focus: true },
  })
  await page.getByRole('button', { name: 'Code language', exact: true }).click()
  await page.screenshot({ path: '_local/review/code-language-menu.png' })
  await page.getByRole('button', { name: 'Auto', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: 'Formatted Markdown editor' }),
  ).toBeFocused()
  await page.keyboard.type(';')
  expect((await observe(page)).snapshot!.text).toBe(
    source.replace('value = 1', 'value = 1;'),
  )
  expect((await observe(page)).diagnostics).toEqual([])
})
