import { test, expect, observe, operation, caretAfterMatch } from './fixtures'

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
  await page.locator('.ProseMirror pre').hover()
  await language.click()
  const search = page.getByRole('searchbox', { name: 'Search languages' })
  await expect(search).toBeFocused()
  await expect(search).toHaveCSS('outline-style', 'none')
  await page.keyboard.type('typescript')
  await expect(search).toHaveValue('typescript')
  await expect(search).toHaveCSS('outline-style', 'none')
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

test('language picker aligns its decorative chevron and shows token focus for keyboard navigation', async ({
  page,
  openFixture,
  browserName,
}) => {
  await openFixture()
  const source = '```custom-language\ncode\n```\n'
  await operation(page, 'replaceSource', { text: source })
  await page.locator('.inkkit-root').evaluate((root) => {
    root.style.setProperty('--inkkit-focus-color', 'rgb(120, 20, 180)')
    root.style.setProperty('--inkkit-focus-width', '3px')
    root.style.setProperty('--inkkit-focus-offset', '-3px')
  })
  const language = page.getByRole('button', {
    name: 'Code language',
    exact: true,
  })
  const chevron = language.locator('svg')
  await expect(chevron).toHaveAttribute('aria-hidden', 'true')
  await expect(chevron).toHaveAttribute('focusable', 'false')
  const anchor = await language.boundingBox()
  const icon = await chevron.boundingBox()
  expect(
    Math.abs(icon!.y + icon!.height / 2 - anchor!.y - anchor!.height / 2),
  ).toBeLessThan(1)

  await page.locator('.ProseMirror pre').hover()
  await language.click()
  const menu = page.getByRole('dialog', { name: 'Code language' })
  const search = page.getByRole('searchbox', { name: 'Search languages' })
  await expect(search).toBeFocused()
  await expect(search).toHaveCSS('outline-style', 'none')
  await page.keyboard.press('ArrowUp')
  await expect(
    menu.getByRole('button', { name: 'custom-language', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const auto = menu.getByRole('button', { name: 'Auto', exact: true })
  await expect(auto).toBeFocused()
  await expect(auto).toHaveCSS('outline-color', 'rgb(120, 20, 180)')
  await expect(auto).toHaveCSS('outline-width', '3px')
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Wrap code' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(search).toBeFocused()
  await expect(search).toHaveCSS('outline-color', 'rgb(120, 20, 180)')
  await expect(search).toHaveCSS('outline-width', '3px')
  await expect(search).toHaveCSS('outline-offset', '-3px')
  await search.click()
  await expect(search).toBeFocused()
  await expect(search).toHaveCSS('outline-style', 'none')
  await page.keyboard.type('no-language-☃')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowDown')
  await expect(search).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(language).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(search).toBeFocused()
  await expect(search).toHaveCSS('outline-width', '3px')
  if (browserName === 'chromium') {
    await page.emulateMedia({ forcedColors: 'active' })
    await expect(search).toHaveCSS('outline-style', 'solid')
    await expect(search).toHaveCSS('outline-width', '3px')
    expect(
      await search.evaluate((input) => getComputedStyle(input).outlineColor),
    ).not.toBe('rgba(0, 0, 0, 0)')
  }
  await page.keyboard.press('Escape')
  await page.locator('.ProseMirror pre').hover()
  await language.click()
  await expect(search).toHaveCSS('outline-style', 'none')
  await page.getByRole('textbox', { name: 'Formatted Markdown editor' }).click()
  await expect(menu).toHaveCount(0)
  expect((await observe(page)).snapshot!.text).toBe(source)
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
  await page.locator('.ProseMirror pre').hover()
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
  await page.locator('.ProseMirror pre').hover()
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
  await page.locator('.ProseMirror pre').hover()
  await page.getByRole('button', { name: 'Code language', exact: true }).click()
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

test('language menu survives queued scrolls and list scrolling but closes when its anchor moves', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await page.addStyleTag({ content: 'body { min-height: 2000px }' })
  await operation(page, 'replaceSource', { text: '```js\nconst x = 1\n```\n' })
  const language = page.getByRole('button', {
    name: 'Code language',
    exact: true,
  })
  await page.locator('.ProseMirror pre').hover()
  await language.click()
  const menu = page.getByRole('dialog', { name: 'Code language' })
  await expect(menu).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event('scroll')))
  await expect(menu).toBeVisible()
  const list = menu.locator('.inkkit-code-language-list')
  const scrolled = await list.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        element.addEventListener(
          'scroll',
          () => requestAnimationFrame(() => resolve(element.scrollTop)),
          { once: true },
        )
        element.scrollTop = element.scrollHeight
      }),
  )
  expect(scrolled).toBeGreaterThan(0)
  await expect(menu).toBeVisible()
  await page.evaluate(() => window.scrollBy(0, 50))
  await expect(menu).toHaveCount(0)
})

