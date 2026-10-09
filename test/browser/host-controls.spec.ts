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
