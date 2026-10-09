import { test, expect, observe, operation } from './fixtures'

test('read-only transitions preserve source and shared history @host-controls', async ({
  page,
  openFixture,
}) => {
  await openFixture('untidy')
  const original = (await observe(page)).snapshot!.text
  await operation(page, 'editingMode', { mode: 'source' })
  const source = page.getByRole('textbox', { name: 'Markdown source editor' })
  await source.fill(`${original}\nChanged`)
  const changed = (await observe(page)).snapshot!.text
  await operation(page, 'editable', { editable: false })
  await expect(source).toHaveAttribute('readonly', '')
  const readOnly = await observe(page)
  expect(readOnly.commandState!.commands.undo).toBe(false)
  const failure = await operation(page, 'replaceSource', { text: 'NO' }).catch(
    (error: Error) => error.message,
  )
  expect(failure).toContain('read-only')
  expect((await observe(page)).snapshot!.text).toBe(changed)
  await operation(page, 'editingMode', { mode: 'formatted' })
  await expect(
    page.getByRole('textbox', {
      name: 'Formatted Markdown editor',
      exact: true,
    }),
  ).toHaveAttribute('contenteditable', 'false')
  await operation(page, 'editable', { editable: true })
  await operation(page, 'undo')
  expect((await observe(page)).snapshot!.text).toBe(original)
})

test('composition guards and native input attributes on both surfaces @host-controls', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  await operation(page, 'textInput', {
    preferences: {
      spellcheck: false,
      autocorrect: false,
      autocapitalize: 'off',
    },
  })
  const formatted = page.getByRole('textbox', {
    name: 'Formatted Markdown editor',
    exact: true,
  })
  await expect(formatted).toHaveAttribute('spellcheck', 'false')
  await expect(formatted).toHaveAttribute('autocorrect', 'off')
  await operation(page, 'editingMode', { mode: 'source' })
  const source = page.getByRole('textbox', { name: 'Markdown source editor' })
  await source.focus()
  await source.dispatchEvent('compositionstart', { data: '中' })
  expect((await observe(page)).commandState!.composing).toBe(true)
  await expect(
    operation(page, 'editable', { editable: false }),
  ).rejects.toThrow('composition')
  await expect(
    operation(page, 'textInput', { preferences: { spellcheck: true } }),
  ).rejects.toThrow('composition')
  await source.dispatchEvent('compositionend', { data: '' })
  await expect(source).toHaveAttribute('spellcheck', 'false')
  await expect(source).toHaveAttribute('autocapitalize', 'off')
  expect((await observe(page)).editable).toBe(true)
  await expect(source).toBeFocused()
})

test('read-only transition invalidates delayed import even after re-enabling @host-controls', async ({
  page,
  openFixture,
}) => {
  await openFixture('images', '&adapter=hold')
  const original = (await observe(page)).snapshot!
  await operation(page, 'startImagePaste')
  await expect
    .poll(async () => (await observe(page)).commandState?.pending)
    .toBe(true)
  await operation(page, 'editable', { editable: false })
  await operation(page, 'editable', { editable: true })
  await operation(page, 'finishImagePaste')
  expect((await observe(page)).snapshot).toEqual(original)
})

test('two editors keep appearance inside their roots @host-controls', async ({
  page,
  openFixture,
}) => {
  await openFixture('tables', '&editors=2')
  const hostBefore = await page.locator('#host-content').evaluate((root) =>
    [...root.querySelectorAll('p,td,textarea')].map((node) => ({
      font: getComputedStyle(node).fontSize,
      padding: getComputedStyle(node).padding,
      background: getComputedStyle(node).backgroundColor,
    })),
  )
  expect(hostBefore[0]).toEqual(
    expect.objectContaining({ font: '16px', padding: '0px' }),
  )
  expect(
    await page
      .locator('#host-content table')
      .evaluate((node) => getComputedStyle(node).display),
  ).toBe('table')
  const secondBefore = await page
    .locator('#second-editor')
    .evaluate(
      (root) =>
        getComputedStyle(root.querySelector('[contenteditable]')!).fontSize,
    )
  await page
    .locator('#editor')
    .evaluate((root) => root.style.setProperty('--inkkit-font-size', '24px'))
  const hostAfter = await page.locator('#host-content').evaluate((root) =>
    [...root.querySelectorAll('p,td,textarea')].map((node) => ({
      font: getComputedStyle(node).fontSize,
      padding: getComputedStyle(node).padding,
      background: getComputedStyle(node).backgroundColor,
    })),
  )
  expect(hostAfter).toEqual(hostBefore)
  expect(
    await page
      .locator('#second-editor')
      .evaluate(
        (root) =>
          getComputedStyle(root.querySelector('[contenteditable]')!).fontSize,
      ),
  ).toBe(secondBefore)
  expect(
    await page
      .locator('#editor')
      .evaluate(
        (root) =>
          getComputedStyle(root.querySelector('[contenteditable]')!).fontSize,
      ),
  ).toBe('24px')
})