test('code controls appear together for hover, text selection, keyboard focus and an open menu', async ({
  page,
  openFixture,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 })
  await openFixture()
  const source = 'Before\n\n```js\nconst café = 1\n```\n\nAfter\n'
  await operation(page, 'replaceSource', { text: source })
  const pre = page.locator('.ProseMirror pre')
  const controls = pre.locator('.inkkit-code-controls')
  const copy = pre.getByRole('button', { name: 'Copy', exact: true })
  const language = pre.getByRole('button', {
    name: 'Code language',
    exact: true,
  })
  const visible = async (value: boolean) => {
    for (const control of [controls, copy])
      await expect(control).toHaveCSS('opacity', value ? '1' : '0')
  }
  await page.mouse.move(0, 0)
  await visible(false)
  await pre.hover()
  await visible(true)
  await page.mouse.move(0, 0)
  await visible(false)
  await caretAfterMatch(page, 'café')
  await visible(true)
  await caretAfterMatch(page, 'Before')
  await visible(false)
  await page.keyboard.press('Tab')
  await expect(language).toBeFocused()
  await visible(true)
  await page.keyboard.press('Tab')
  await expect(copy).toBeFocused()
  await visible(true)
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('searchbox', { name: 'Search languages' }),
  ).toBeFocused()
  await visible(true)
  await page.keyboard.press('Tab')
  const wrap = page.getByRole('button', { name: 'Wrap code' })
  await expect(wrap).toBeFocused()
  await page.keyboard.press('Space')
  await expect(wrap).toHaveAttribute('aria-pressed', 'true')
  await visible(true)
  await page.keyboard.press('Escape')
  await expect(language).toBeFocused()
  await visible(true)
  await caretAfterMatch(page, 'After')
  await visible(false)
  await caretAfterMatch(page, 'café')
  await page.getByRole('textbox', { name: 'Host text' }).focus()
  await visible(false)
  expect((await observe(page)).snapshot!.text).toBe(source)
})

test('code scrolls beneath anchored controls and an open language menu', async ({
  page,
  openFixture,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 })
  await openFixture()
  const source =
    '```typescript\nconst value = "' + 'long_word_'.repeat(80) + '"\n```\n'
  await operation(page, 'replaceSource', { text: source })
  const pre = page.locator('.ProseMirror pre')
  const code = pre.locator(':scope > code')
  const language = pre.getByRole('button', {
    name: 'Code language',
    exact: true,
  })
  const copy = pre.getByRole('button', { name: 'Copy', exact: true })
  await pre.hover()
  await language.click()
  const before = {
    language: await language.boundingBox(),
    copy: await copy.boundingBox(),
  }
  await code.evaluate((el) => {
    el.scrollLeft = 150
  })
  await expect.poll(() => code.evaluate((el) => el.scrollLeft)).toBe(150)
  expect(await language.boundingBox()).toEqual(before.language)
  expect(await copy.boundingBox()).toEqual(before.copy)
  const menu = page.getByRole('dialog', { name: 'Code language' })
  await expect(menu).toBeVisible()
  const wrap = menu.getByRole('button', { name: 'Wrap code' })
  const size = await wrap.boundingBox()
  expect(size!.width).toBe(24)
  expect(size!.height).toBe(24)
  await expect(wrap.locator('svg')).toHaveAttribute('aria-hidden', 'true')
  await wrap.click()
  await expect(code).toHaveCSS('white-space', 'pre-wrap')
  expect(
    await code.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1)
  await expect(menu).toBeVisible()
  expect((await observe(page)).snapshot!.text).toBe(source)
})

test('per-block wrapping survives edits without changing bytes, revision or undo history @preservation', async ({
  page,
  openFixture,
}) => {
  await page.setViewportSize({ width: 1000, height: 1400 })
  await openFixture()
  const source =
    'Before\r\n\r\n~~~~ js title="café"\r\nconst café = 1\r\n~~~~\r\n\r\n```custom-language\r\nsecond\r\n```\r\n'
  await operation(page, 'replaceSource', { text: source })
  const blocks = page.locator('.ProseMirror pre')
  const before = (await observe(page)).snapshot!
  const toggle = async (index: number) => {
    const pre = blocks.nth(index)
    await pre.hover()
    await pre
      .getByRole('button', { name: 'Code language', exact: true })
      .click()
    await page.getByRole('button', { name: 'Wrap code' }).click()
    await page.keyboard.press('Escape')
  }
  await toggle(0)
  await toggle(1)
  await toggle(0)
  await expect(blocks.nth(0).locator(':scope > code')).toHaveCSS(
    'white-space',
    'pre',
  )
  await expect(blocks.nth(1).locator(':scope > code')).toHaveCSS(
    'white-space',
    'pre-wrap',
  )
  expect((await observe(page)).snapshot).toEqual(before)
  await caretAfterMatch(page, 'Before')
  await page.keyboard.type('!')
  await expect(blocks.nth(1).locator(':scope > code')).toHaveCSS(
    'white-space',
    'pre-wrap',
  )
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(source)
  await expect(blocks.nth(1).locator(':scope > code')).toHaveCSS(
    'white-space',
    'pre-wrap',
  )
  await blocks.nth(1).hover()
  await blocks
    .nth(1)
    .getByRole('button', { name: 'Code language', exact: true })
    .click()
  const search = page.getByRole('searchbox', { name: 'Search languages' })
  await search.fill('  typescript  ')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(blocks.nth(1).locator(':scope > code')).toHaveCSS(
    'white-space',
    'pre-wrap',
  )
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(source)
  await page.evaluate(
    (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
    source,
  )
  for (const code of await blocks.locator(':scope > code').all())
    await expect(code).toHaveCSS('white-space', 'pre')
  expect((await observe(page)).snapshot!.text).toBe(source)
  expect((await observe(page)).diagnostics).toEqual([])
})

for (const contents of ['', 'const café = 1'])
  test(`code controls preserve exit, typing and undo after a final ${contents ? 'populated' : 'empty'} block @preservation`, async ({
    page,
    openFixture,
  }) => {
    await page.setViewportSize({ width: 1000, height: 1400 })
    await openFixture()
    const source =
      '~~~~ js title="café"\r\n' + (contents ? contents + '\r\n' : '') + '~~~~'
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      source,
    )
    const editor = page.getByRole('textbox', {
      name: 'Formatted Markdown editor',
    })
    await editor.focus()
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End',
    )
    const pre = page.locator('.ProseMirror pre')
    await pre.hover()
    await pre
      .getByRole('button', { name: 'Code language', exact: true })
      .click()
    await page.getByRole('button', { name: 'Wrap code' }).click()
    await page.keyboard.press('Escape')
    await editor.focus()
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter',
    )
    await expect(editor.locator(':scope > p')).toHaveCount(1)
    await page.keyboard.type('After')
    await expect(editor.locator(':scope > p')).toHaveText('After')
    const saved = (await observe(page)).snapshot!.text
    expect(saved.startsWith(source)).toBe(true)
    await operation(page, 'undo')
    await operation(page, 'undo')
    expect((await observe(page)).snapshot!.text).toBe(source)
    await page.evaluate(
      (text) => window.inkkitPlayground.replaceDocument(text, 'md'),
      saved,
    )
    expect((await observe(page)).snapshot!.text).toBe(saved)
    await expect(editor.locator(':scope > p')).toHaveText('After')
    expect((await observe(page)).diagnostics).toEqual([])
  })