test('task markers retain their gutter, tick offset and click target when scaled @host-controls', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const task = page.locator('#editor li[data-item-type="task"]').first()
  const completed = page.locator('#editor li[data-checked="true"]').last()
  for (const size of [15, 24]) {
    await page
      .locator('#editor')
      .evaluate(
        (root, size) =>
          root.style.setProperty('--inkkit-font-size', `${size}px`),
        size,
      )
    const marker = await task.evaluate((node) => {
      const style = getComputedStyle(node, '::before')
      const bounds = node.getBoundingClientRect()
      return {
        left: Number.parseFloat(style.left),
        width: Number.parseFloat(style.width),
        x:
          bounds.left +
          Number.parseFloat(style.left) +
          Number.parseFloat(style.width) / 2,
        y:
          bounds.top +
          Number.parseFloat(style.top) +
          Number.parseFloat(style.height) / 2,
      }
    })
    const tickLeft = await completed.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node, '::after').left),
    )
    expect(marker.left).toBeCloseTo(size * -1.667, 2)
    expect(tickLeft).toBeCloseTo(size * -1.333, 2)
    expect(marker.left + marker.width).toBeLessThan(0)
    expect(tickLeft).toBeGreaterThan(marker.left)
    expect(tickLeft).toBeLessThan(marker.left + marker.width)
    const checked = await task.getAttribute('data-checked')
    await page.mouse.click(marker.x, marker.y)
    await expect(task).toHaveAttribute(
      'data-checked',
      checked === 'true' ? 'false' : 'true',
    )
  }
  await operation(page, 'editable', { editable: false })
  const before = (await observe(page)).snapshot
  const marker = await task.evaluate((node) => {
    const style = getComputedStyle(node, '::before')
    const bounds = node.getBoundingClientRect()
    return {
      x:
        bounds.left +
        Number.parseFloat(style.left) +
        Number.parseFloat(style.width) / 2,
      y:
        bounds.top +
        Number.parseFloat(style.top) +
        Number.parseFloat(style.height) / 2,
    }
  })
  await page.mouse.click(marker.x, marker.y)
  await expect(task).toHaveAttribute('data-checked', 'false')
  expect((await observe(page)).snapshot).toEqual(before)
})

test('availability observation stays clean and rejects a replaced generation @host-controls', async ({
  page,
  openFixture,
}) => {
  await openFixture()
  const original = (await observe(page)).snapshot!
  await operation(page, 'find', { text: 'bold' })
  expect((await observe(page)).selectedText).toBe('bold')
  for (let index = 0; index < 3; index++) await operation(page, 'commandState')
  expect((await observe(page)).snapshot).toEqual(original)
  await page.getByRole('button', { name: 'Replace document' }).click()
  await expect
    .poll(async () => (await observe(page)).snapshot?.documentId)
    .toBe('replacement')
  await expect(
    operation(page, 'commandState', { generation: original.generation }),
  ).rejects.toThrow('Document changed')
  expect((await observe(page)).commandState!.commands.undo).toBe(false)
})

for (const mode of ['source', 'formatted'] as const) {
  test(`history keymap blocks native defaults and honours a replacement on ${mode} @host-controls`, async ({
    page,
    openFixture,
  }) => {
    await openFixture()
    await page.evaluate(() =>
      window.inkkitPlayground.replaceDocument(
        'Original text',
        'md',
        'history-keymap',
      ),
    )
    await operation(page, 'editingMode', { mode })
    const surface = page.getByRole('textbox', {
      name:
        mode === 'source'
          ? 'Markdown source editor'
          : 'Formatted Markdown editor',
      exact: true,
    })
    await surface.focus()
    await surface.press('ControlOrMeta+a')
    await surface.pressSequentially('Changed text')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe('Changed text')
    await operation(page, 'keymap', { keymap: { undo: [], redo: [] } })
    await surface.press('ControlOrMeta+z')
    expect((await observe(page)).snapshot!.text).toBe('Changed text')
    await surface.press('ControlOrMeta+Shift+z')
    expect((await observe(page)).snapshot!.text).toBe('Changed text')
    await operation(page, 'keymap', { keymap: { undo: ['Mod-u'], redo: [] } })
    await surface.press('ControlOrMeta+z')
    expect((await observe(page)).snapshot!.text).toBe('Changed text')
    await surface.press('ControlOrMeta+u')
    await expect
      .poll(async () => (await observe(page)).snapshot!.text)
      .toBe('Original text')
  })
}
